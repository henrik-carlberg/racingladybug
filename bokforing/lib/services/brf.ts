import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, createVoucher, openingBalances } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { addDays, today } from '@/lib/format';
import { parseAmount } from '@/lib/money';
import { billingPeriod } from '@/lib/property';
import {
  brfKeyFigures, FEE_ACCOUNT, feesByShare, FUND_ACCOUNT, fundLines, INSATS_ACCOUNT, maxPledgeFee, maxTransferFee, registerHtml, RETAINED_ACCOUNT,
  shareSum, TRANSFER_FEE_ACCOUNT, UPPLATELSE_ACCOUNT,
} from '@/lib/brf';
import type { Actor } from './actor';
import { bookInvoice, saveDraftTx } from './invoices';
import { date, int, str } from './input';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function kronor(input: Record<string, unknown>, k: string, label: string, required = false) {
  const raw = String(input[k] ?? '').trim();
  if (!raw) { if (required) throw new ValidationError(`Ange ${label.toLowerCase()}`); return 0; }
  const v = parseAmount(raw);
  if (v == null || v < 0) throw new ValidationError(`Ange ${label.toLowerCase()} i kronor`);
  return v;
}
const on = (v: unknown) => v === 'on' || v === true || v === 'true';

export async function isBrf(companyId: number) {
  const [c] = await sql<{ org_form: string | null }[]>`SELECT org_form FROM companies WHERE id = ${companyId}`;
  return c?.org_form === 'brf';
}
async function requireBrf(companyId: number) { if (!(await isBrf(companyId))) throw new ValidationError('Slå på bostadsrättsföreningsläget först'); }

export async function setBrf(actor: Actor, value: boolean) {
  await sql.begin(async (tx) => {
    await tx`UPDATE companies SET org_form = ${value ? 'brf' : null} WHERE id = ${actor.companyId}`;
    if (value) await tx`INSERT INTO accounts (company_id, number, name) VALUES
      (${actor.companyId}, ${FEE_ACCOUNT}, 'Årsavgifter bostadsrätter'), (${actor.companyId}, ${TRANSFER_FEE_ACCOUNT}, 'Överlåtelse- och pantsättningsavgifter'),
      (${actor.companyId}, ${INSATS_ACCOUNT}, 'Inbetalda insatser'), (${actor.companyId}, ${UPPLATELSE_ACCOUNT}, 'Upplåtelseavgifter'),
      (${actor.companyId}, ${FUND_ACCOUNT}, 'Fond för yttre underhåll'), (${actor.companyId}, ${RETAINED_ACCOUNT}, 'Balanserat resultat'),
      (${actor.companyId}, 2069, 'Årets resultat') ON CONFLICT DO NOTHING`;
    await auditBy(tx, actor, value ? 'enable' : 'disable', 'brf', actor.companyId);
  });
}

async function customerFor(tx: Tx, companyId: number, name: string, email: string) {
  const [c] = await tx<{ id: number }[]>`INSERT INTO customers ${tx({ company_id: companyId, name, email })} RETURNING id`;
  return c.id;
}

async function ownApartment(db: Tx | typeof sql, companyId: number, id: number) {
  const [a] = await db<{ id: number; number: string }[]>`SELECT id, number FROM brf_apartments WHERE id = ${id} AND company_id = ${companyId}`;
  if (!a) throw new NotFoundError('Lägenheten');
  return a;
}

