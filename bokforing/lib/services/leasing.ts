import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { today } from '@/lib/format';
import { parseAmount } from '@/lib/money';
import { ASSET_CATEGORIES } from '@/lib/assets';
import {
  addLeaseMonths, ASSET_ACCOUNT, COST_ACCOUNT, financialPaymentLines, financialStartLines, INPUT_VAT, INTEREST, LEASE_DEBT, maturity, operationalLines,
  presentValue, schedule, suggestClass, type LeaseKind,
} from '@/lib/leasing';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';

const KINDS: LeaseKind[] = ['car', 'machine', 'it', 'premises', 'other'];
const ASSET_CAT: Record<LeaseKind, keyof typeof ASSET_CATEGORIES> = { car: 'bilar', machine: 'maskiner', it: 'datorer', premises: 'inventarier', other: 'inventarier' };
function kronor(input: Record<string, unknown>, k: string, label: string, required = false) {
  const raw = String(input[k] ?? '').trim();
  if (!raw) { if (required) throw new ValidationError(`Ange ${label.toLowerCase()}`); return null; }
  const v = parseAmount(raw);
  if (v == null || v < 0) throw new ValidationError(`Ange ${label.toLowerCase()} i kronor`);
  return v;
}
const lastDay = (p: string) => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const payDate = (start: string, period: string) => { const d = Math.min(Number(start.slice(8, 10)), Number(lastDay(period).slice(8, 10))); return `${period}-${String(d).padStart(2, '0')}`; };

interface Contract { id: number; company_id: number; name: string; kind: LeaseKind; lessor: string; start_date: string; months: number; fee: number; vat_rate: number; residual: number; rate_pct: number;
  fair_value: number | null; life_months: number | null; transfer: boolean; treatment: 'operational' | 'financial'; bank_account: number; pv: number | null; ended_on: string | null }
const COLS = sql`id, company_id, name, kind, lessor, to_char(start_date,'YYYY-MM-DD') AS start_date, months, fee::float8 AS fee, vat_rate, residual::float8 AS residual, rate_pct::float8 AS rate_pct,
  fair_value::float8 AS fair_value, life_months, transfer, treatment, bank_account, pv::float8 AS pv, to_char(ended_on,'YYYY-MM-DD') AS ended_on`;

async function ensureAccounts(companyId: number) {
  const rows: [number, string][] = [[5615, 'Leasing av personbilar'], [5220, 'Hyra av inventarier och verktyg'], [5010, 'Lokalhyra'], [INPUT_VAT, 'Ingående moms'],
    [LEASE_DEBT, 'Leasingskuld (finansiell leasing)'], [INTEREST, 'Räntekostnader för långfristiga skulder']];
  for (const [n, name] of rows) await sql`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${n}, ${name}) ON CONFLICT DO NOTHING`;
}

/** Klassningsförslag utan att spara (visas i formuläret) */
export function classify(input: { months: number; fee: number; ratePct: number; residual: number; lifeMonths: number | null; fairValue: number | null; transfer: boolean }) {
  const pv = presentValue({ fee: input.fee, months: input.months, ratePct: input.ratePct, residual: input.residual });
  return { pv, ...suggestClass({ months: input.months, lifeMonths: input.lifeMonths, pv, fairValue: input.fairValue, transfer: input.transfer }) };
}

