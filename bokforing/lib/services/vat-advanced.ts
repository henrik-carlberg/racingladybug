import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, createVoucher, fiscalYearFor } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { checkVat } from '@/lib/server/vies';
import { adjustment, adjustmentLines, CORRECTION_YEARS, deductionShare, parseVatNumber, proportionLines, type InvestmentKind, type ProportionVoucher } from '@/lib/vat-advanced';
import type { Actor } from './actor';
import { date, int, str } from './input';

const pctOf = (v: unknown, label: string) => {
  const n = Number(String(v ?? '').replace(',', '.').trim());
  if (!(n >= 0 && n <= 100)) throw new ValidationError(`Ange ${label} i procent (0–100)`);
  return n;
};

/** Avdragsandel: sparad eller beräknad på räkenskapsårets omsättning (momspliktig 3000–3699 utom 3004, momsfri 3004) */
export async function settings(companyId: number, at = today()) {
  const [c] = await sql<{ pct: number | null; accounts: number[] }[]>`SELECT vat_deduction_pct::float8 AS pct, common_cost_accounts AS accounts FROM companies WHERE id = ${companyId}`;
  const fy = await fiscalYearFor(sql, companyId, at);
  let taxable = 0, exempt = 0;
  if (fy) for (const [n, v] of await accountSums(companyId, fy.start_date, fy.end_date)) {
    if (n === 3004) exempt -= Number(v); else if (n >= 3000 && n <= 3699) taxable -= Number(v);
  }
  const suggested = deductionShare(taxable, exempt);
  return { pct: c?.pct ?? null, effective: c?.pct ?? suggested, suggested, taxable, exempt, accounts: c?.accounts ?? [] };
}

export async function saveSettings(actor: Actor, input: Record<string, unknown>) {
  const raw = String(input.pct ?? '').trim();
  const pct = raw ? pctOf(raw, 'avdragsandelen') : null;
  const accounts = [...new Set(String(input.accounts ?? '').split(/[\s,;]+/).filter(Boolean).map(Number))];
  if (accounts.some((a) => !(Number.isInteger(a) && a >= 4000 && a <= 7999))) throw new ValidationError('Gemensamma kostnader anges som kostnadskonton (4000–7999), t.ex. 5010, 6110');
  await sql`UPDATE companies SET vat_deduction_pct = ${pct}, common_cost_accounts = ${sql.array(accounts)}::int[] WHERE id = ${actor.companyId}`;
  await auditBy(sql, actor, 'vat_settings', 'company', actor.companyId, { pct, accounts });
}

async function periodVouchers(companyId: number, from: string, to: string): Promise<ProportionVoucher[]> {
  const rows = await sql<{ voucher_id: number; account: number; amount: number }[]>`
    SELECT l.voucher_id, l.account_number AS account, SUM(l.debit - l.credit)::float8 AS amount
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND v.date BETWEEN ${from} AND ${to} AND COALESCE(v.source_type, '') NOT IN ('vat_proportion', 'reversal')
      AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = v.id)
      AND EXISTS (SELECT 1 FROM voucher_lines x WHERE x.voucher_id = v.id AND x.account_number = 2641 AND x.debit > 0)
      AND (l.account_number = 2641 OR l.account_number BETWEEN 4000 AND 7999)
    GROUP BY l.voucher_id, l.account_number`;
  const by = new Map<number, ProportionVoucher>();
  for (const r of rows) {
    const v = by.get(r.voucher_id) ?? { vat: 0, costs: [] };
    if (r.account === 2641) v.vat += r.amount; else v.costs.push({ account: r.account, amount: r.amount });
    by.set(r.voucher_id, v);
  }
  return [...by.values()];
}

export async function proportionPreview(companyId: number, from: string, to: string) {
  const s = await settings(companyId, to);
  return { ...s, ...proportionLines(await periodVouchers(companyId, from, to), s.accounts, s.effective) };
}

/** Bokför den ej avdragsgilla delen av periodens gemensamma ingående moms (en gång per period) */
export async function bookProportion(actor: Actor, input: Record<string, unknown>) {
  const from = date(input, 'from', 'Från'), to = date(input, 'to', 'Till');
  if (to < from) throw new ValidationError('Perioden slutar före den börjar');
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(101001, ${actor.companyId})`;
    const [dup] = await tx`SELECT 1 FROM vat_proportion_runs WHERE company_id = ${actor.companyId} AND period_to >= ${from} AND period_from <= ${to}
      AND (voucher_id IS NULL OR NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = vat_proportion_runs.voucher_id))`;
    if (dup) throw new ConflictError('Perioden överlappar en redan bokförd proportionering');
    const p = await proportionPreview(actor.companyId, from, to);
    if (!p.accounts.length) throw new ValidationError('Ange vilka konton som har gemensamma kostnader');
    if (!p.nonDeductible) throw new ValidationError('Ingen gemensam ingående moms att proportionera i perioden');
    const v = await createVoucher(tx, { actor, date: to, description: `Proportionering av gemensam ingående moms ${from} – ${to} (avdrag ${p.effective} %)`, lines: fromSigned(p.lines), sourceType: 'vat_proportion' });
    await tx`INSERT INTO vat_proportion_runs ${tx({ company_id: actor.companyId, period_from: from, period_to: to, pct: p.effective, common_vat: p.commonVat, non_deductible: p.nonDeductible, voucher_id: v.id })}`;
    await auditBy(tx, actor, 'vat_proportion', 'company', actor.companyId, { from, to, amount: p.nonDeductible });
    return p;
  });
}

export async function runs(companyId: number) {
  return sql<{ period_from: string; period_to: string; pct: number; common_vat: number; non_deductible: number; voucher_id: number | null }[]>`
    SELECT to_char(period_from,'YYYY-MM-DD') AS period_from, to_char(period_to,'YYYY-MM-DD') AS period_to, pct::float8 AS pct, common_vat::float8 AS common_vat, non_deductible::float8 AS non_deductible, voucher_id
    FROM vat_proportion_runs WHERE company_id = ${companyId} ORDER BY period_from DESC`;
}

// ---------- Jämkning ----------
export async function addInvestment(actor: Actor, input: Record<string, unknown>) {
  const kind = str(input, 'kind') === 'inventarie' ? 'inventarie' : 'fastighet';
  const vat = parseAmount(String(input.vat_amount ?? ''));
  if (vat == null || vat <= 0) throw new ValidationError('Ange den ingående momsen i kronor');
  const [r] = await sql<{ id: number }[]>`INSERT INTO vat_investments ${sql({ company_id: actor.companyId, description: str(input, 'description', { required: true, label: 'Beskrivning', max: 300 }),
    kind, completed_on: date(input, 'completed_on', 'Färdigställd'), vat_amount: vat, orig_pct: pctOf(input.orig_pct, 'avdragsandel vid investeringen') })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'vat_investment', r.id);
  return r.id;
}

