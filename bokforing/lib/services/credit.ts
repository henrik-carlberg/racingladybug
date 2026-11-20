import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { parseAmount } from '@/lib/money';
import { creditDecision, riskClass, RISK_LABEL, suggestedLimit, type Policy, type RiskClass } from '@/lib/credit';
import { creditConfigured, fetchReport, startMonitor, stopMonitor } from '@/lib/server/credit';
import { customerBehaviors } from './forecast';
import type { Actor } from './actor';
import { str } from './input';

const orgnrOk = (s: string) => /^\d{6}-?\d{4}$/.test(s.trim());

async function ownCustomer(companyId: number, id: number) {
  const [c] = await sql<{ id: number; name: string; orgnr: string; risk_class: RiskClass | null; credit_monitor_id: string | null }[]>`
    SELECT id, name, orgnr, risk_class, credit_monitor_id FROM customers WHERE id = ${id} AND company_id = ${companyId}`;
  if (!c) throw new NotFoundError('Kunden');
  return c;
}

async function event(db: Tx | typeof sql, companyId: number, customerId: number, kind: string, message: string) {
  await db`INSERT INTO credit_events (company_id, customer_id, kind, message) VALUES (${companyId}, ${customerId}, ${kind}, ${message})`;
}

/** Hämtar en kreditupplysning och räknar om riskklassen (med hänsyn till hur kunden har betalat oss) */
export async function checkCustomer(companyId: number, customerId: number, o: { reason: 'manual' | 'new_customer' | 'monitor'; userId: number | null }) {
  const c = await ownCustomer(companyId, customerId);
  if (!orgnrOk(c.orgnr)) throw new ValidationError('Kunden saknar organisationsnummer – kreditupplysning görs på företag');
  const r = await fetchReport(c.orgnr);
  const b = (await customerBehaviors(companyId)).get(customerId) ?? null;
  const risk = riskClass({ score: r.score, remarks: r.remarks, status: r.status, recommendedLimit: r.recommendedLimit }, b);
  await sql.begin(async (tx) => {
    await tx`INSERT INTO credit_reports ${tx({ company_id: companyId, customer_id: customerId, provider_id: r.id, score: r.score, rating: r.rating, remarks: r.remarks, status: r.status,
      recommended_limit: r.recommendedLimit, reason: o.reason, created_by: o.userId })}`;
    await tx`UPDATE customers SET risk_class = ${risk} WHERE id = ${customerId}`;
    if (c.risk_class && c.risk_class !== risk) await event(tx, companyId, customerId, 'rating_change', `${c.name}: ${RISK_LABEL[c.risk_class]} → ${RISK_LABEL[risk]}`);
    if (r.status !== 'active') await event(tx, companyId, customerId, 'bankruptcy', `${c.name}: status ${r.status} hos kreditupplysningen`);
    else if (r.remarks > 0 && o.reason === 'monitor') await event(tx, companyId, customerId, 'remark', `${c.name}: ${r.remarks} betalningsanmärkning(ar)`);
  });
  return { risk, report: r, suggested: suggestedLimit({ score: r.score, remarks: r.remarks, status: r.status, recommendedLimit: r.recommendedLimit }, risk) };
}

export async function checkAsUser(actor: Actor, customerId: number) {
  const r = await checkCustomer(actor.companyId, customerId, { reason: 'manual', userId: actor.userId });
  await auditBy(sql, actor, 'credit_check', 'customer', customerId, { risk: r.risk });
  return r;
}

/** Ny företagskund: upplysning direkt om bolaget har valt det (fel stoppar inte att kunden sparas) */
export async function checkNewCustomer(actor: Actor, customerId: number) {
  if (!creditConfigured()) return;
  const [c] = await sql<{ on: boolean }[]>`SELECT credit_check_new AS on FROM companies WHERE id = ${actor.companyId}`;
  if (!c?.on) return;
  await checkCustomer(actor.companyId, customerId, { reason: 'new_customer', userId: actor.userId }).catch(() => {});
}

export async function setLimit(actor: Actor, customerId: number, input: Record<string, unknown>) {
  await ownCustomer(actor.companyId, customerId);
  const raw = String(input.credit_limit ?? '').trim();
  const limit = raw ? parseAmount(raw) : null;
  if (raw && (limit == null || limit < 0)) throw new ValidationError('Ange kreditgränsen i kronor');
  const policy: Policy = str(input, 'credit_policy') === 'block' ? 'block' : 'warn';
  await sql`UPDATE customers SET credit_limit = ${limit}, credit_policy = ${policy} WHERE id = ${customerId}`;
  await auditBy(sql, actor, 'credit_limit', 'customer', customerId, { limit, policy });
}

export async function setMonitor(actor: Actor, customerId: number, on: boolean) {
  const c = await ownCustomer(actor.companyId, customerId);
  if (on) {
    if (c.credit_monitor_id) return;
    if (!orgnrOk(c.orgnr)) throw new ValidationError('Kunden saknar organisationsnummer');
    const id = await startMonitor(c.orgnr, `${actor.companyId}:${customerId}`);
    await sql`UPDATE customers SET credit_monitor_id = ${id} WHERE id = ${customerId}`;
  } else if (c.credit_monitor_id) {
    await stopMonitor(c.credit_monitor_id);
    await sql`UPDATE customers SET credit_monitor_id = NULL WHERE id = ${customerId}`;
  }
  await auditBy(sql, actor, on ? 'credit_monitor' : 'credit_unmonitor', 'customer', customerId);
}

