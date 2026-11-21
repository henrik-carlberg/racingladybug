import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, createVoucher, fiscalYearFor } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { COST_ACCOUNT, LIABILITY_ACCOUNT, monthlyShare, taxAdjustment, taxDepreciation, taxLines, TYPE_LABEL, yearlyTax, type PropertyType } from '@/lib/property-tax';
import type { Actor } from './actor';
import { date, str } from './input';

const kronor = (v: unknown, label: string) => { const s = String(v ?? '').trim(); if (!s) return 0; const n = parseAmount(s); if (n == null || n < 0) throw new ValidationError(`Ange ${label} i kronor`); return n; };

export async function addProperty(actor: Actor, input: Record<string, unknown>) {
  const type = str(input, 'type') as PropertyType;
  if (!TYPE_LABEL[type]) throw new ValidationError('Välj fastighetstyp');
  const rate = Number(String(input.building_rate ?? '4').replace(',', '.'));
  if (!(rate >= 0 && rate <= 5)) throw new ValidationError('Avskrivningssatsen för byggnaden är normalt 2–5 %');
  const apartments = Number(String(input.apartments ?? '0') || '0');
  if (!Number.isInteger(apartments) || apartments < 0 || apartments > 10000) throw new ValidationError('Ogiltigt antal lägenheter');
  const vy = String(input.value_year ?? '').trim();
  if (vy && !/^\d{4}$/.test(vy)) throw new ValidationError('Värdeåret anges med fyra siffror');
  try {
    const [r] = await sql<{ id: number }[]>`INSERT INTO tax_properties ${sql({ company_id: actor.companyId, designation: str(input, 'designation', { required: true, label: 'Fastighetsbeteckning', max: 200 }), type,
      tax_value: kronor(input.tax_value, 'taxeringsvärdet'), apartments, cap_per_apartment: kronor(input.cap_per_apartment, 'takbeloppet per lägenhet'), value_year: vy ? Number(vy) : null,
      acquired: date(input, 'acquired', 'Förvärvad'), building_cost: kronor(input.building_cost, 'byggnadens anskaffningsvärde'), building_rate: rate,
      improvement_cost: kronor(input.improvement_cost, 'markanläggningar'), land_cost: kronor(input.land_cost, 'mark') })} RETURNING id`;
    await auditBy(sql, actor, 'create', 'tax_property', r.id);
    return r.id;
  } catch (e) {
    if (String((e as Error).message).includes('tax_properties_company_id_designation_key')) throw new ConflictError('Fastigheten finns redan');
    throw e;
  }
}

type Prop = { id: number; designation: string; type: PropertyType; tax_value: number; apartments: number; cap_per_apartment: number; value_year: number | null; acquired: string;
  building_cost: number; building_rate: number; improvement_cost: number; land_cost: number };
const COLS = sql`id, designation, type, tax_value::float8 AS tax_value, apartments, cap_per_apartment::float8 AS cap_per_apartment, value_year, to_char(acquired,'YYYY-MM-DD') AS acquired,
  building_cost::float8 AS building_cost, building_rate::float8 AS building_rate, improvement_cost::float8 AS improvement_cost, land_cost::float8 AS land_cost`;
const taxOf = (p: Prop, year: number) => yearlyTax({ type: p.type, taxValue: p.tax_value, apartments: p.apartments, capPerApartment: p.cap_per_apartment, valueYear: p.value_year }, year);

/** Skattemässiga avskrivningar år för år från förvärvet */
function depreciationFor(p: Prop, year: number) {
  const before = { building: 0, improvement: 0 };
  const ay = Number(p.acquired.slice(0, 4));
  for (let y = ay; y < year; y++) { const d = taxDepreciation({ buildingCost: p.building_cost, buildingRate: p.building_rate, improvementCost: p.improvement_cost, acquired: p.acquired }, y, before); before.building += d.building; before.improvement += d.improvement; }
  const d = taxDepreciation({ buildingCost: p.building_cost, buildingRate: p.building_rate, improvementCost: p.improvement_cost, acquired: p.acquired }, year, before);
  return { ...d, residualBuilding: p.building_cost - before.building - d.building, residualImprovement: p.improvement_cost - before.improvement - d.improvement };
}

/** Gjorda värdeminskningsavdrag (byggnad och markanläggningar) för åren före försäljningsåret */
export function taxDepreciationBefore(p: Prop, year: number) {
  let t = 0; const ay = Number(p.acquired.slice(0, 4));
  for (let y = ay; y < year; y++) t += depreciationFor(p, y).total;
  return t;
}