/** Årets jämkning för en investering utifrån ny användning; bokförs per räkenskapsårets sista dag */
export async function adjust(actor: Actor, id: number, input: Record<string, unknown>) {
  const year = int(input, 'year', 'År');
  const newPct = pctOf(input.new_pct, 'ny avdragsandel');
  return sql.begin(async (tx) => {
    const [i] = await tx<{ description: string; kind: InvestmentKind; completed: string; vat: number; orig: number }[]>`SELECT description, kind, to_char(completed_on,'YYYY-MM-DD') AS completed,
      vat_amount::float8 AS vat, orig_pct::float8 AS orig FROM vat_investments WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!i) throw new NotFoundError('Investeringen');
    const [dup] = await tx`SELECT 1 FROM vat_adjustments a WHERE a.investment_id = ${id} AND a.year = ${year}
      AND (a.voucher_id IS NULL OR NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = a.voucher_id))`;
    if (dup) throw new ConflictError(`Jämkningen för ${year} är redan gjord`);
    const a = adjustment({ vat: i.vat, kind: i.kind, completedYear: Number(i.completed.slice(0, 4)), origPct: i.orig }, year, newPct);
    if (!a.amount) throw new ValidationError(`Ingen jämkning: ${a.reason.toLowerCase()}`);
    const fy = await fiscalYearFor(tx, actor.companyId, `${year}-12-31`) ?? await fiscalYearFor(tx, actor.companyId, `${year}-06-30`);
    if (!fy) throw new ValidationError(`Det finns inget räkenskapsår för ${year}`);
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, 3999, 'Övriga rörelseintäkter'), (${actor.companyId}, 7999, 'Övriga rörelsekostnader') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: fy.end_date, description: `Jämkning av ingående moms ${year}: ${i.description} (${a.reason.toLowerCase()})`, lines: fromSigned(adjustmentLines(a.amount)), sourceType: 'vat_adjustment', sourceId: id });
    await tx`DELETE FROM vat_adjustments WHERE investment_id = ${id} AND year = ${year}`;
    await tx`INSERT INTO vat_adjustments ${tx({ investment_id: id, year, new_pct: newPct, amount: a.amount, voucher_id: v.id })}`;
    await auditBy(tx, actor, 'vat_adjustment', 'vat_investment', id, { year, amount: a.amount });
    return a;
  });
}

export async function investments(companyId: number) {
  const rows = await sql<{ id: number; description: string; kind: InvestmentKind; completed_on: string; vat_amount: number; orig_pct: number }[]>`
    SELECT id, description, kind, to_char(completed_on,'YYYY-MM-DD') AS completed_on, vat_amount::float8 AS vat_amount, orig_pct::float8 AS orig_pct FROM vat_investments WHERE company_id = ${companyId} ORDER BY completed_on DESC`;
  const adj = rows.length ? await sql<{ investment_id: number; year: number; new_pct: number; amount: number }[]>`SELECT investment_id, year, new_pct::float8 AS new_pct, amount::float8 AS amount FROM vat_adjustments
    WHERE investment_id IN ${sql(rows.map((r) => r.id))} ORDER BY year` : [];
  return rows.map((r) => ({ ...r, years: CORRECTION_YEARS[r.kind], lastYear: Number(r.completed_on.slice(0, 4)) + CORRECTION_YEARS[r.kind] - 1, adjustments: adj.filter((a) => a.investment_id === r.id) }));
}

// ---------- VIES ----------
export async function viesCheck(actor: Actor, customerId: number) {
  const [c] = await sql<{ vat_number: string }[]>`SELECT vat_number FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  if (!c) throw new NotFoundError('Kunden');
  const p = parseVatNumber(c.vat_number ?? '');
  if (!p) throw new ValidationError('Kunden saknar ett giltigt EU-momsregistreringsnummer (t.ex. DE123456789)');
  const r = await checkVat(p.country, p.number);
  await sql`UPDATE customers SET vies_valid = ${r.valid}, vies_name = ${r.name}, vies_checked_at = now() WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  await auditBy(sql, actor, 'vies', 'customer', customerId, { valid: r.valid });
  return { ...r, number: p.full };
}