/** Ny lägenhet i förteckningen med bostadsrättshavare */
export async function addApartment(actor: Actor, input: Record<string, unknown>) {
  await requireBrf(actor.companyId);
  const number = str(input, 'number', { required: true, label: 'Lägenhet', max: 20 });
  const area = Number(String(input.area ?? '').replace(',', '.'));
  const share = Number(String(input.share ?? '').replace(',', '.'));
  if (!(area > 0)) throw new ValidationError('Ange ytan i kvm');
  if (!(share > 0)) throw new ValidationError('Ange andelstalet');
  const owner = str(input, 'owner', { required: true, label: 'Bostadsrättshavare', max: 200 });
  const email = str(input, 'email', { max: 200 });
  if (email && !EMAIL.test(email)) throw new ValidationError('Ogiltig e-postadress');
  const since = date(input, 'granted_on', 'Upplåten', false) || today();
  return sql.begin(async (tx) => {
    const [dup] = await tx`SELECT 1 FROM brf_apartments WHERE company_id = ${actor.companyId} AND number = ${number}`;
    if (dup) throw new ConflictError('Lägenheten finns redan');
    const [a] = await tx<{ id: number }[]>`INSERT INTO brf_apartments ${tx({
      company_id: actor.companyId, number, skv_number: str(input, 'skv_number', { max: 10 }), floor: str(input, 'floor', { max: 40 }), rooms: str(input, 'rooms', { max: 20 }),
      area, purpose: str(input, 'purpose', { max: 40 }) || 'Bostad', share, insats: kronor(input, 'insats', 'Insats'), upplatelse: kronor(input, 'upplatelse', 'Upplåtelseavgift'), granted_on: since,
    })} RETURNING id`;
    const cust = await customerFor(tx, actor.companyId, owner, email);
    await tx`INSERT INTO brf_owners (apartment_id, customer_id, name, from_date) VALUES (${a.id}, ${cust}, ${owner}, ${since})`;
    await auditBy(tx, actor, 'create', 'brf_apartment', a.id, { number });
    return a.id;
  });
}

/** Överlåtelse: nuvarande innehavare avslutas, köparen förs in. Överlåtelseavgiften (högst 2,5 % av prisbasbeloppet) faktureras köparen. */
export async function transfer(actor: Actor, apartmentId: number, input: Record<string, unknown>) {
  await requireBrf(actor.companyId);
  const d = date(input, 'date', 'Tillträdesdag');
  const buyer = str(input, 'buyer', { required: true, label: 'Köpare', max: 200 });
  const email = str(input, 'email', { max: 200 });
  if (email && !EMAIL.test(email)) throw new ValidationError('Ogiltig e-postadress');
  const price = kronor(input, 'price', 'Pris') || null;
  const charge = on(input.charge_fee);
  const invoiceId = await sql.begin(async (tx) => {
    const a = await ownApartment(tx, actor.companyId, apartmentId);
    await tx`SELECT id FROM brf_apartments WHERE id = ${a.id} FOR UPDATE`;
    const cur = await tx<{ id: number; name: string; from_date: string }[]>`SELECT id, name, to_char(from_date,'YYYY-MM-DD') AS from_date FROM brf_owners WHERE apartment_id = ${a.id} AND to_date IS NULL`;
    if (!cur.length) throw new ValidationError('Lägenheten har ingen bostadsrättshavare');
    if (cur.some((o) => o.from_date >= d)) throw new ValidationError('Tillträdet måste vara efter nuvarande innehavares förvärv');
    await tx`UPDATE brf_owners SET to_date = ${addDays(d, -1)} WHERE apartment_id = ${a.id} AND to_date IS NULL`;
    const cust = await customerFor(tx, actor.companyId, buyer, email);
    await tx`INSERT INTO brf_owners (apartment_id, customer_id, name, from_date) VALUES (${a.id}, ${cust}, ${buyer}, ${d})`;
    let inv: number | null = null;
    if (charge) {
      inv = (await saveDraftTx(tx, actor, null, { customer_id: cust, invoice_date: today(), your_reference: `Lägenhet ${a.number}`,
        lines: [{ description: `Överlåtelseavgift lägenhet ${a.number}`, quantity: 1, unit: 'st', unit_price: maxTransferFee(Number(d.slice(0, 4))), vat_rate: 0, account: TRANSFER_FEE_ACCOUNT }] })).id;
    }
    await tx`INSERT INTO brf_transfers (apartment_id, date, seller, buyer, price, fee_invoice_id) VALUES (${a.id}, ${d}, ${cur.map((o) => o.name).join(', ')}, ${buyer}, ${price}, ${inv})`;
    await auditBy(tx, actor, 'transfer', 'brf_apartment', a.id, { date: d });
    return inv;
  });
  // Stoppas bokningen (t.ex. av kreditkontrollen) ligger avgiftsfakturan kvar som utkast under Kundfakturor
  if (invoiceId) await bookInvoice(actor, invoiceId).catch(() => {});
}

