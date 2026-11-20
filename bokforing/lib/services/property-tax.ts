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
    const months = [];
    for (let m = 1; m <= last; m++) { const per = `${year}-${String(m).padStart(2, '0')}`; if (per >= acq && !booked.has(per)) months.push({ per, amount: monthlyShare(yearly, m) }); }
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
  const props = await sql<Prop[]>`SELECT ${COLS} FROM tax_properties WHERE company_id = ${companyId} ORDER BY designation`;
  const rows = [];
  for (const p of props) {
    const [b] = await sql<{ b: number }[]>`SELECT COALESCE(SUM(amount), 0)::float8 AS b FROM property_tax_postings WHERE property_id = ${p.id} AND period LIKE ${`${year}-%`}`;
    rows.push({ ...p, label: TYPE_LABEL[p.type], tax: taxOf(p, year), booked: b.b, dep: depreciationFor(p, year) });
  }
  const fy = await fiscalYearFor(sql, companyId, `${year}-12-31`) ?? await fiscalYearFor(sql, companyId, `${year}-06-30`);
  let bookedDep = 0;
  if (fy) for (const [n, v] of await accountSums(companyId, fy.start_date, fy.end_date)) if (n >= 7820 && n <= 7829) bookedDep += Number(v);
  const taxDep = rows.reduce((s, r) => s + r.dep.total, 0);
  return { year, rows, bookedDep, taxDep, adjustment: taxAdjustment(bookedDep, taxDep) };
}