/** Fastigheten med bokförda värden från huvudboken (1110–1159) som förslag till försäljningen */
export async function propertyForSale(companyId: number, id: number) {
  const [p] = await sql<Prop[]>`SELECT ${COLS} FROM tax_properties WHERE id = ${id} AND company_id = ${companyId}`;
  if (!p) throw new NotFoundError('Fastigheten');
  // Anskaffningsvärdena tas från fastighetens egna uppgifter. Huvudbokens ackumulerade avskrivningar gäller hela bolaget och används
  // bara som förslag när bolaget har en enda fastighet kvar; annars får användaren ange dem
  const [{ n: unsold }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM tax_properties WHERE company_id = ${companyId} AND sold_on IS NULL`;
  let buildingDep = 0, improvementDep = 0;
  if (unsold === 1) {
    const rows = await sql<{ n: number; b: number }[]>`SELECT l.account_number AS n, SUM(l.debit - l.credit)::float8 AS b FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
      WHERE v.company_id = ${companyId} AND l.account_number IN (1119, 1159) GROUP BY l.account_number`;
    buildingDep = -(rows.find((r) => r.n === 1119)?.b ?? 0); improvementDep = -(rows.find((r) => r.n === 1159)?.b ?? 0);
  }
  return { p, single: unsold === 1, book: { building: p.building_cost, buildingDep, land: p.land_cost, improvement: p.improvement_cost, improvementDep } };
}

/** Bokför fastighetsskatten månad för månad till och med vald månad (månader som redan är bokförda hoppas över) */
export async function bookTax(actor: Actor, id: number, input: Record<string, unknown>) {
  const until = str(input, 'until');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(until)) throw new ValidationError('Välj månad');
  const year = Number(until.slice(0, 4)), last = Number(until.slice(5, 7));
  return sql.begin(async (tx) => {
    const [p] = await tx<Prop[]>`SELECT ${COLS} FROM tax_properties WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!p) throw new NotFoundError('Fastigheten');
    const yearly = taxOf(p, year).amount;
    if (!yearly) throw new ValidationError('Ingen fastighetsskatt eller fastighetsavgift för året');
    const booked = new Set((await tx<{ period: string }[]>`SELECT period FROM property_tax_postings WHERE property_id = ${id}`).map((r) => r.period));
    const acq = p.acquired.slice(0, 7);
    const [sold] = await tx<{ s: string | null }[]>`SELECT to_char(sold_on,'YYYY-MM') AS s FROM tax_properties WHERE id = ${id}`;
    const months = [];
    for (let m = 1; m <= last; m++) { const per = `${year}-${String(m).padStart(2, '0')}`; if (per >= acq && (!sold?.s || per <= sold.s) && !booked.has(per)) months.push({ per, amount: monthlyShare(yearly, m) }); }
    if (!months.length) throw new ConflictError('Månaderna är redan bokförda');
    const total = months.reduce((s, m) => s + m.amount, 0);
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${COST_ACCOUNT}, 'Fastighetsskatt och fastighetsavgift'), (${actor.companyId}, ${LIABILITY_ACCOUNT}, 'Beräknad fastighetsskatt och fastighetsavgift') ON CONFLICT DO NOTHING`;
    const end = new Date(Date.UTC(year, last, 0)).toISOString().slice(0, 10);
    const v = await createVoucher(tx, { actor, date: end, description: `Fastighetsskatt ${p.designation} ${months[0].per}${months.length > 1 ? ` – ${months[months.length - 1].per}` : ''}`, lines: fromSigned(taxLines(total)), sourceType: 'property_tax', sourceId: id });
    for (const m of months) await tx`INSERT INTO property_tax_postings (property_id, period, amount, voucher_id) VALUES (${id}, ${m.per}, ${m.amount}, ${v.id})`;
    await auditBy(tx, actor, 'property_tax', 'tax_property', id, { total, months: months.length });
    return { total, months: months.length };
  });
}

export async function overview(companyId: number, year: number) {
  const props = await sql<(Prop & { sold_on: string | null; sale: { price: number; result: number; bookValue: number; tax: { gain: number; recaptured: number; capital: number; adjustedBasis: number } } | null })[]>`SELECT ${COLS}, to_char(sold_on,'YYYY-MM-DD') AS sold_on, sale FROM tax_properties WHERE company_id = ${companyId} ORDER BY designation`;
  const rows = [];
  for (const p of props) {
    const [b] = await sql<{ b: number }[]>`SELECT COALESCE(SUM(amount), 0)::float8 AS b FROM property_tax_postings WHERE property_id = ${p.id} AND period LIKE ${`${year}-%`}`;
    const soldBefore = !!p.sold_on && Number(p.sold_on.slice(0, 4)) <= year;
    rows.push({ ...p, label: TYPE_LABEL[p.type], tax: taxOf(p, year), booked: b.b, dep: soldBefore ? { building: 0, improvement: 0, total: 0, months: 0, residualBuilding: 0, residualImprovement: 0 } : depreciationFor(p, year) });
  }
  const fy = await fiscalYearFor(sql, companyId, `${year}-12-31`) ?? await fiscalYearFor(sql, companyId, `${year}-06-30`);
  let bookedDep = 0;
  if (fy) for (const [n, v] of await accountSums(companyId, fy.start_date, fy.end_date)) if (n >= 7820 && n <= 7829) bookedDep += Number(v);
  const taxDep = rows.reduce((s, r) => s + r.dep.total, 0);
  return { year, rows, bookedDep, taxDep, adjustment: taxAdjustment(bookedDep, taxDep) };
}

/** Försäljning: bokförd vinst eller förlust och skattepliktig vinst med återförda värdeminskningsavdrag; fastigheten avslutas */
export async function sellProperty(actor: Actor, id: number, input: Record<string, unknown>) {
  const { saleLines, taxGain, GAIN, LOSS } = await import('@/lib/property-sale');
  const d = date(input, 'date', 'Tillträdesdag');
  const price = kronor(input.price, 'köpeskillingen');
  if (!price) throw new ValidationError('Ange köpeskillingen');
  const costs = kronor(input.costs, 'försäljningskostnader'), improvements = kronor(input.improvements, 'förbättringsutgifter');
  const book = { building: kronor(input.book_building, 'byggnadens anskaffningsvärde'), buildingDep: kronor(input.book_building_dep, 'ackumulerade avskrivningar byggnad'), land: kronor(input.book_land, 'mark'),
    improvement: kronor(input.book_improvement, 'markanläggningar'), improvementDep: kronor(input.book_improvement_dep, 'ackumulerade avskrivningar markanläggningar') };
  return sql.begin(async (tx) => {
    const [p] = await tx<(Prop & { sold_on: string | null })[]>`SELECT ${COLS}, to_char(sold_on,'YYYY-MM-DD') AS sold_on FROM tax_properties WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!p) throw new NotFoundError('Fastigheten');
    if (p.sold_on) throw new ConflictError('Fastigheten är redan såld');
    if (d < p.acquired) throw new ValidationError('Försäljningen kan inte ligga före förvärvet');
    const s = saleLines(price, costs, book);
    const tax = taxGain({ price, costs, acquisition: p.building_cost + p.improvement_cost + p.land_cost, improvements, taxDepreciation: taxDepreciationBefore(p, Number(d.slice(0, 4))) });
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${GAIN}, 'Vinst vid avyttring av byggnader och mark'), (${actor.companyId}, ${LOSS}, 'Förlust vid avyttring av byggnader och mark'),
      (${actor.companyId}, 1110, 'Byggnader'), (${actor.companyId}, 1119, 'Ackumulerade avskrivningar på byggnader'), (${actor.companyId}, 1130, 'Mark'), (${actor.companyId}, 1150, 'Markanläggningar'),
      (${actor.companyId}, 1159, 'Ackumulerade avskrivningar på markanläggningar') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: `Försäljning av fastigheten ${p.designation} (${s.result >= 0 ? 'vinst' : 'förlust'} ${(Math.abs(s.result) / 100).toLocaleString('sv-SE')} kr)`, lines: fromSigned(s.lines), sourceType: 'property_sale', sourceId: id });
    const sale = { price, costs, improvements, book, bookValue: s.bookValue, result: s.result, tax };
    await tx`UPDATE tax_properties SET sold_on = ${d}, sale = ${tx.json(sale as never)}, sale_voucher_id = ${v.id} WHERE id = ${id}`;
    await auditBy(tx, actor, 'property_sale', 'tax_property', id, { price, result: s.result });
    return sale;
  });
}