/** Pantsättning: noteras i förteckningen; pantsättningsavgiften (högst 1 % av prisbasbeloppet) faktureras innehavaren */
export async function addPledge(actor: Actor, apartmentId: number, input: Record<string, unknown>) {
  await requireBrf(actor.companyId);
  const lender = str(input, 'lender', { required: true, label: 'Långivare', max: 200 });
  const d = date(input, 'date', 'Datum', false) || today();
  const invoiceId = await sql.begin(async (tx) => {
    const a = await ownApartment(tx, actor.companyId, apartmentId);
    const [o] = await tx<{ customer_id: number }[]>`SELECT customer_id FROM brf_owners WHERE apartment_id = ${a.id} AND to_date IS NULL ORDER BY id LIMIT 1`;
    let inv: number | null = null;
    if (on(input.charge_fee) && o) inv = (await saveDraftTx(tx, actor, null, { customer_id: o.customer_id, invoice_date: today(), your_reference: `Lägenhet ${a.number}`,
      lines: [{ description: `Pantsättningsavgift lägenhet ${a.number}`, quantity: 1, unit: 'st', unit_price: maxPledgeFee(Number(d.slice(0, 4))), vat_rate: 0, account: TRANSFER_FEE_ACCOUNT }] })).id;
    await tx`INSERT INTO brf_pledges (apartment_id, lender, amount, date, fee_invoice_id) VALUES (${a.id}, ${lender}, ${kronor(input, 'amount', 'Belopp') || null}, ${d}, ${inv})`;
    await auditBy(tx, actor, 'pledge', 'brf_apartment', a.id, { lender });
    return inv;
  });
  // Stoppas bokningen (t.ex. av kreditkontrollen) ligger avgiftsfakturan kvar som utkast under Kundfakturor
  if (invoiceId) await bookInvoice(actor, invoiceId).catch(() => {});
}

export async function releasePledge(actor: Actor, pledgeId: number) {
  const r = await sql`UPDATE brf_pledges p SET released_on = ${today()} FROM brf_apartments a
    WHERE p.id = ${pledgeId} AND a.id = p.apartment_id AND a.company_id = ${actor.companyId} AND p.released_on IS NULL RETURNING p.id`;
  if (!r.length) throw new NotFoundError('Pantsättningen');
  await auditBy(sql, actor, 'pledge_release', 'brf_pledge', pledgeId);
}

export async function setBudget(actor: Actor, input: Record<string, unknown>) {
  await requireBrf(actor.companyId);
  const year = int(input, 'year', 'År');
  const periods = Number(input.periods) === 4 ? 4 : 12;
  await sql`INSERT INTO brf_budgets (company_id, year, fee_budget, periods) VALUES (${actor.companyId}, ${year}, ${kronor(input, 'fee_budget', 'Årsavgifter totalt', true)}, ${periods})
    ON CONFLICT (company_id, year) DO UPDATE SET fee_budget = EXCLUDED.fee_budget, periods = EXCLUDED.periods`;
  await auditBy(sql, actor, 'budget', 'brf', actor.companyId, { year });
}

