import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import {
  balanceLines, balances, earned, GRANT_ACCRUED, GRANT_PREPAID, GRANT_REPAYABLE, GRANT_REVENUE, grantReport, repaymentProvision, type RiskLevel,
} from '@/lib/grants';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';

function kronor(v: unknown, label: string, required = true) {
  const raw = String(v ?? '').trim();
  if (!raw && !required) return 0;
  const n = parseAmount(raw);
  if (n == null || n < 0 || (required && n === 0)) throw new ValidationError(`Ange ${label} i kronor`);
  return n;
}
const NOT_REVERSED = sql`NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = e.voucher_id)`;

interface GrantRow { id: number; name: string; grantor: string; reference: string; project_id: number; project: string; amount: number; coverage_pct: number; budget: number;
  period_from: string; period_to: string; conditions: string; risk: RiskLevel; risk_note: string; status: 'active' | 'repayable' | 'repaid'; received: number; recognized: number; repaid: number }

async function load(db: Tx | typeof sql, companyId: number, id?: number, lock = false) {
  return db<GrantRow[]>`
    SELECT g.id, g.name, g.grantor, g.reference, g.project_id, p.name AS project, g.amount::float8 AS amount, g.coverage_pct::float8 AS coverage_pct, g.budget::float8 AS budget,
      to_char(g.period_from,'YYYY-MM-DD') AS period_from, to_char(g.period_to,'YYYY-MM-DD') AS period_to, g.conditions, g.risk, g.risk_note, g.status,
      COALESCE((SELECT SUM(e.amount) FROM grant_events e WHERE e.grant_id = g.id AND e.kind = 'payment' AND ${NOT_REVERSED}), 0)::float8 AS received,
      COALESCE((SELECT SUM(e.amount) FROM grant_events e WHERE e.grant_id = g.id AND e.kind = 'recognition' AND ${NOT_REVERSED}), 0)::float8 AS recognized,
      COALESCE((SELECT SUM(e.amount) FROM grant_events e WHERE e.grant_id = g.id AND e.kind = 'repayment' AND ${NOT_REVERSED}), 0)::float8 AS repaid
    FROM company_grants g JOIN projects p ON p.id = g.project_id WHERE g.company_id = ${companyId} ${id ? db`AND g.id = ${id}` : db``}
    ORDER BY g.period_from DESC, g.id DESC ${lock ? db`FOR UPDATE OF g` : db``}`;
}
async function one(db: Tx | typeof sql, companyId: number, id: number, lock = false) {
  const [g] = await load(db, companyId, id, lock);
  if (!g) throw new NotFoundError('Bidraget');
  return g;
}

async function ensureAccounts(db: Tx | typeof sql, companyId: number) {
  await db`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${GRANT_REVENUE}, 'Erhållna offentliga bidrag'),
    (${companyId}, ${GRANT_PREPAID}, 'Förutbetalda bidrag'), (${companyId}, ${GRANT_ACCRUED}, 'Upplupna bidrag'), (${companyId}, ${GRANT_REPAYABLE}, 'Bidrag att återbetala')
    ON CONFLICT DO NOTHING`;
}

/** Stödberättigande kostnader: kostnadskonton (4000–7999) märkta med projektet inom bidragsperioden, fram till datumet */
async function costs(db: Tx | typeof sql, companyId: number, g: Pick<GrantRow, 'project_id' | 'period_from' | 'period_to'>, at: string, from = g.period_from) {
  const to = at < g.period_to ? at : g.period_to;
  return db<{ account: number; name: string; amount: number }[]>`
    SELECT l.account_number AS account, COALESCE(a.name, '') AS name, SUM(l.debit - l.credit)::float8 AS amount
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id LEFT JOIN accounts a ON a.company_id = v.company_id AND a.number = l.account_number
    WHERE v.company_id = ${companyId} AND l.project_id = ${g.project_id} AND l.account_number BETWEEN 4000 AND 7999 AND v.date BETWEEN ${from} AND ${to}
    GROUP BY l.account_number, a.name HAVING SUM(l.debit - l.credit) <> 0 ORDER BY l.account_number`;
}