export async function setAutoCheck(actor: Actor, value: boolean) {
  await sql`UPDATE companies SET credit_check_new = ${value} WHERE id = ${actor.companyId}`;
  await auditBy(sql, actor, 'credit_auto', 'company', actor.companyId, { value });
}

/** Bevakningshändelse från upplysningstjänsten: uppgiften i anropet litas inte på – upplysningen hämtas om */
export async function onMonitorEvent(monitorId: string) {
  const rows = await sql<{ id: number; company_id: number }[]>`SELECT id, company_id FROM customers WHERE credit_monitor_id = ${monitorId}`;
  for (const r of rows) await checkCustomer(r.company_id, r.id, { reason: 'monitor', userId: null }).catch((e) => console.error('credit monitor', e));
  return rows.length;
}

/** Kontroll när en faktura bokförs: varnar eller stoppar enligt kundens kreditgräns och riskklass */
export async function creditGuard(tx: Tx, companyId: number, customerId: number, amount: number) {
  const [c] = await tx<{ name: string; credit_limit: number | null; credit_policy: Policy; risk_class: RiskClass | null; open: number }[]>`
    SELECT c.name, c.credit_limit::float8 AS credit_limit, c.credit_policy, c.risk_class,
      COALESCE((SELECT SUM(i.total - i.paid_amount) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'booked'), 0)::float8 AS open
    FROM customers c WHERE c.id = ${customerId} AND c.company_id = ${companyId}`;
  if (!c || (c.credit_limit == null && c.risk_class !== 'stop')) return null;
  const d = creditDecision({ limit: c.credit_limit, open: c.open, amount, risk: c.risk_class, policy: c.credit_policy });
  if (d.block) {
    await sql`INSERT INTO credit_events (company_id, customer_id, kind, message) VALUES (${companyId}, ${customerId}, 'blocked_invoice', ${`Faktura till ${c.name} stoppad: ${d.reasons.join(', ')}`})`.catch(() => {});
    throw new ValidationError(`Kreditkontroll: ${d.reasons.join(' och ')}. Höj kreditgränsen eller ändra till varning under Kundrisk.`);
  }
  return d.ok ? null : d.reasons;
}

export async function overview(companyId: number) {
  const behaviors = await customerBehaviors(companyId);
  const rows = await sql<{ id: number; name: string; orgnr: string; credit_limit: number | null; credit_policy: Policy; risk_class: RiskClass | null; monitored: boolean; open: number;
    score: number | null; rating: string | null; remarks: number | null; status: string | null; checked: string | null; recommended_limit: number | null }[]>`
    SELECT c.id, c.name, c.orgnr, c.credit_limit::float8 AS credit_limit, c.credit_policy, c.risk_class, c.credit_monitor_id IS NOT NULL AS monitored,
      COALESCE((SELECT SUM(i.total - i.paid_amount) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'booked'), 0)::float8 AS open,
      r.score, r.rating, r.remarks, r.status, to_char(r.at,'YYYY-MM-DD') AS checked, r.recommended_limit::float8 AS recommended_limit
    FROM customers c LEFT JOIN LATERAL (SELECT * FROM credit_reports x WHERE x.customer_id = c.id ORDER BY x.at DESC LIMIT 1) r ON true
    WHERE c.company_id = ${companyId} ORDER BY (c.risk_class = 'stop') DESC NULLS LAST, c.name LIMIT 500`;
  const events = await sql<{ at: string; name: string; kind: string; message: string }[]>`
    SELECT to_char(e.at,'YYYY-MM-DD HH24:MI') AS at, c.name, e.kind, e.message FROM credit_events e JOIN customers c ON c.id = e.customer_id WHERE e.company_id = ${companyId} ORDER BY e.at DESC LIMIT 50`;
  const [co] = await sql<{ auto: boolean }[]>`SELECT credit_check_new AS auto FROM companies WHERE id = ${companyId}`;
  return { rows: rows.map((r) => ({ ...r, behavior: behaviors.get(r.id) ?? null, utilization: r.credit_limit ? Math.round((r.open / r.credit_limit) * 100) : null })), events, auto: co.auto, configured: creditConfigured() };
}

export async function customerCredit(companyId: number, customerId: number) {
  const [c] = await sql<{ credit_limit: number | null; credit_policy: Policy; risk_class: RiskClass | null; open: number }[]>`
    SELECT credit_limit::float8 AS credit_limit, credit_policy, risk_class, COALESCE((SELECT SUM(i.total - i.paid_amount) FROM invoices i WHERE i.customer_id = ${customerId} AND i.status = 'booked'), 0)::float8 AS open
    FROM customers WHERE id = ${customerId} AND company_id = ${companyId}`;
  return c ?? null;
}
