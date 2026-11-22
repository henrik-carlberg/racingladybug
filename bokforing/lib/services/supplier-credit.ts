import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { applicable, creditLines, refundLines } from '@/lib/supplier-credit';
import type { Actor } from './actor';
import { date, int, str } from './input';

const kronor = (v: unknown, label: string, zero = false) => { const n = parseAmount(String(v ?? '').trim() || (zero ? '0' : '')); if (n == null || n < 0 || (!zero && !n)) throw new ValidationError(`Ange ${label} i kronor`); return n; };

export async function overview(companyId: number) {
  const credits = await sql<{ id: number; supplier_id: number; supplier: string; credit_number: string; date: string; total: number; used: number; original: string | null }[]>`
    SELECT c.id, c.supplier_id, s.name AS supplier, c.credit_number, to_char(c.date,'YYYY-MM-DD') AS date, c.total::float8 AS total, c.used::float8 AS used, o.invoice_number AS original
    FROM supplier_credits c JOIN suppliers s ON s.id = c.supplier_id LEFT JOIN supplier_invoices o ON o.id = c.original_invoice_id WHERE c.company_id = ${companyId} ORDER BY c.date DESC, c.id DESC LIMIT 100`;
  const open = await sql<{ id: number; supplier_id: number; number: string; remaining: number }[]>`SELECT id, supplier_id, invoice_number AS number, (total - paid_amount)::float8 AS remaining
    FROM supplier_invoices WHERE company_id = ${companyId} AND status IN ('booked','approved') AND voucher_id IS NOT NULL AND currency = 'SEK' AND total > paid_amount
      AND NOT EXISTS (SELECT 1 FROM bank_payment_items bi JOIN bank_payments bp ON bp.id = bi.payment_id WHERE bi.supplier_invoice_id = supplier_invoices.id AND bp.status IN ('authorization','accepted','executed'))
    ORDER BY due_date`;
  const invoices = await sql<{ id: number; supplier_id: number; supplier: string; number: string; total: number }[]>`SELECT i.id, i.supplier_id, s.name AS supplier, i.invoice_number AS number, i.total::float8 AS total
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.company_id = ${companyId} AND i.voucher_id IS NOT NULL AND i.currency = 'SEK' ORDER BY i.invoice_date DESC LIMIT 200`;
  return { credits, open, invoices };
}

/** Kvittning av kredit mot öppen faktura i reskontran – skulden är redan minskad av kreditnotans verifikation */
async function applyTx(tx: Tx, actor: Actor, creditId: number, invoiceId: number, d: string) {
  const [c] = await tx<{ supplier_id: number; total: number; used: number; voucher_id: number }[]>`SELECT supplier_id, total::float8 AS total, used::float8 AS used, voucher_id FROM supplier_credits
    WHERE id = ${creditId} AND company_id = ${actor.companyId} FOR UPDATE`;
  if (!c) throw new NotFoundError('Krediten');
  const [i] = await tx<{ supplier_id: number; remaining: number; status: string; currency: string }[]>`SELECT supplier_id, (total - paid_amount)::float8 AS remaining, status, currency FROM supplier_invoices
    WHERE id = ${invoiceId} AND company_id = ${actor.companyId} AND voucher_id IS NOT NULL FOR UPDATE`;
  if (!i) throw new NotFoundError('Fakturan');
  if (i.supplier_id !== c.supplier_id) throw new ValidationError('Krediten kan bara kvittas mot en faktura från samma leverantör');
  if (i.currency !== 'SEK' || !['booked', 'approved'].includes(i.status)) throw new ConflictError('Fakturan är redan betald');
  const [busy] = await tx`SELECT 1 FROM bank_payment_items bi JOIN bank_payments bp ON bp.id = bi.payment_id WHERE bi.supplier_invoice_id = ${invoiceId} AND bp.status IN ('authorization','accepted','executed')`;
  if (busy) throw new ConflictError('Fakturan ingår i en pågående bankbetalning');
  const amount = applicable(c.total - c.used, i.remaining);
  if (!amount) throw new ValidationError('Det finns inget att kvitta');
  await tx`INSERT INTO supplier_invoice_payments (company_id, supplier_invoice_id, date, amount, voucher_id) VALUES (${actor.companyId}, ${invoiceId}, ${d}, ${amount}, ${c.voucher_id})`;
  await tx`UPDATE supplier_invoices SET paid_amount = paid_amount + ${amount}, status = CASE WHEN paid_amount + ${amount} >= total THEN 'paid' ELSE status END,
    paid_date = CASE WHEN paid_amount + ${amount} >= total THEN ${d}::date ELSE paid_date END WHERE id = ${invoiceId}`;
  await tx`UPDATE supplier_credits SET used = used + ${amount} WHERE id = ${creditId}`;
  await tx`INSERT INTO supplier_credit_uses ${tx({ credit_id: creditId, kind: 'applied', supplier_invoice_id: invoiceId, amount, date: d, voucher_id: c.voucher_id })}`;
  return amount;
}