export async function create(actor: Actor, input: Record<string, unknown>) {
  const projectId = int(input, 'project_id', 'Projekt');
  const [p] = await sql`SELECT 1 FROM projects WHERE id = ${projectId} AND company_id = ${actor.companyId}`;
  if (!p) throw new ValidationError('Projektet finns inte');
  const pct = Number(String(input.coverage_pct ?? '').replace(',', '.'));
  if (!(pct > 0 && pct <= 100)) throw new ValidationError('Ange täckningsgraden i procent (t.ex. 50)');
  const from = date(input, 'period_from', 'Period från'), to = date(input, 'period_to', 'Period till');
  if (to < from) throw new ValidationError('Perioden slutar före den börjar');
  const [dup] = await sql`SELECT 1 FROM company_grants WHERE company_id = ${actor.companyId} AND project_id = ${projectId}`;
  if (dup) throw new ConflictError('Projektet har redan ett bidrag');
  await ensureAccounts(sql, actor.companyId);
  const [r] = await sql<{ id: number }[]>`INSERT INTO company_grants ${sql({
    company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Namn', max: 200 }), grantor: str(input, 'grantor', { required: true, label: 'Bidragsgivare', max: 200 }),
    reference: str(input, 'reference', { max: 100 }), project_id: projectId, amount: kronor(input.amount, 'beviljat belopp'), coverage_pct: pct,
    budget: kronor(input.budget, 'budget', false), period_from: from, period_to: to, conditions: str(input, 'conditions', { max: 2000 }),
  })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'company_grant', r.id);
  return r.id;
}

/** Utbetalning från bidragsgivaren: reglerar först upplupet bidrag (1791), resten blir förutbetalt (2975) */
export async function receive(actor: Actor, id: number, input: Record<string, unknown>) {
  const amount = kronor(input.amount, 'beloppet');
  const d = date(input, 'date', 'Datum', false) || today();
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Bankkontot ska vara 19xx');
  return sql.begin(async (tx) => {
    const g = await one(tx, actor.companyId, id, true);
    if (g.status !== 'active') throw new ConflictError('Bidraget är inte aktivt');
    if (g.received + amount > g.amount) throw new ValidationError('Utbetalningarna kan inte överstiga det beviljade beloppet');
    await ensureAccounts(tx, actor.companyId);
    const v = await createVoucher(tx, { actor, date: d, description: `Utbetalt bidrag ${g.name} (${g.grantor})`, lines: fromSigned(balanceLines({ received: g.received, recognized: g.recognized }, { received: g.received + amount, recognized: g.recognized }, bank)), sourceType: 'company_grant', sourceId: id, series: 'B' });
    await tx`INSERT INTO grant_events ${tx({ grant_id: id, date: d, kind: 'payment', amount, voucher_id: v.id })}`;
    await auditBy(tx, actor, 'payment', 'company_grant', id, { amount });
  });
}

/** Intäktsför bidragen per datumet i takt med kostnaderna (en verifikation per bidrag med förändring) */
export async function recognize(actor: Actor, input: Record<string, unknown>) {
  const at = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(91001, ${actor.companyId})`;
    const gs = (await load(tx, actor.companyId, undefined, true)).filter((g) => g.status === 'active' && g.period_from <= at);
    let n = 0, total = 0;
    for (const g of gs) {
      const [last] = await tx<{ d: string | null }[]>`SELECT to_char(MAX(e.date),'YYYY-MM-DD') AS d FROM grant_events e WHERE e.grant_id = ${g.id} AND e.kind = 'recognition' AND ${NOT_REVERSED}`;
      if (last.d && at < last.d) throw new ValidationError(`${g.name} är redan intäktsfört per ${last.d} – välj samma eller ett senare datum`);
      const c = (await costs(tx, actor.companyId, g, at)).reduce((s, x) => s + x.amount, 0);
      const target = earned(c, g.coverage_pct, g.amount);
      const delta = target - g.recognized;
      if (!delta) continue;
      await ensureAccounts(tx, actor.companyId);
      const v = await createVoucher(tx, { actor, date: at, description: `Bidrag ${g.name}: intäktsförs mot kostnader (${g.coverage_pct} % av ${(c / 100).toFixed(2).replace('.', ',')} kr)`,
        lines: fromSigned(balanceLines({ received: g.received, recognized: g.recognized }, { received: g.received, recognized: target })), sourceType: 'company_grant', sourceId: g.id });
      await tx`INSERT INTO grant_events ${tx({ grant_id: g.id, date: at, kind: 'recognition', amount: delta, voucher_id: v.id })}`;
      n++; total += delta;
    }
    await auditBy(tx, actor, 'recognize', 'company_grant', actor.companyId, { date: at, grants: n, total });
    return { count: n, total };
  });
}

