import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { addDays, today } from '@/lib/format';
import { parseAmount } from '@/lib/money';
import { ASSET_CATEGORIES } from '@/lib/assets';
import {
  billingPeriod, deductibleShare, DEPOSIT_ACCOUNT, depositReturnLines, indexedRent, LAND_ACCOUNT, periodRent, RENT_EXEMPT_ACCOUNT, RENT_VAT_ACCOUNT,
  RETAINED_DEPOSIT_ACCOUNT, splitComponents, type Billing,
} from '@/lib/property';
import type { Actor } from './actor';
import { bookInvoice, saveDraftTx } from './invoices';
import { date, int, optInt, str } from './input';

function kronor(input: Record<string, unknown>, k: string, label: string, min = 0, required = true) {
  const raw = String(input[k] ?? '').trim();
  if (!raw && !required) return null;
  const v = parseAmount(raw);
  if (v == null || v < min) throw new ValidationError(`Ange ${label.toLowerCase()} i kronor`);
  return v;
}
const on = (v: unknown) => v === 'on' || v === true || v === 'true';

async function ownProperty(companyId: number, id: number) {
  const [p] = await sql<{ id: number; name: string }[]>`SELECT id, name FROM properties WHERE id = ${id} AND company_id = ${companyId}`;
  if (!p) throw new NotFoundError('Fastigheten');
  return p;
}

export async function createProperty(actor: Actor, input: Record<string, unknown>) {
  const [p] = await sql<{ id: number }[]>`INSERT INTO properties ${sql({
    company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Namn', max: 200 }),
    designation: str(input, 'designation', { max: 100 }), address: str(input, 'address', { max: 300 }),
  })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'property', p.id);
  await sql`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${RENT_VAT_ACCOUNT}, 'Frivilligt momspliktiga hyresintäkter'),
    (${actor.companyId}, ${RENT_EXEMPT_ACCOUNT}, 'Hyresintäkter'), (${actor.companyId}, ${DEPOSIT_ACCOUNT}, 'Mottagna depositioner'),
    (${actor.companyId}, ${RETAINED_DEPOSIT_ACCOUNT}, 'Övriga ersättningar och intäkter'), (${actor.companyId}, ${LAND_ACCOUNT}, 'Mark') ON CONFLICT DO NOTHING`;
  return p.id;
}

export async function addPremise(actor: Actor, propertyId: number, input: Record<string, unknown>) {
  await ownProperty(actor.companyId, propertyId);
  const kind = str(input, 'kind') || 'lokal';
  if (!['lokal', 'bostad', 'garage', 'forrad'].includes(kind)) throw new ValidationError('Ogiltig typ');
  const vat = on(input.vat_liable);
  if (vat && kind === 'bostad') throw new ValidationError('Frivillig skattskyldighet gäller inte bostäder');
  const area = Number(String(input.area ?? '0').replace(',', '.'));
  if (!Number.isFinite(area) || area < 0) throw new ValidationError('Ange ytan i kvadratmeter');
  const [p] = await sql<{ id: number }[]>`INSERT INTO premises ${sql({ company_id: actor.companyId, property_id: propertyId, name: str(input, 'name', { required: true, label: 'Lokal', max: 100 }), kind, area, vat_liable: vat, vat_from: vat ? (date(input, 'vat_from', 'Momsplikt från', false) || today()) : null })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'premise', p.id, { vat });
  return p.id;
}

/** Frivillig skattskyldighet per lokal (ML 12 kap.) – påverkar hyresavierna från datumet */
export async function setPremiseVat(actor: Actor, premiseId: number, input: Record<string, unknown>) {
  const vat = on(input.vat_liable);
  const [p] = await sql<{ kind: string }[]>`SELECT kind FROM premises WHERE id = ${premiseId} AND company_id = ${actor.companyId}`;
  if (!p) throw new NotFoundError('Lokalen');
  if (vat && p.kind === 'bostad') throw new ValidationError('Frivillig skattskyldighet gäller inte bostäder');
  await sql`UPDATE premises SET vat_liable = ${vat}, vat_from = ${vat ? (date(input, 'vat_from', 'Momsplikt från', false) || today()) : null} WHERE id = ${premiseId}`;
  await auditBy(sql, actor, 'vat', 'premise', premiseId, { vat });
}

