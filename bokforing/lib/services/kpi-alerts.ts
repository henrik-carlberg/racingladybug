import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { sendMail } from '@/lib/server/mail';
import { accountSums, openingBalances } from '@/lib/server/ledger';
import { addDays, today } from '@/lib/format';
import { kpis } from '@/lib/kpi';
import { sumRange } from '@/lib/monthly';
import { APP_NAME } from '@/lib/brand';
import { METRICS, breached, dso, fmtValue, overBudget, type Metric } from '@/lib/kpi-alerts';
import type { Actor } from './actor';

/** Aktuella värden för nyckeltalen som kan larma */
export async function metrics(companyId: number): Promise<Record<Metric, number | null>> {
  const t = today(), y = t.slice(0, 4), month = Number(t.slice(5, 7));
  const balance = await openingBalances(companyId, addDays(t, 1));
  const result = await accountSums(companyId, `${y}-01-01`, t);
  const k = Object.fromEntries(kpis({ balance, result, avgPayDays: null }).map((x) => [x.key, x.value]));
  const [{ sales }] = await sql<{ sales: number }[]>`SELECT COALESCE(SUM(l.credit - l.debit), 0)::float8 AS sales FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND v.date > ${t}::date - 365 AND v.date <= ${t} AND l.account_number BETWEEN 3000 AND 3799`;
  const [{ budget }] = await sql<{ budget: number }[]>`SELECT COALESCE(SUM(amount), 0)::float8 AS budget FROM account_budgets WHERE company_id = ${companyId} AND year = ${Number(y)} AND month <= ${month} AND account BETWEEN 7000 AND 7699`;
  return {
    solidity: k.solidity ?? null, quick: k.quick ?? null, gross: k.gross ?? null, operating: k.operating ?? null,
    cash: Math.round(sumRange(balance, 1900, 1999)) / 100,
    dso: dso(sumRange(balance, 1500, 1599), sales),
    payroll_budget: overBudget(sumRange(result, 7000, 7699), budget),
  };
}

/** Utvärdering: nya överskridanden utlöser larm (och e-post), värden som är tillbaka inom gränsen häver larmet */
export async function evaluate(companyId: number) {
  const alerts = await sql<{ id: number; metric: Metric; comparator: 'below' | 'above'; threshold: number; email: boolean; open_id: number | null }[]>`
    SELECT a.id, a.metric, a.comparator, a.threshold::float8 AS threshold, a.email, (SELECT e.id FROM kpi_alert_events e WHERE e.alert_id = a.id AND e.cleared_at IS NULL LIMIT 1) AS open_id
    FROM kpi_alerts a WHERE a.company_id = ${companyId} AND a.active`;
  if (!alerts.length) return { triggered: 0, cleared: 0 };
  const m = await metrics(companyId);
  let triggered = 0, cleared = 0;
  const mails: string[] = [];
  for (const a of alerts) {
    const v = m[a.metric], hit = breached(v, a.comparator, a.threshold);
    if (hit && !a.open_id) {
      await sql`INSERT INTO kpi_alert_events (alert_id, company_id, value) VALUES (${a.id}, ${companyId}, ${v})`; triggered++;
      if (a.email) mails.push(`${METRICS[a.metric].label} är ${fmtValue(a.metric, v)} (${a.comparator === 'below' ? 'under' : 'över'} gränsen ${fmtValue(a.metric, a.threshold)})`);
    } else if (!hit && a.open_id) { await sql`UPDATE kpi_alert_events SET cleared_at = now(), cleared_value = ${v} WHERE id = ${a.open_id}`; cleared++; }
  }
  if (mails.length) {
    const owners = await sql<{ email: string; company: string }[]>`SELECT u.email, c.name AS company FROM memberships mb JOIN users u ON u.id = mb.user_id JOIN companies c ON c.id = mb.company_id WHERE mb.company_id = ${companyId} AND mb.role = 'owner'`;
    for (const o of owners) await sendMail(o.email, `${APP_NAME}: nyckeltalslarm för ${o.company}`, `${mails.join('\n')}\n\nSe nyckeltalslarmen i ${APP_NAME}.`).catch(() => false);
  }
  return { triggered, cleared };
}

export async function evaluateAll() {
  const cs = await sql<{ company_id: number }[]>`SELECT DISTINCT company_id FROM kpi_alerts WHERE active`;
  let n = 0;
  for (const c of cs) { try { n += (await evaluate(c.company_id)).triggered; } catch { /* nästa bolag */ } }
  return n;
}

export async function overview(companyId: number) {
  await evaluate(companyId);
  const m = await metrics(companyId);
  const alerts = await sql<{ id: number; metric: Metric; comparator: 'below' | 'above'; threshold: number; email: boolean; active: boolean }[]>`SELECT id, metric, comparator, threshold::float8 AS threshold, email, active FROM kpi_alerts WHERE company_id = ${companyId} ORDER BY id`;
  const events = await sql<{ id: number; alert_id: number; triggered_at: Date; value: number | null; cleared_at: Date | null; cleared_value: number | null }[]>`
    SELECT id, alert_id, triggered_at, value::float8 AS value, cleared_at, cleared_value::float8 AS cleared_value FROM kpi_alert_events WHERE company_id = ${companyId} ORDER BY triggered_at DESC, id DESC LIMIT 100`;
  return { metrics: m, alerts: alerts.map((a) => ({ ...a, value: m[a.metric], open: events.find((e) => e.alert_id === a.id && !e.cleared_at) ?? null })), events };
}

export async function add(actor: Actor, input: Record<string, unknown>) {
  const metric = String(input.metric) as Metric;
  if (!Object.prototype.hasOwnProperty.call(METRICS, metric)) throw new ValidationError('Välj nyckeltal');
  const comparator = input.comparator === 'above' ? 'above' : 'below';
  const th = Number(String(input.threshold ?? '').replace(/\s/g, '').replace(',', '.'));
  if (!String(input.threshold ?? '').trim() || !Number.isFinite(th) || Math.abs(th) > 1e12) throw new ValidationError('Ange gränsvärdet');
  await sql`INSERT INTO kpi_alerts ${sql({ company_id: actor.companyId, metric, comparator, threshold: th, email: input.email === 'on', created_by: actor.userId })}`;
  await auditBy(sql, actor, 'kpi_alert', 'company', actor.companyId, { metric });
  return evaluate(actor.companyId);
}

export async function toggle(actor: Actor, id: number, active: boolean) {
  const r = await sql`UPDATE kpi_alerts SET active = ${active} WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!r.count) throw new NotFoundError('Larmet');
  if (!active) await sql`UPDATE kpi_alert_events SET cleared_at = now() WHERE alert_id = ${id} AND company_id = ${actor.companyId} AND cleared_at IS NULL`;
}