async function apartmentsWithOwner(db: Tx | typeof sql, companyId: number, at: string) {
  return db<{ id: number; number: string; share: number; area: number; customer_id: number | null; owner: string | null }[]>`
    SELECT a.id, a.number, a.share::float8 AS share, a.area::float8 AS area,
      (SELECT o.customer_id FROM brf_owners o WHERE o.apartment_id = a.id AND o.from_date <= ${at} AND (o.to_date IS NULL OR o.to_date >= ${at}) ORDER BY o.id LIMIT 1) AS customer_id,
      (SELECT string_agg(o.name, ', ') FROM brf_owners o WHERE o.apartment_id = a.id AND o.from_date <= ${at} AND (o.to_date IS NULL OR o.to_date >= ${at})) AS owner
    FROM brf_apartments a WHERE a.company_id = ${companyId} ORDER BY a.number`;
}

/** Avgiftsavier för en månad: årsavgifterna fördelas efter andelstal, en momsfri avi med OCR per lägenhet */
export async function invoiceFees(actor: Actor, input: Record<string, unknown>) {
  await requireBrf(actor.companyId);
  const month = str(input, 'month');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ValidationError('Ange månad som ÅÅÅÅ-MM');
  const [b] = await sql<{ fee_budget: number; periods: 4 | 12 }[]>`SELECT fee_budget::float8 AS fee_budget, periods FROM brf_budgets WHERE company_id = ${actor.companyId} AND year = ${Number(month.slice(0, 4))}`;
  if (!b) throw new ValidationError('Lägg in årets avgifter (budget) först');
  const per = billingPeriod(b.periods === 4 ? 'quarter' : 'month', month);
  if (!per) throw new ValidationError('Avgifterna aviseras kvartalsvis – välj januari, april, juli eller oktober');
  const invoiceDate = date(input, 'invoice_date', 'Fakturadatum', false) || today();
  const ids = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(79001, ${actor.companyId})`;
    const apts = await apartmentsWithOwner(tx, actor.companyId, per.from);
    if (!apts.length) throw new ValidationError('Lägg in lägenheterna först');
    const fees = new Map(feesByShare(apts, b.fee_budget, b.periods).map((f) => [f.id, f.fee]));
    const out: number[] = [];
    for (const a of apts) {
      if (!a.customer_id) continue;
      const [dup] = await tx`SELECT 1 FROM brf_fee_invoices WHERE apartment_id = ${a.id} AND period = ${per.key}`;
      if (dup) continue;
      const due = addDays(per.from, -1) < invoiceDate ? addDays(invoiceDate, 10) : addDays(per.from, -1);
      const inv = await saveDraftTx(tx, actor, null, { customer_id: a.customer_id, invoice_date: invoiceDate, due_date: due, your_reference: `Lägenhet ${a.number}`,
        notes: `Avgift ${per.label}. Ange OCR-numret vid betalning.`,
        lines: [{ description: `Årsavgift lägenhet ${a.number} ${per.from} – ${per.to}`, quantity: 1, unit: 'st', unit_price: fees.get(a.id)!, vat_rate: 0, account: FEE_ACCOUNT }] });
      await tx`INSERT INTO brf_fee_invoices (apartment_id, period, invoice_id) VALUES (${a.id}, ${per.key}, ${inv.id})`;
      out.push(inv.id);
    }
    if (!out.length) throw new ValidationError('Det finns inga avgifter att avisera för perioden');
    await auditBy(tx, actor, 'invoice_fees', 'brf', actor.companyId, { period: per.key, count: out.length });
    return out;
  });
  const failed: string[] = [];
  for (const id of ids) await bookInvoice(actor, id).catch((e) => { failed.push(e instanceof Error ? e.message : String(e)); });
  if (failed.length) throw new ValidationError(`${ids.length - failed.length} avier bokfördes. ${failed.length} ligger kvar som utkast under Kundfakturor: ${failed[0]}`);
  return ids.length;
}

export async function addMaintenance(actor: Actor, input: Record<string, unknown>) {
  await requireBrf(actor.companyId);
  const year = int(input, 'year', 'År');
  if (year < 2000 || year > 2100) throw new ValidationError('Ogiltigt år');
  await sql`INSERT INTO brf_maintenance (company_id, year, item, amount) VALUES (${actor.companyId}, ${year}, ${str(input, 'item', { required: true, label: 'Åtgärd', max: 200 })}, ${kronor(input, 'amount', 'Belopp', true)})`;
}
export async function markMaintenanceDone(actor: Actor, id: number) {
  const r = await sql`UPDATE brf_maintenance SET done = true WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Åtgärden');
}