export async function setIndex(actor: Actor, input: Record<string, unknown>) {
  const year = int(input, 'year', 'År');
  const value = Number(String(input.value ?? '').replace(',', '.'));
  if (year < 1980 || year > 2100 || !Number.isFinite(value) || value <= 0) throw new ValidationError('Ange år och indexvärde (KPI oktober)');
  await sql`INSERT INTO property_index (company_id, year, value) VALUES (${actor.companyId}, ${year}, ${value}) ON CONFLICT (company_id, year) DO UPDATE SET value = EXCLUDED.value`;
  await auditBy(sql, actor, 'index', 'property', actor.companyId, { year, value });
}

export async function createLease(actor: Actor, input: Record<string, unknown>) {
  const premiseId = int(input, 'premise_id', 'Lokal');
  const customerId = int(input, 'customer_id', 'Hyresgäst');
  const [ok] = await sql`SELECT 1 FROM premises p, customers c WHERE p.id = ${premiseId} AND p.company_id = ${actor.companyId} AND c.id = ${customerId} AND c.company_id = ${actor.companyId}`;
  if (!ok) throw new ValidationError('Välj lokal och hyresgäst');
  const start = date(input, 'start_date', 'Tillträde');
  const end = date(input, 'end_date', 'Avtalet löper till', false) || null;
  if (end && end < start) throw new ValidationError('Slutdatum före tillträde');
  const billing: Billing = str(input, 'billing') === 'month' ? 'month' : 'quarter';
  const share = Number(String(input.index_share ?? '100').replace(',', '.'));
  if (!Number.isFinite(share) || share < 0 || share > 100) throw new ValidationError('Indexandelen ska vara 0–100 %');
  const indexYear = optInt(input, 'index_year', 'Basår');
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(75001, ${premiseId})`;
    const overlap = await tx`SELECT 1 FROM leases WHERE premise_id = ${premiseId} AND start_date <= ${end ?? '9999-12-31'} AND COALESCE(end_date, '9999-12-31') >= ${start}`;
    if (overlap.length) throw new ConflictError('Lokalen är redan uthyrd under perioden');
    const [l] = await tx<{ id: number }[]>`INSERT INTO leases ${tx({
      company_id: actor.companyId, premise_id: premiseId, customer_id: customerId, start_date: start, end_date: end,
      base_rent: kronor(input, 'base_rent', 'Årshyra', 1)!, index_year: indexYear, index_share: share, billing, deposit: kronor(input, 'deposit', 'Deposition', 0, false) ?? 0,
    })} RETURNING id`;
    await auditBy(tx, actor, 'create', 'lease', l.id);
    return l.id;
  });
}

async function ownLease(companyId: number, id: number) {
  const [l] = await sql<{ id: number; deposit: number; deposit_voucher_id: number | null; deposit_returned_voucher_id: number | null; premise: string; tenant: string }[]>`
    SELECT l.id, l.deposit::float8 AS deposit, l.deposit_voucher_id, l.deposit_returned_voucher_id, p.name AS premise, c.name AS tenant
    FROM leases l JOIN premises p ON p.id = l.premise_id JOIN customers c ON c.id = l.customer_id WHERE l.id = ${id} AND l.company_id = ${companyId}`;
  if (!l) throw new NotFoundError('Hyresavtalet');
  return l;
}

export async function registerDeposit(actor: Actor, leaseId: number, input: Record<string, unknown>) {
  const l = await ownLease(actor.companyId, leaseId);
  if (!l.deposit) throw new ValidationError('Avtalet har ingen deposition');
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Bankkontot ska vara 19xx');
  return sql.begin(async (tx) => {
    const [cur] = await tx<{ v: number | null }[]>`SELECT deposit_voucher_id AS v FROM leases WHERE id = ${leaseId} FOR UPDATE`;
    if (cur.v) throw new ConflictError('Depositionen är redan registrerad');
    const v = await createVoucher(tx, { actor, date: date(input, 'date', 'Datum', false) || today(), description: `Deposition ${l.tenant} – ${l.premise}`,
      lines: fromSigned([{ account: bank, amount: l.deposit }, { account: DEPOSIT_ACCOUNT, amount: -l.deposit }]), sourceType: 'lease', sourceId: leaseId });
    await tx`UPDATE leases SET deposit_voucher_id = ${v.id} WHERE id = ${leaseId}`;
    await auditBy(tx, actor, 'deposit', 'lease', leaseId, { amount: l.deposit });
    return v;
  });
}

export async function returnDeposit(actor: Actor, leaseId: number, input: Record<string, unknown>) {
  const l = await ownLease(actor.companyId, leaseId);
  const retained = kronor(input, 'retained', 'Kvarhållet belopp', 0, false) ?? 0;
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Bankkontot ska vara 19xx');
  let lines;
  try { lines = depositReturnLines({ deposit: l.deposit, retained, bank }); } catch (e) { throw new ValidationError((e as Error).message); }
  return sql.begin(async (tx) => {
    const [cur] = await tx<{ v: number | null; r: number | null }[]>`SELECT deposit_voucher_id AS v, deposit_returned_voucher_id AS r FROM leases WHERE id = ${leaseId} FOR UPDATE`;
    if (!cur.v) throw new ValidationError('Depositionen är inte registrerad som mottagen');
    if (cur.r) throw new ConflictError('Depositionen är redan återbetald');
    const v = await createVoucher(tx, { actor, date: date(input, 'date', 'Datum', false) || today(), description: `Återbetald deposition ${l.tenant} – ${l.premise}${retained ? ' (delvis kvarhållen)' : ''}`,
      lines: fromSigned(lines), sourceType: 'lease', sourceId: leaseId });
    await tx`UPDATE leases SET deposit_returned_voucher_id = ${v.id} WHERE id = ${leaseId}`;
    await auditBy(tx, actor, 'deposit_return', 'lease', leaseId, { retained });
    return v;
  });
}

const indexMap = async (companyId: number) => new Map((await sql<{ year: number; value: number }[]>`SELECT year, value::float8 AS value FROM property_index WHERE company_id = ${companyId}`).map((r) => [r.year, r.value]));
const yearRent = (l: { base_rent: number; index_year: number | null; index_share: number }, year: number, idx: Map<number, number>) =>
  indexedRent({ baseRent: l.base_rent, baseIndex: l.index_year ? idx.get(l.index_year) ?? null : null, index: idx.get(year - 1) ?? null, share: l.index_share });

/**
 * Hyresavier för en månad: en faktura per hyresavtal som löper perioden och inte redan aviserats.
 * Kvartalsavtal aviseras i kvartalets första månad. Hyran räknas upp med index (oktober året före), moms 25 % om lokalen är frivilligt skattskyldig.
 * Avierna bokförs direkt och får OCR. Förfallodag dagen före periodens början (hyra i förskott).
 */
export async function invoiceRents(actor: Actor, input: Record<string, unknown>) {
  const month = str(input, 'month');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ValidationError('Ange månad som ÅÅÅÅ-MM');
  const invoiceDate = date(input, 'invoice_date', 'Fakturadatum', false) || today();
  const idx = await indexMap(actor.companyId);
  const ids = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(75002, ${actor.companyId})`;
    const leases = await tx<{ id: number; customer_id: number; base_rent: number; index_year: number | null; index_share: number; billing: Billing; start_date: string; end_date: string | null; premise: string; property: string; vat_liable: boolean; vat_from: string | null }[]>`
      SELECT l.id, l.customer_id, l.base_rent::float8 AS base_rent, l.index_year, l.index_share::float8 AS index_share, l.billing, to_char(l.start_date,'YYYY-MM-DD') AS start_date, to_char(l.end_date,'YYYY-MM-DD') AS end_date,
        p.name AS premise, pr.name AS property, p.vat_liable, to_char(p.vat_from,'YYYY-MM-DD') AS vat_from
      FROM leases l JOIN premises p ON p.id = l.premise_id JOIN properties pr ON pr.id = p.property_id WHERE l.company_id = ${actor.companyId} ORDER BY l.id`;
    const out: number[] = [];
    for (const l of leases) {
      const per = billingPeriod(l.billing, month);
      if (!per || l.start_date > per.to || (l.end_date && l.end_date < per.from)) continue;
      const [dup] = await tx`SELECT 1 FROM lease_invoices WHERE lease_id = ${l.id} AND period = ${per.key}`;
      if (dup) continue;
      const rent = periodRent(yearRent(l, Number(month.slice(0, 4)), idx), per.months);
      const vat = l.vat_liable && (!l.vat_from || l.vat_from <= per.from);
      const due = addDays(per.from, -1) < invoiceDate ? addDays(invoiceDate, 10) : addDays(per.from, -1);
      const inv = await saveDraftTx(tx, actor, null, {
        customer_id: l.customer_id, invoice_date: invoiceDate, due_date: due, your_reference: `${l.property}, ${l.premise}`,
        notes: `Hyresavi ${per.label}. Hyran betalas i förskott. Ange OCR-numret vid betalning.`,
        lines: [{ description: `Hyra ${l.premise} ${per.from} – ${per.to}`, quantity: 1, unit: 'st', unit_price: rent, vat_rate: vat ? 25 : 0, account: vat ? RENT_VAT_ACCOUNT : RENT_EXEMPT_ACCOUNT }],
      });
      await tx`INSERT INTO lease_invoices (lease_id, period, rent, invoice_id) VALUES (${l.id}, ${per.key}, ${rent}, ${inv.id})`;
      out.push(inv.id);
    }
    if (!out.length) throw new ValidationError('Det finns inga hyror att avisera för månaden');
    await auditBy(tx, actor, 'invoice_rents', 'property', actor.companyId, { month, count: out.length });
    return out;
  });
  for (const id of ids) await bookInvoice(actor, id);
  return ids.length;
}