/** Registrerar kreditnotan; avser den en obetald faktura kvittas den direkt mot den */
export async function register(actor: Actor, input: Record<string, unknown>) {
  const originalId = int(input, 'original_invoice_id', 'Ursprunglig faktura');
  const total = kronor(input.total, 'kreditbeloppet inkl. moms'), vat = kronor(input.vat, 'momsen', true);
  if (vat >= total) throw new ValidationError('Momsen ska vara mindre än kreditbeloppet');
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const [o] = await tx<{ supplier_id: number; total: number; vat: number; cost_lines: { account: number; amount: number }[] | null; account: number; remaining: number; status: string }[]>`
      SELECT i.supplier_id, i.total::float8 AS total, i.vat::float8 AS vat, i.cost_lines, s.default_account AS account, (i.total - i.paid_amount)::float8 AS remaining, i.status
      FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.id = ${originalId} AND i.company_id = ${actor.companyId} AND i.voucher_id IS NOT NULL AND i.currency = 'SEK' FOR UPDATE OF i`;
    if (!o) throw new NotFoundError('Den ursprungliga fakturan');
    const [{ credited }] = await tx<{ credited: number }[]>`SELECT COALESCE(SUM(total), 0)::float8 AS credited FROM supplier_credits WHERE original_invoice_id = ${originalId}`;
    if (credited + total > o.total) throw new ValidationError(`Krediterat sammanlagt får inte överstiga fakturans belopp (${(o.total / 100).toLocaleString('sv-SE')} kr)`);
    // Kostnaden krediteras på den ursprungliga fakturans huvudkonto
    const account = o.cost_lines?.find((l) => l.amount > 0 && l.account >= 4000)?.account ?? o.account;
    const v = await createVoucher(tx, { actor, date: d, description: `Kreditfaktura ${str(input, 'credit_number')} avser faktura ${originalId}`, lines: fromSigned(creditLines([{ account, amount: total - vat }], vat)), sourceType: 'supplier_credit' });
    const [c] = await tx<{ id: number }[]>`INSERT INTO supplier_credits ${tx({ company_id: actor.companyId, supplier_id: o.supplier_id, original_invoice_id: originalId,
      credit_number: str(input, 'credit_number', { required: true, label: 'Kreditfakturans nummer', max: 60 }), date: d, total, vat, voucher_id: v.id, created_by: actor.userId })} RETURNING id`;
    const applied = o.remaining > 0 && ['booked', 'approved'].includes(o.status) ? await applyTx(tx, actor, c.id, originalId, d).catch((e) => { if (e instanceof ConflictError) return 0; throw e; }) : 0;
    await auditBy(tx, actor, 'supplier_credit', 'supplier_invoice', originalId, { total, applied });
    return { applied, left: total - applied };
  }).catch((e) => { if (String((e as Error).message).includes('supplier_credits_company_id_supplier_id_credit_number_key')) throw new ConflictError('Kreditfakturan är redan registrerad'); throw e; });
}

export async function apply(actor: Actor, creditId: number, input: Record<string, unknown>) {
  const invoiceId = int(input, 'invoice_id', 'Faktura');
  return sql.begin((tx) => applyTx(tx, actor, creditId, invoiceId, date(input, 'date', 'Datum', false) || new Date().toISOString().slice(0, 10)));
}

/** Leverantören betalar tillbaka krediten */
export async function refund(actor: Actor, creditId: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const [c] = await tx<{ total: number; used: number; credit_number: string }[]>`SELECT total::float8 AS total, used::float8 AS used, credit_number FROM supplier_credits WHERE id = ${creditId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!c) throw new NotFoundError('Krediten');
    const left = c.total - c.used;
    if (!left) throw new ConflictError('Krediten är redan använd');
    const v = await createVoucher(tx, { actor, date: d, description: `Återbetald kredit ${c.credit_number} från leverantör`, lines: fromSigned(refundLines(left)), sourceType: 'supplier_credit' });
    await tx`UPDATE supplier_credits SET used = total WHERE id = ${creditId}`;
    await tx`INSERT INTO supplier_credit_uses ${tx({ credit_id: creditId, kind: 'refunded', amount: left, date: d, voucher_id: v.id })}`;
    return left;
  });
}