/** Avsättning till eller ianspråktagande av fond för yttre underhåll enligt stämmobeslut */
export async function fund(actor: Actor, input: Record<string, unknown>) {
  await requireBrf(actor.companyId);
  const kind = str(input, 'kind') === 'use' ? 'use' : 'reserve';
  const amount = kronor(input, 'amount', 'Belopp', true);
  if (!amount) throw new ValidationError('Ange beloppet');
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    if (kind === 'use') {
      const ib = await openingBalances(actor.companyId, addDays(d, 1));
      if (-(ib.get(FUND_ACCOUNT) ?? 0) < amount) throw new ValidationError('Fonden räcker inte till beloppet');
    }
    const v = await createVoucher(tx, { actor, date: d, description: kind === 'reserve' ? 'Avsättning till fond för yttre underhåll enligt stämmobeslut' : 'Ianspråktagande av fond för yttre underhåll',
      lines: fromSigned(fundLines({ kind, amount })), sourceType: 'brf_fund' });
    await auditBy(tx, actor, kind, 'brf_fund', actor.companyId, { amount });
    return v;
  });
}

/** Nyckeltal för året (BFNAR 2023:1) */
export async function keyFigures(companyId: number, year: number) {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const m = await accountSums(companyId, from, to);
  const s = (a: number, b: number) => [...m].filter(([n]) => n >= a && n <= b).reduce((t, [, v]) => t + v, 0);
  const ub = await openingBalances(companyId, from);
  for (const [n, v] of m) if (n < 3000) ub.set(n, (ub.get(n) ?? 0) + v);
  const debt = -[...ub].filter(([n]) => (n >= 2300 && n <= 2399) || (n >= 2410 && n <= 2419)).reduce((t, [, v]) => t + v, 0);
  const [area] = await sql<{ br: number; premises: number }[]>`SELECT COALESCE((SELECT SUM(area) FROM brf_apartments WHERE company_id = ${companyId}), 0)::float8 AS br,
    COALESCE((SELECT SUM(area) FROM premises WHERE company_id = ${companyId}), 0)::float8 AS premises`;
  const [maint] = await sql<{ v: number }[]>`SELECT COALESCE(SUM(amount), 0)::float8 AS v FROM brf_maintenance WHERE company_id = ${companyId} AND year = ${year} AND done`;
  const fundOpen = -((await openingBalances(companyId, from)).get(FUND_ACCOUNT) ?? 0);
  return {
    rows: brfKeyFigures({ fees: -s(FEE_ACCOUNT, FEE_ACCOUNT), revenue: -s(3000, 3999), result: -s(3000, 8989), depreciation: s(7700, 7899), plannedMaintenance: maint.v,
      debt, energy: s(5020, 5049), brArea: area.br, totalArea: area.br + area.premises }),
    fund: { opening: fundOpen, closing: -(ub.get(FUND_ACCOUNT) ?? 0) }, area,
  };
}

