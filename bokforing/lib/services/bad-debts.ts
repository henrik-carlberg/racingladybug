import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned, reverseLines } from '@/lib/ledger-lines';
import { confirmedLossLines, DOUBTFUL_RESERVE, recoveryLines, reserveProposal, vatShare, type ReserveCandidate } from '@/lib/bad-debts';
import type { Actor } from './actor';
import { date, optInt, str } from './input';

const NAMES: Record<number, string> = { 6351: 'Konstaterade förluster på kundfordringar', 6352: 'Befarade förluster på kundfordringar', 1519: 'Nedskrivning av kundfordringar' };
async function ensure(tx: Tx, companyId: number) {
  for (const [n, name] of Object.entries(NAMES)) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${Number(n)}, ${name}) ON CONFLICT DO NOTHING`;
}
async function invoiceLines(tx: Tx | typeof sql, voucherId: number) {
  return (await tx<{ account: number; amount: number }[]>`SELECT account_number AS account, SUM(debit - credit)::float8 AS amount FROM voucher_lines WHERE voucher_id = ${voucherId} GROUP BY account_number`);
}

/** Konstaterad kundförlust (konkurs, ackord, utredning utan resultat): resten av fordran skrivs bort och utgående moms sätts ned */
export async function writeOff(actor: Actor, invoiceId: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  const reason = str(input, 'reason', { required: true, label: 'Varför förlusten är konstaterad', max: 300 });
  return sql.begin(async (tx) => {
    const [inv] = await tx<{ status: string; total: number; paid: number; number: number; voucher_id: number | null; customer: string; currency: string }[]>`
      SELECT i.status, i.total::float8 AS total, i.paid_amount::float8 AS paid, i.invoice_number AS number, i.voucher_id, c.name AS customer, i.currency
      FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${invoiceId} AND i.company_id = ${actor.companyId} FOR UPDATE OF i`;
    if (!inv) throw new NotFoundError('Fakturan');
    if (inv.status !== 'booked') throw new ConflictError('Bara bokförda, obetalda fakturor kan skrivas bort');
    if (!inv.voucher_id) throw new ValidationError('Fakturan är inte bokförd som kundfordran (kontantmetoden) – kreditera den i stället');
    const remaining = inv.total - inv.paid;
    if (remaining <= 0) throw new ConflictError('Det finns inget kvar att skriva bort');
    await ensure(tx, actor.companyId);
    const lines = confirmedLossLines(await invoiceLines(tx, inv.voucher_id), remaining);
    const v = await createVoucher(tx, { actor, date: d, description: `Konstaterad kundförlust faktura ${inv.number}, ${inv.customer}: ${reason}`, lines: fromSigned(lines), sourceType: 'bad_debt', sourceId: invoiceId, series: 'B' });
    await tx`UPDATE invoices SET status = 'written_off', written_off_amount = ${remaining}, written_off_voucher_id = ${v.id}, written_off_date = ${d}, written_off_reason = ${reason} WHERE id = ${invoiceId}`;
    await auditBy(tx, actor, 'write_off', 'invoice', invoiceId, { amount: remaining, reason });
    return { amount: remaining, vat: vatShare(await invoiceLines(tx, inv.voucher_id), remaining).total };
  });
}

/** Ångrar en bortskrivning som gjorts av misstag (rättelseverifikation) – bara om inget har återvunnits */
export async function undoWriteOff(actor: Actor, invoiceId: number) {
  return sql.begin(async (tx) => {
    const [inv] = await tx<{ status: string; voucher: number | null; recovered: number }[]>`SELECT status, written_off_voucher_id AS voucher, recovered_amount::float8 AS recovered FROM invoices
      WHERE id = ${invoiceId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!inv) throw new NotFoundError('Fakturan');
    if (inv.status !== 'written_off' || !inv.voucher) throw new ConflictError('Fakturan är inte bortskriven');
    if (inv.recovered) throw new ConflictError('Kunden har betalat en del efter bortskrivningen – den kan inte ångras');
    const orig = await tx<{ account: number; debit: number; credit: number }[]>`SELECT account_number AS account, debit::float8 AS debit, credit::float8 AS credit FROM voucher_lines WHERE voucher_id = ${inv.voucher}`;
    const [{ d }] = await tx<{ d: string }[]>`SELECT to_char(current_date,'YYYY-MM-DD') AS d`;
    await createVoucher(tx, { actor, date: d, description: 'Rättelse: kundförlusten var inte konstaterad', lines: reverseLines(orig.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit }))), sourceType: 'bad_debt_undo', sourceId: invoiceId, correctsId: inv.voucher });
    await tx`UPDATE invoices SET status = 'booked', written_off_amount = 0, written_off_voucher_id = NULL, written_off_date = NULL, written_off_reason = '' WHERE id = ${invoiceId}`;
    await auditBy(tx, actor, 'undo_write_off', 'invoice', invoiceId);
  });
}