/** Bedömning av återbetalningsrisken. Sannolik återbetalning: intäkten förs tillbaka och det utbetalda blir skuld (2976). */
export async function assessRisk(actor: Actor, id: number, input: Record<string, unknown>) {
  const risk = str(input, 'risk') as RiskLevel;
  if (!['none', 'possible', 'probable'].includes(risk)) throw new ValidationError('Välj bedömning');
  const note = str(input, 'risk_note', { max: 1000 });
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const g = await one(tx, actor.companyId, id, true);
    if (g.status !== 'active') throw new ConflictError('Bidraget är redan bedömt som återbetalningsskyldigt');
    if (risk === 'probable') {
      if (!note) throw new ValidationError('Beskriv varför återbetalning är sannolik');
      const lines = repaymentProvision(g.received, g.recognized);
      if (lines.length) {
        await ensureAccounts(tx, actor.companyId);
        const v = await createVoucher(tx, { actor, date: d, description: `Bidrag ${g.name}: återbetalning sannolik – intäkten förs tillbaka och utbetalt blir skuld`, lines: fromSigned(lines), sourceType: 'company_grant', sourceId: id });
        if (g.recognized) await tx`INSERT INTO grant_events ${tx({ grant_id: id, date: d, kind: 'recognition', amount: -g.recognized, voucher_id: v.id })}`;
        await tx`INSERT INTO grant_events ${tx({ grant_id: id, date: d, kind: 'provision', amount: g.received, voucher_id: v.id })}`;
      }
      await tx`UPDATE company_grants SET risk = 'probable', risk_note = ${note}, status = ${g.received ? 'repayable' : 'repaid'} WHERE id = ${id}`;
    } else {
      await tx`UPDATE company_grants SET risk = ${risk}, risk_note = ${note} WHERE id = ${id}`;
    }
    await auditBy(tx, actor, 'risk', 'company_grant', id, { risk });
  });
}

/** Återbetalning till bidragsgivaren: 2976 mot bank */
export async function repay(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum', false) || today();
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Bankkontot ska vara 19xx');
  return sql.begin(async (tx) => {
    const g = await one(tx, actor.companyId, id, true);
    if (g.status !== 'repayable') throw new ConflictError('Det finns ingen bokad återbetalningsskuld');
    const [p] = await tx<{ s: number }[]>`SELECT COALESCE(SUM(e.amount), 0)::float8 AS s FROM grant_events e WHERE e.grant_id = ${id} AND e.kind = 'provision' AND ${NOT_REVERSED}`;
    const left = p.s - g.repaid;
    if (left <= 0) throw new ConflictError('Skulden är redan återbetald');
    const v = await createVoucher(tx, { actor, date: d, description: `Återbetalt bidrag ${g.name} till ${g.grantor}`, lines: fromSigned([{ account: GRANT_REPAYABLE, amount: left }, { account: bank, amount: -left }]), sourceType: 'company_grant', sourceId: id, series: 'B' });
    await tx`INSERT INTO grant_events ${tx({ grant_id: id, date: d, kind: 'repayment', amount: left, voucher_id: v.id })}`;
    await tx`UPDATE company_grants SET status = 'repaid' WHERE id = ${id}`;
    await auditBy(tx, actor, 'repay', 'company_grant', id, { amount: left });
  });
}

export async function list(companyId: number, at = today()) {
  const gs = await load(sql, companyId);
  const out = [];
  for (const g of gs) {
    const c = (await costs(sql, companyId, g, at)).reduce((s, x) => s + x.amount, 0);
    out.push({ ...g, costs: c, earned: g.status === 'active' ? earned(c, g.coverage_pct, g.amount) : 0, ...balances(g.received, g.recognized) });
  }
  return out;
}

/** Rapport till bidragsgivaren för en period */
export async function report(companyId: number, id: number, from?: string, to?: string) {
  const g = await one(sql, companyId, id);
  const f = from && from > g.period_from ? from : g.period_from;
  const t = to && to < g.period_to ? to : g.period_to;
  const byAccount = await costs(sql, companyId, g, t, f);
  const all = (await costs(sql, companyId, g, t)).reduce((s, x) => s + x.amount, 0);
  const events = await sql<{ date: string; kind: string; amount: number }[]>`SELECT to_char(e.date,'YYYY-MM-DD') AS date, e.kind, e.amount::float8 AS amount FROM grant_events e
    WHERE e.grant_id = ${id} AND ${NOT_REVERSED} ORDER BY e.date, e.id`;
  const total = grantReport({ costsByAccount: [{ account: 0, name: '', amount: all }], coveragePct: g.coverage_pct, cap: g.amount, received: g.received, budget: g.budget });
  return { grant: g, from: f, to: t, byAccount, periodCosts: byAccount.reduce((s, x) => s + x.amount, 0), total, events };
}