export async function overview(companyId: number, year: number) {
  const t = today();
  const apts = await sql<{ id: number; number: string; skv_number: string; floor: string; rooms: string; area: number; purpose: string; share: number; insats: number; granted_on: string | null }[]>`
    SELECT id, number, skv_number, floor, rooms, area::float8 AS area, purpose, share::float8 AS share, insats::float8 AS insats, to_char(granted_on,'YYYY-MM-DD') AS granted_on
    FROM brf_apartments WHERE company_id = ${companyId} ORDER BY number`;
  const owners = await sql<{ apartment_id: number; name: string; from_date: string; to_date: string | null }[]>`
    SELECT o.apartment_id, o.name, to_char(o.from_date,'YYYY-MM-DD') AS from_date, to_char(o.to_date,'YYYY-MM-DD') AS to_date FROM brf_owners o JOIN brf_apartments a ON a.id = o.apartment_id
    WHERE a.company_id = ${companyId} ORDER BY o.from_date`;
  const pledges = await sql<{ id: number; apartment_id: number; lender: string; amount: number | null; date: string; released_on: string | null }[]>`
    SELECT p.id, p.apartment_id, p.lender, p.amount::float8 AS amount, to_char(p.date,'YYYY-MM-DD') AS date, to_char(p.released_on,'YYYY-MM-DD') AS released_on FROM brf_pledges p JOIN brf_apartments a ON a.id = p.apartment_id
    WHERE a.company_id = ${companyId} ORDER BY p.date`;
  const transfers = await sql<{ apartment_id: number; date: string; seller: string; buyer: string; price: number | null }[]>`
    SELECT t.apartment_id, to_char(t.date,'YYYY-MM-DD') AS date, t.seller, t.buyer, t.price::float8 AS price FROM brf_transfers t JOIN brf_apartments a ON a.id = t.apartment_id WHERE a.company_id = ${companyId} ORDER BY t.date DESC LIMIT 30`;
  const [budget] = await sql<{ fee_budget: number; periods: number }[]>`SELECT fee_budget::float8 AS fee_budget, periods FROM brf_budgets WHERE company_id = ${companyId} AND year = ${year}`;
  const fees = budget && apts.length ? new Map(feesByShare(apts, budget.fee_budget, budget.periods as 4 | 12).map((f) => [f.id, f.fee])) : new Map<number, number>();
  const invoiced = await sql<{ period: string; n: number; total: number; paid: number }[]>`
    SELECT f.period, COUNT(*)::int AS n, COALESCE(SUM(i.total), 0)::float8 AS total, COALESCE(SUM(i.paid_amount), 0)::float8 AS paid
    FROM brf_fee_invoices f JOIN brf_apartments a ON a.id = f.apartment_id LEFT JOIN invoices i ON i.id = f.invoice_id
    WHERE a.company_id = ${companyId} AND f.period LIKE ${`${year}-%`} GROUP BY f.period ORDER BY f.period DESC`;
  const maintenance = await sql<{ id: number; year: number; item: string; amount: number; done: boolean }[]>`
    SELECT id, year, item, amount::float8 AS amount, done FROM brf_maintenance WHERE company_id = ${companyId} ORDER BY year, id`;
  const current = (id: number) => owners.filter((o) => o.apartment_id === id && o.from_date <= t && (!o.to_date || o.to_date >= t));
  return { apts, owners, current, pledges, transfers, budget, fees, invoiced, maintenance, shares: shareSum(apts), key: await keyFigures(companyId, year) };
}

export async function registerDocument(companyId: number) {
  const o = await overview(companyId, Number(today().slice(0, 4)));
  const [c] = await sql<{ name: string; orgnr: string }[]>`SELECT name, orgnr FROM companies WHERE id = ${companyId}`;
  return registerHtml({ org: c.name, orgnr: c.orgnr, date: today(), rows: o.apts.map((a) => {
    const cur = o.current(a.id);
    return { number: a.number, skv: a.skv_number, floor: a.floor, rooms: a.rooms, area: a.area, purpose: a.purpose, owners: cur.map((x) => x.name).join(', '), insats: a.insats,
      since: cur[0]?.from_date ?? a.granted_on ?? '', pledges: o.pledges.filter((p) => p.apartment_id === a.id && !p.released_on).map((p) => `${p.lender} ${p.date}`) };
  }) });
}