/** Kunden betalar trots allt (t.ex. utdelning i konkursen): förlusten minskar och momsen redovisas igen */
export async function recover(actor: Actor, invoiceId: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Betaldatum');
  const amount = optInt(input, 'amount', 'Belopp');
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Bankkonto måste vara ett 19xx-konto');
  return sql.begin(async (tx) => {
    const [inv] = await tx<{ status: string; written: number; recovered: number; voucher_id: number; number: number; customer: string }[]>`
      SELECT i.status, i.written_off_amount::float8 AS written, i.recovered_amount::float8 AS recovered, i.voucher_id, i.invoice_number AS number, c.name AS customer
      FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${invoiceId} AND i.company_id = ${actor.companyId} FOR UPDATE OF i`;
    if (!inv) throw new NotFoundError('Fakturan');
    if (inv.status !== 'written_off') throw new ConflictError('Fakturan är inte bortskriven');
    const left = inv.written - inv.recovered;
    const a = amount ?? left;
    if (!(a > 0)) throw new ValidationError('Ange beloppet');
    if (a > left) throw new ValidationError(`Beloppet är större än den bortskrivna fordran (${(left / 100).toFixed(2).replace('.', ',')} kr)`);
    // Momsen beräknas på fakturans ursprungliga fördelning
    const v = await createVoucher(tx, { actor, date: d, description: `Återvunnen kundförlust faktura ${inv.number}, ${inv.customer}`, lines: fromSigned(recoveryLines(await invoiceLines(tx, inv.voucher_id), a, bank)), sourceType: 'bad_debt_recovery', sourceId: invoiceId, series: 'B' });
    await tx`UPDATE invoices SET recovered_amount = recovered_amount + ${a} WHERE id = ${invoiceId}`;
    await auditBy(tx, actor, 'recover', 'invoice', invoiceId, { amount: a, voucher: v.id });
    return a;
  });
}

async function fy(companyId: number, fyId: number) {
  const [f] = await sql<{ id: number; start_date: string; end_date: string; closed: boolean }[]>`SELECT id, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, closed FROM fiscal_years WHERE id = ${fyId} AND company_id = ${companyId}`;
  if (!f) throw new NotFoundError('Räkenskapsåret');
  return f;
}

