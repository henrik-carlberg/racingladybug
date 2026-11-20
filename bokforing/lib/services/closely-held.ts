import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { defaultParams, k10 } from '@/lib/k10';
import { CAPITAL_INSURANCE, INSURANCE_WRITEDOWN, insuranceWritedown, savedSpaceFor, yieldTax } from '@/lib/closely-held';
import type { Actor } from './actor';
import { date, optInt, str } from './input';
import { k10Basis, listOwners } from './owners';

function kronor(v: unknown, label: string, allowZero = false) {
  const n = parseAmount(String(v ?? '').trim());
  if (n == null || n < 0 || (!allowZero && n === 0)) throw new ValidationError(`Ange ${label} i kronor`);
  return n;
}

export async function history(companyId: number) {
  return sql<{ owner_id: number; year: number; rule: string; limit_amount: number; dividends: number; saved_next: number; saved_at: string }[]>`
    SELECT h.owner_id, h.year, h.rule, h.limit_amount::float8 AS limit_amount, h.dividends::float8 AS dividends, h.saved_next::float8 AS saved_next, to_char(h.saved_at,'YYYY-MM-DD') AS saved_at
    FROM k10_history h JOIN company_owners o ON o.id = h.owner_id WHERE o.company_id = ${companyId} ORDER BY h.owner_id, h.year`;
}

/** K10 per ägare för ett inkomstår, med sparat utrymme hämtat från förra årets sparade K10 */
export async function k10Year(companyId: number, year: number) {
  const owners = await listOwners(companyId);
  const hist = await history(companyId);
  const p = defaultParams(year);
  return Promise.all(owners.map(async (o) => {
    const basis = await k10Basis(companyId, year, o);
    const saved = savedSpaceFor(year, hist.filter((h) => h.owner_id === o.id), o.saved_space);
    const r = k10(p, { share: o.share_pct, costBasis: o.cost_basis, savedSpace: saved.amount, ...basis });
    return { o, basis, saved, r, stored: hist.find((h) => h.owner_id === o.id && h.year === year) ?? null, history: hist.filter((h) => h.owner_id === o.id) };
  }));
}

/** Sparar årets K10 för ägarna – nästa år räknas det sparade utdelningsutrymmet från den */
export async function saveK10(actor: Actor, year: number) {
  if (!(Number.isInteger(year) && year >= 2000 && year <= 2100)) throw new ValidationError('Ogiltigt år');
  const rows = await k10Year(actor.companyId, year);
  if (!rows.length) throw new ValidationError('Lägg upp ägarna först');
  await sql.begin(async (tx) => {
    for (const { o, r, basis, saved } of rows) {
      await tx`INSERT INTO k10_history ${tx({ owner_id: o.id, year, rule: r.rule, limit_amount: r.limit, dividends: basis.dividends, saved_next: r.savedNext,
        data: tx.json({ basic: r.basic, capital: r.capital, wageBased: r.wageBased, savedIn: saved.amount, wages: basis.wages, ownSalary: basis.ownSalary }), saved_by: actor.userId })}
        ON CONFLICT (owner_id, year) DO UPDATE SET rule = EXCLUDED.rule, limit_amount = EXCLUDED.limit_amount, dividends = EXCLUDED.dividends, saved_next = EXCLUDED.saved_next,
          data = EXCLUDED.data, saved_by = EXCLUDED.saved_by, saved_at = now()`;
    }
    await auditBy(tx, actor, 'k10', 'company', actor.companyId, { year, owners: rows.length });
  });
  return rows.length;
}

// ---------- Kapitalförsäkring ----------
const NOT_REVERSED = sql`NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = e.voucher_id)`;

async function own(companyId: number, id: number) {
  const [i] = await sql<{ id: number; name: string }[]>`SELECT id, name FROM capital_insurances WHERE id = ${id} AND company_id = ${companyId}`;
  if (!i) throw new NotFoundError('Kapitalförsäkringen');
  return i;
}

export async function createInsurance(actor: Actor, input: Record<string, unknown>) {
  const [r] = await sql<{ id: number }[]>`INSERT INTO capital_insurances ${sql({ company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Namn', max: 200 }),
    insurer: str(input, 'insurer', { max: 200 }), policy_no: str(input, 'policy_no', { max: 60 }), pledged: str(input, 'pledged', { max: 300 }) })} RETURNING id`;
  await sql`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${CAPITAL_INSURANCE}, 'Värde av kapitalförsäkring'), (${actor.companyId}, ${INSURANCE_WRITEDOWN}, 'Nedskrivning av kapitalförsäkring') ON CONFLICT DO NOTHING`;
  await auditBy(sql, actor, 'create', 'capital_insurance', r.id);
  return r.id;
}