/** Komponentavskrivning: byggnaden delas upp i komponenter med egen nyttjandeperiod i anläggningsregistret; marken skrivs inte av */
export async function registerComponents(actor: Actor, propertyId: number, input: Record<string, unknown>) {
  const p = await ownProperty(actor.companyId, propertyId);
  const cost = kronor(input, 'cost', 'Anskaffningsvärde', 1)!;
  const land = kronor(input, 'land', 'Markvärde', 0, false) ?? 0;
  const acquired = date(input, 'acquired_on', 'Anskaffningsdatum');
  const comps: { name: string; pct: number; years: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const name = str(input, `comp_name_${i}`, { max: 100 });
    if (!name) continue;
    comps.push({ name, pct: Number(String(input[`comp_pct_${i}`] ?? '').replace(',', '.')), years: Number(input[`comp_years_${i}`]) });
  }
  let split;
  try { split = splitComponents(cost, land, comps); } catch (e) { throw new ValidationError((e as Error).message); }
  const c = ASSET_CATEGORIES.byggnader;
  return sql.begin(async (tx) => {
    const [ex] = await tx`SELECT 1 FROM assets WHERE property_id = ${propertyId} AND company_id = ${actor.companyId} AND status = 'active'`;
    if (ex) throw new ConflictError('Fastigheten har redan komponenter i anläggningsregistret');
    for (const [n, name] of [[c.asset, c.names[0]], [c.accDep, c.names[1]], [c.dep, c.names[2]]] as const) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n}, ${name}) ON CONFLICT DO NOTHING`;
    for (const k of split.components) {
      await tx`INSERT INTO assets ${tx({ company_id: actor.companyId, name: `${p.name}: ${k.name}`, category: 'byggnader', asset_account: c.asset, acc_dep_account: c.accDep, dep_account: c.dep,
        acquired_on: acquired, cost: k.cost, residual: 0, life_months: k.lifeMonths, dep_start: `${acquired.slice(0, 7)}-01`, notes: `Komponent ${k.pct} % av byggnaden`, created_by: actor.userId, property_id: propertyId })}`;
    }
    await tx`UPDATE properties SET cost = ${cost}, land = ${land}, acquired_on = ${acquired} WHERE id = ${propertyId}`;
    await auditBy(tx, actor, 'components', 'property', propertyId, { cost, land, components: split.components.length });
    return split;
  });
}

export async function overview(companyId: number) {
  const idx = await indexMap(companyId);
  const year = Number(today().slice(0, 4));
  const properties = await sql<{ id: number; name: string; designation: string; address: string; cost: number | null; land: number | null; acquired_on: string | null }[]>`
    SELECT id, name, designation, address, cost::float8 AS cost, land::float8 AS land, to_char(acquired_on,'YYYY-MM-DD') AS acquired_on FROM properties WHERE company_id = ${companyId} ORDER BY name`;
  const premises = await sql<{ id: number; property_id: number; name: string; kind: string; area: number; vat_liable: boolean; vat_from: string | null }[]>`
    SELECT id, property_id, name, kind, area::float8 AS area, vat_liable, to_char(vat_from,'YYYY-MM-DD') AS vat_from FROM premises WHERE company_id = ${companyId} ORDER BY name`;
  const leases = (await sql<{ id: number; premise_id: number; tenant: string; start_date: string; end_date: string | null; base_rent: number; index_year: number | null; index_share: number; billing: Billing; deposit: number; deposit_voucher_id: number | null; deposit_returned_voucher_id: number | null }[]>`
    SELECT l.id, l.premise_id, c.name AS tenant, to_char(l.start_date,'YYYY-MM-DD') AS start_date, to_char(l.end_date,'YYYY-MM-DD') AS end_date, l.base_rent::float8 AS base_rent, l.index_year,
      l.index_share::float8 AS index_share, l.billing, l.deposit::float8 AS deposit, l.deposit_voucher_id, l.deposit_returned_voucher_id
    FROM leases l JOIN customers c ON c.id = l.customer_id WHERE l.company_id = ${companyId} ORDER BY l.start_date`).map((l) => ({ ...l, current: yearRent(l, year, idx) }));
  const invoices = await sql<{ lease_id: number; period: string; rent: number; invoice_id: number | null; invoice_number: number | null; ocr: string | null; status: string | null; total: number | null }[]>`
    SELECT li.lease_id, li.period, li.rent::float8 AS rent, li.invoice_id, i.invoice_number, i.ocr, i.status, i.total::float8 AS total
    FROM lease_invoices li JOIN leases l ON l.id = li.lease_id LEFT JOIN invoices i ON i.id = li.invoice_id WHERE l.company_id = ${companyId} ORDER BY li.period DESC, li.lease_id LIMIT 60`;
  const components = await sql<{ id: number; property_id: number; name: string; cost: number; life_months: number; booked: number }[]>`
    SELECT a.id, a.property_id, a.name, a.cost::float8 AS cost, a.life_months, COALESCE((SELECT SUM(amount) FROM asset_depreciations d WHERE d.asset_id = a.id), 0)::float8 AS booked
    FROM assets a WHERE a.company_id = ${companyId} AND a.property_id IS NOT NULL AND a.status = 'active' ORDER BY a.id`;
  const today0 = today();
  const share = new Map(properties.map((p) => [p.id, deductibleShare(premises.filter((x) => x.property_id === p.id).map((x) => ({
    area: x.area, vatLiable: x.vat_liable, let: leases.some((l) => l.premise_id === x.id && l.start_date <= today0 && (!l.end_date || l.end_date >= today0)),
  })))]));
  return { properties, premises, leases, invoices, components, share, index: [...idx].sort((a, b) => b[0] - a[0]) };
}