/** Förslag på reserv för befarade kundförluster per bokslutsdagen */
export async function reserve(companyId: number, fyId: number) {
  const f = await fy(companyId, fyId);
  const collections = await sql<{ to_regclass: string | null }[]>`SELECT to_regclass('rk_collections')::text`;
  const hasColl = !!collections[0]?.to_regclass;
  const rows = await sql<{ id: number; number: number | null; customer: string; due: string; remaining: number; voucher_id: number; collection: boolean; disputed: boolean }[]>`
    SELECT i.id, i.invoice_number AS number, c.name AS customer, to_char(i.due_date,'YYYY-MM-DD') AS due, (i.total - i.paid_amount)::float8 AS remaining, i.voucher_id,
      ${hasColl ? sql`EXISTS (SELECT 1 FROM rk_collections r WHERE r.invoice_id = i.id)` : sql`false`} AS collection,
      EXISTS (SELECT 1 FROM invoice_disputes d WHERE d.invoice_id = i.id AND d.status = 'open') AS disputed
    FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.company_id = ${companyId} AND i.status = 'booked' AND i.voucher_id IS NOT NULL AND i.invoice_date <= ${f.end_date} AND i.total > i.paid_amount
    ORDER BY i.due_date`;
  const assessed = new Map((await sql<{ invoice_id: number; pct: number; note: string }[]>`SELECT invoice_id, pct::float8 AS pct, note FROM bad_debt_assessments WHERE company_id = ${companyId}`).map((a) => [a.invoice_id, a]));
  const cands: ReserveCandidate[] = [];
  for (const r of rows) cands.push({ id: r.id, number: r.number, customer: r.customer, due: r.due, remaining: r.remaining, collection: r.collection, disputed: r.disputed, net: vatShare(await invoiceLines(sql, r.voucher_id), r.remaining).net,
    assessed: assessed.get(r.id) ?? null });
  const [b] = await sql<{ b: number }[]>`SELECT COALESCE(-SUM(l.debit - l.credit), 0)::float8 AS b FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND v.date <= ${f.end_date} AND l.account_number = ${DOUBTFUL_RESERVE}`;
  const [w] = await sql<{ n: number; amount: number }[]>`SELECT count(*)::int AS n, COALESCE(SUM(written_off_amount - recovered_amount), 0)::float8 AS amount FROM invoices
    WHERE company_id = ${companyId} AND status = 'written_off' AND written_off_date BETWEEN ${f.start_date} AND ${f.end_date}`;
  return { fy: f, ...reserveProposal(cands, f.end_date, b.b), writtenOff: w };
}

/** Bokför ändringen av reserven per bokslutsdagen (ökning eller upplösning) */
export async function bookReserve(actor: Actor, fyId: number) {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(105001, ${actor.companyId})`;
    const p = await reserve(actor.companyId, fyId);
    if (p.fy.closed) throw new ConflictError('Räkenskapsåret är stängt');
    if (!p.change) throw new ConflictError('Reserven stämmer redan');
    await ensure(tx, actor.companyId);
    const v = await createVoucher(tx, { actor, date: p.fy.end_date, description: p.change > 0 ? `Befarade kundförluster per ${p.fy.end_date} (${p.doubtful.length} fakturor)` : `Upplösning av reserv för befarade kundförluster per ${p.fy.end_date}`,
      lines: fromSigned(p.lines), sourceType: 'bad_debt_reserve', sourceId: fyId });
    await tx`INSERT INTO bad_debt_reserves ${tx({ company_id: actor.companyId, fiscal_year_id: fyId, target: p.target, change: p.change, invoice_ids: p.doubtful.map((d) => d.id), voucher_id: v.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'bad_debt_reserve', 'fiscal_year', fyId, { target: p.target, change: p.change });
    return p;
  });
}

/** Individuell bedömning av en osäker fordran: andel som befaras gå förlorad och motivering (tomt = schablonen gäller) */
export async function assess(actor: Actor, invoiceId: number, input: Record<string, unknown>) {
  const raw = String(input.pct ?? '').trim();
  const [inv] = await sql`SELECT 1 FROM invoices WHERE id = ${invoiceId} AND company_id = ${actor.companyId} AND status = 'booked'`;
  if (!inv) throw new NotFoundError('Fakturan');
  if (!raw) { await sql`DELETE FROM bad_debt_assessments WHERE invoice_id = ${invoiceId} AND company_id = ${actor.companyId}`; return null; }
  const pct = Number(raw.replace(',', '.'));
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new ValidationError('Ange andelen i procent (0–100)');
  const note = String(input.note ?? '').trim().slice(0, 500);
  if (!note) throw new ValidationError('Motivera bedömningen (t.ex. kundens betalningsförmåga, avbetalningsplan, tvist)');
  await sql`INSERT INTO bad_debt_assessments ${sql({ invoice_id: invoiceId, company_id: actor.companyId, pct, note, assessed_by: actor.userId })}
    ON CONFLICT (invoice_id) DO UPDATE SET pct = EXCLUDED.pct, note = EXCLUDED.note, assessed_by = EXCLUDED.assessed_by, assessed_at = now()`;
  await auditBy(sql, actor, 'bad_debt_assess', 'invoice', invoiceId, { pct });
  return pct;
}