/** Premie: 1385 mot bank (inte avdragsgill – försäkringen är en tillgång) */
export async function premium(actor: Actor, id: number, input: Record<string, unknown>) {
  const ins = await own(actor.companyId, id);
  const amount = kronor(input.amount, 'premien');
  const d = date(input, 'date', 'Datum', false) || today();
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Bankkontot ska vara 19xx');
  await sql.begin(async (tx) => {
    const v = await createVoucher(tx, { actor, date: d, description: `Premie kapitalförsäkring ${ins.name}`, lines: fromSigned([{ account: CAPITAL_INSURANCE, amount }, { account: bank, amount: -amount }]), sourceType: 'capital_insurance', sourceId: id, series: 'B' });
    await tx`INSERT INTO capital_insurance_events ${tx({ insurance_id: id, date: d, kind: 'premium', amount, voucher_id: v.id })}`;
    await auditBy(tx, actor, 'premium', 'capital_insurance', id, { amount });
  });
}

/** Försäkringens värde enligt försäkringsbolaget. Värde under bokfört värde (bestående nedgång) skrivs ned mot 8270. */
export async function registerValue(actor: Actor, id: number, input: Record<string, unknown>) {
  const ins = await own(actor.companyId, id);
  const value = kronor(input.value, 'värdet', true);
  const d = date(input, 'date', 'Datum', false) || today();
  const write = input.writedown === 'on' || input.writedown === true;
  return sql.begin(async (tx) => {
    await tx`SELECT id FROM capital_insurances WHERE id = ${id} FOR UPDATE`;
    // Värden registreras i datumordning – en äldre värdering får inte skriva ned en förlust som redan är nedskriven
    const [last] = await tx<{ d: string | null }[]>`SELECT to_char(MAX(e.date),'YYYY-MM-DD') AS d FROM capital_insurance_events e WHERE e.insurance_id = ${id} AND e.kind IN ('value','writedown') AND (e.voucher_id IS NULL OR ${NOT_REVERSED})`;
    if (last.d && d < last.d) throw new ValidationError(`Det finns redan en värdering per ${last.d} – ange ett senare datum`);
    await tx`INSERT INTO capital_insurance_events ${tx({ insurance_id: id, date: d, kind: 'value', amount: value })}`;
    const [b] = await tx<{ booked: number }[]>`SELECT COALESCE(SUM(CASE WHEN e.kind = 'premium' THEN e.amount WHEN e.kind = 'writedown' THEN -e.amount ELSE 0 END), 0)::float8 AS booked
      FROM capital_insurance_events e WHERE e.insurance_id = ${id} AND (e.voucher_id IS NULL OR ${NOT_REVERSED})`;
    const wd = insuranceWritedown(b.booked, value);
    if (write && wd > 0) {
      const v = await createVoucher(tx, { actor, date: d, description: `Nedskrivning kapitalförsäkring ${ins.name} till ${(value / 100).toFixed(2).replace('.', ',')} kr`, lines: fromSigned([{ account: INSURANCE_WRITEDOWN, amount: wd }, { account: CAPITAL_INSURANCE, amount: -wd }]), sourceType: 'capital_insurance', sourceId: id });
      await tx`INSERT INTO capital_insurance_events ${tx({ insurance_id: id, date: d, kind: 'writedown', amount: wd, voucher_id: v.id })}`;
    }
    await auditBy(tx, actor, 'value', 'capital_insurance', id, { value, writedown: write ? wd : 0 });
    return { writedown: write ? wd : 0, possible: wd };
  });
}

export async function insurances(companyId: number, year: number) {
  const list = await sql<{ id: number; name: string; insurer: string; policy_no: string; pledged: string }[]>`SELECT id, name, insurer, policy_no, pledged FROM capital_insurances WHERE company_id = ${companyId} ORDER BY id`;
  const slr = defaultParams(year).slr;
  const out = [];
  for (const i of list) {
    const ev = await sql<{ date: string; kind: string; amount: number }[]>`SELECT to_char(e.date,'YYYY-MM-DD') AS date, e.kind, e.amount::float8 AS amount FROM capital_insurance_events e
      WHERE e.insurance_id = ${i.id} AND (e.voucher_id IS NULL OR ${NOT_REVERSED}) ORDER BY e.date, e.id`;
    const booked = ev.reduce((s, e) => s + (e.kind === 'premium' ? e.amount : e.kind === 'writedown' ? -e.amount : 0), 0);
    const jan1 = `${year}-01-01`;
    const values = ev.filter((e) => e.kind === 'value');
    const lastBefore = [...values].filter((e) => e.date <= jan1).pop();
    const bookedJan1 = ev.filter((e) => e.date < jan1).reduce((s, e) => s + (e.kind === 'premium' ? e.amount : e.kind === 'writedown' ? -e.amount : 0), 0);
    const inYear = ev.filter((e) => e.kind === 'premium' && e.date.startsWith(String(year)));
    const yt = yieldTax({ valueJan1: lastBefore?.amount ?? bookedJan1, premiumsH1: inYear.filter((e) => e.date < `${year}-07-01`).reduce((s, e) => s + e.amount, 0), premiumsH2: inYear.filter((e) => e.date >= `${year}-07-01`).reduce((s, e) => s + e.amount, 0), slr });
    const latest = values[values.length - 1] ?? null;
    out.push({ ...i, booked, latest, yieldTax: yt, slr, events: ev, possibleWritedown: latest ? insuranceWritedown(booked, latest.amount) : 0 });
  }
  return out;
}