export async function createContract(actor: Actor, input: Record<string, unknown>) {
  const kind = str(input, 'kind') as LeaseKind;
  if (!KINDS.includes(kind)) throw new ValidationError('Välj typ av leasing');
  const months = int(input, 'months', 'Löptid (månader)');
  if (months < 1 || months > 360) throw new ValidationError('Löptiden ska vara 1–360 månader');
  const fee = kronor(input, 'fee', 'Månadsavgift', true)!;
  if (!fee) throw new ValidationError('Månadsavgiften ska vara större än noll');
  const vatRate = Number(input.vat_rate ?? 25);
  if (![0, 6, 12, 25].includes(vatRate)) throw new ValidationError('Ogiltig momssats');
  const ratePct = Number(String(input.rate_pct ?? '0').replace(',', '.')) || 0;
  if (ratePct < 0 || ratePct >= 100) throw new ValidationError('Ogiltig ränta');
  const residual = kronor(input, 'residual', 'Restvärde') ?? 0;
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Bankkontot ska vara 19xx');
  const treatment = str(input, 'treatment') === 'financial' ? 'financial' : 'operational';
  const [c] = await sql<{ f: string }[]>`SELECT accounting_framework AS f FROM companies WHERE id = ${actor.companyId}`;
  if (treatment === 'financial' && c.f !== 'K3') throw new ValidationError('Finansiell leasing redovisas bara enligt K3 – i K2 är all leasing operationell');
  if (treatment === 'financial' && !(ratePct > 0)) throw new ValidationError('Ange räntan i avtalet (implicit ränta) för finansiell leasing');
  const start = date(input, 'start_date', 'Startdatum');
  const pv = presentValue({ fee, months, ratePct, residual });
  await ensureAccounts(actor.companyId);
  return sql.begin(async (tx) => {
    const [r] = await tx<{ id: number }[]>`INSERT INTO leasing_contracts ${tx({
      company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Benämning', max: 200 }), kind, lessor: str(input, 'lessor', { max: 200 }), start_date: start, months, fee,
      vat_rate: vatRate, residual, rate_pct: ratePct, fair_value: kronor(input, 'fair_value', 'Verkligt värde'), life_months: optInt(input, 'life_months', 'Ekonomisk livslängd'),
      transfer: input.transfer === 'on', treatment, bank_account: bank, pv, created_by: actor.userId,
    })} RETURNING id`;
    if (treatment === 'financial') {
      const cat = ASSET_CATEGORIES[ASSET_CAT[kind]];
      for (const [n, name] of [[cat.asset, cat.names[0]], [cat.accDep, cat.names[1]], [cat.dep, cat.names[2]]] as const) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n}, ${name}) ON CONFLICT DO NOTHING`;
      const v = await createVoucher(tx, { actor, date: start, description: `Finansiell leasing: ${str(input, 'name')} (nuvärde av avgifterna)`, lines: fromSigned(financialStartLines(pv, kind).map((l) => l.account === ASSET_ACCOUNT[kind] ? { ...l, account: cat.asset } : l)), sourceType: 'leasing', sourceId: r.id });
      // Avskrivning över löptiden (eller livslängden om tillgången övertas)
      const life = input.transfer === 'on' ? (optInt(input, 'life_months', 'Ekonomisk livslängd') ?? months) : months;
      const [a] = await tx<{ id: number }[]>`INSERT INTO assets ${tx({ company_id: actor.companyId, name: `Leasad: ${str(input, 'name')}`, category: ASSET_CAT[kind], asset_account: cat.asset, acc_dep_account: cat.accDep, dep_account: cat.dep,
        acquired_on: start, cost: pv, residual: 0, life_months: life, dep_start: `${start.slice(0, 7)}-01`, notes: 'Finansiell leasing (K3 kap. 20)', created_by: actor.userId, source_voucher_id: v.id })} RETURNING id`;
      await tx`UPDATE leasing_contracts SET asset_id = ${a.id}, start_voucher_id = ${v.id} WHERE id = ${r.id}`;
    }
    await auditBy(tx, actor, 'create', 'leasing', r.id, { treatment, pv });
    return r.id;
  });
}

/** Bokför förfallna leasingavgifter till och med en månad (en verifikation per avtal och månad) */
export async function bookDue(actor: Actor, upTo: string, contractId?: number, until?: string) {
  if (!/^\d{4}-\d{2}$/.test(upTo)) throw new ValidationError('Ange månad som ÅÅÅÅ-MM');
  const contracts = await sql<Contract[]>`SELECT ${COLS} FROM leasing_contracts WHERE company_id = ${actor.companyId} ${contractId ? sql`AND id = ${contractId}` : sql``} AND ended_on IS NULL ORDER BY id`;
  let n = 0;
  for (const c of contracts) {
    const plan = c.treatment === 'financial' ? schedule({ fee: c.fee, months: c.months, ratePct: c.rate_pct, residual: c.residual, start: c.start_date }) : null;
    for (let i = 0; i < c.months; i++) {
      const p = addLeaseMonths(c.start_date.slice(0, 7), i);
      if (p > upTo || (until && payDate(c.start_date, p) > until)) break;
      const done = await sql.begin(async (tx) => {
        const claimed = await tx`INSERT INTO leasing_postings (contract_id, period) VALUES (${c.id}, ${p}) ON CONFLICT DO NOTHING RETURNING period`;
        if (!claimed.length) return false;
        const lines = plan ? financialPaymentLines(plan[i], { vatRate: c.vat_rate, kind: c.kind, bank: c.bank_account, fee: c.fee })
          : operationalLines({ fee: c.fee + (i === c.months - 1 ? c.residual : 0), vatRate: c.vat_rate, kind: c.kind, bank: c.bank_account });
        const v = await createVoucher(tx, { actor, date: payDate(c.start_date, p), description: `Leasingavgift ${c.name} ${p}${c.lessor ? ` (${c.lessor})` : ''}`, lines: fromSigned(lines), sourceType: 'leasing', sourceId: c.id });
        await tx`UPDATE leasing_postings SET voucher_id = ${v.id} WHERE contract_id = ${c.id} AND period = ${p}`;
        return true;
      });
      if (done) n++;
    }
  }
  if (contracts.length) await auditBy(sql, actor, 'book', 'leasing', actor.companyId, { upTo, vouchers: n });
  return n;
}

/** Daglig körning: bokför årets förfallna avgifter för alla bolag (stängda perioder hoppas över) */
export async function bookDueAll() {
  const p = today().slice(0, 7);
  let n = 0;
  for (const r of await sql<{ company_id: number; user_id: number }[]>`SELECT DISTINCT ON (l.company_id) l.company_id, m.user_id FROM leasing_contracts l
      JOIN memberships m ON m.company_id = l.company_id AND m.role = 'owner' WHERE l.ended_on IS NULL ORDER BY l.company_id, m.user_id`) {
    n += await bookDue({ companyId: r.company_id, userId: r.user_id, apiKeyId: null, role: 'owner' }, p, undefined, today()).catch((e) => { console.error('leasing', r.company_id, e instanceof Error ? e.message : e); return 0; });
  }
  return n;
}

export async function endContract(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'ended_on', 'Avslutat', false) || today();
  const r = await sql`UPDATE leasing_contracts SET ended_on = ${d} WHERE id = ${id} AND company_id = ${actor.companyId} AND ended_on IS NULL RETURNING id`;
  if (!r.length) throw new NotFoundError('Leasingavtalet');
  await auditBy(sql, actor, 'end', 'leasing', id, { date: d });
}

/** Framtida avgifter per förfallotid för operationella avtal (not) */
export async function leasingNote(companyId: number, at: string) {
  const cs = await sql<Contract[]>`SELECT ${COLS} FROM leasing_contracts WHERE company_id = ${companyId} AND treatment = 'operational' AND (ended_on IS NULL OR ended_on > ${at}) AND start_date <= ${at}`;
  const m = maturity(cs.map((c) => ({ fee: c.fee, residual: c.residual, start: c.start_date, months: c.months })), at);
  const t0 = at.slice(0, 4);
  const [{ cost }] = await sql<{ cost: number }[]>`SELECT COALESCE(SUM(l.debit - l.credit), 0)::float8 AS cost FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND v.source_type = 'leasing' AND v.date BETWEEN ${`${t0}-01-01`} AND ${at} AND l.account_number = ANY(${[...new Set(Object.values(COST_ACCOUNT))]})`;
  return { ...m, yearCost: cost };
}

export async function overview(companyId: number) {
  const cs = await sql<(Contract & { booked: number; asset_id: number | null })[]>`SELECT ${COLS}, asset_id, (SELECT COUNT(*)::int FROM leasing_postings p WHERE p.contract_id = leasing_contracts.id) AS booked
    FROM leasing_contracts WHERE company_id = ${companyId} ORDER BY ended_on NULLS FIRST, start_date`;
  const t = today();
  const rows = cs.map((c) => {
    const plan = c.treatment === 'financial' ? schedule({ fee: c.fee, months: c.months, ratePct: c.rate_pct, residual: c.residual, start: c.start_date }) : null;
    const debt = plan ? (c.booked ? plan[c.booked - 1].balance : (c.pv ?? 0)) : null;
    return { ...c, debt, end: addLeaseMonths(c.start_date.slice(0, 7), c.months - 1), suggestion: suggestClass({ months: c.months, lifeMonths: c.life_months, pv: c.pv ?? 0, fairValue: c.fair_value, transfer: c.transfer }) };
  });
  const [fw] = await sql<{ f: string }[]>`SELECT accounting_framework AS f FROM companies WHERE id = ${companyId}`;
  return { rows, note: await leasingNote(companyId, t), framework: fw.f };
}
