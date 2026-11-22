import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { PREPAYMENT_ACCOUNT, prepayLines, refundLines, settleLines } from '@/lib/supplier-prepayment';
import type { Actor } from './actor';
import { date, int, str } from './input';

export async function overview(companyId: number) {
  const list = await sql<{ id: number; supplier_id: number; supplier: string; date: string; amount: number; used: number; note: string }[]>`
    SELECT p.id, p.supplier_id, s.name AS supplier, to_char(p.date,'YYYY-MM-DD') AS date, p.amount::float8 AS amount, p.used::float8 AS used, p.note
    FROM supplier_prepayments p JOIN suppliers s ON s.id = p.supplier_id WHERE p.company_id = ${companyId} ORDER BY p.date DESC, p.id DESC LIMIT 200`;
  const open = await sql<{ id: number; supplier_id: number; number: string; remaining: number }[]>`SELECT id, supplier_id, invoice_number AS number, (total - paid_amount)::float8 AS remaining
    FROM supplier_invoices WHERE company_id = ${companyId} AND status IN ('booked','approved') AND voucher_id IS NOT NULL AND currency = 'SEK' AND total > paid_amount
      AND NOT EXISTS (SELECT 1 FROM bank_payment_items bi JOIN bank_payments bp ON bp.id = bi.payment_id WHERE bi.supplier_invoice_id = supplier_invoices.id AND bp.status IN ('authorization','accepted','executed'))
    ORDER BY due_date`;
  const suppliers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM suppliers WHERE company_id = ${companyId} ORDER BY name`;
  const sums = await accountSums(companyId, '1900-01-01', today());
  const ledger = Number(sums.get(PREPAYMENT_ACCOUNT) ?? 0);
  const outstanding = list.reduce((s, p) => s + p.amount - p.used, 0);
  return { list, open, suppliers, ledger, outstanding };
}

/** Betalt förskott till leverantören */
export async function prepay(actor: Actor, input: Record<string, unknown>) {
  const supplierId = int(input, 'supplier_id', 'Leverantör');
  const amount = parseAmount(String(input.amount ?? ''));
  if (amount == null || amount <= 0) throw new ValidationError('Ange förskottet i kronor');
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const [s] = await tx<{ name: string }[]>`SELECT name FROM suppliers WHERE id = ${supplierId} AND company_id = ${actor.companyId}`;
    if (!s) throw new ValidationError('Leverantören finns inte');
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${PREPAYMENT_ACCOUNT}, 'Förskott för varor och tjänster') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: `Förskott till ${s.name}`, lines: fromSigned(prepayLines(amount)), sourceType: 'supplier_prepayment' });
    const [p] = await tx<{ id: number }[]>`INSERT INTO supplier_prepayments ${tx({ company_id: actor.companyId, supplier_id: supplierId, date: d, amount, note: str(input, 'note', { max: 300 }), voucher_id: v.id, created_by: actor.userId })} RETURNING id`;
    await auditBy(tx, actor, 'supplier_prepayment', 'supplier_prepayment', p.id, { amount });
    return p.id;
  });
}

/** Avräkna förskottet mot en bokförd faktura från samma leverantör – bara mellanskillnaden återstår att betala */
export async function settle(actor: Actor, prepaymentId: number, input: Record<string, unknown>) {
  const invoiceId = int(input, 'invoice_id', 'Faktura');
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const [p] = await tx<{ supplier_id: number; amount: number; used: number }[]>`SELECT supplier_id, amount::float8 AS amount, used::float8 AS used FROM supplier_prepayments
      WHERE id = ${prepaymentId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!p) throw new NotFoundError('Förskottet');
    const [i] = await tx<{ supplier_id: number; number: string; remaining: number; status: string; currency: string }[]>`SELECT supplier_id, invoice_number AS number, (total - paid_amount)::float8 AS remaining, status, currency
      FROM supplier_invoices WHERE id = ${invoiceId} AND company_id = ${actor.companyId} AND voucher_id IS NOT NULL FOR UPDATE`;
    if (!i) throw new NotFoundError('Fakturan');
    if (i.supplier_id !== p.supplier_id) throw new ValidationError('Förskottet kan bara avräknas mot en faktura från samma leverantör');
    if (i.currency !== 'SEK' || !['booked', 'approved'].includes(i.status) || i.remaining <= 0) throw new ConflictError('Fakturan är redan betald');
    const [busy] = await tx`SELECT 1 FROM bank_payment_items bi JOIN bank_payments bp ON bp.id = bi.payment_id WHERE bi.supplier_invoice_id = ${invoiceId} AND bp.status IN ('authorization','accepted','executed')`;
    if (busy) throw new ConflictError('Fakturan ingår i en pågående bankbetalning');
    const amount = Math.min(p.amount - p.used, i.remaining);
    if (amount <= 0) throw new ConflictError('Förskottet är redan avräknat');
    const v = await createVoucher(tx, { actor, date: d, description: `Avräknat förskott mot faktura ${i.number}`, lines: fromSigned(settleLines(amount)), sourceType: 'supplier_prepayment', sourceId: prepaymentId });
    await tx`INSERT INTO supplier_invoice_payments (company_id, supplier_invoice_id, date, amount, voucher_id) VALUES (${actor.companyId}, ${invoiceId}, ${d}, ${amount}, ${v.id})`;
    await tx`UPDATE supplier_invoices SET paid_amount = paid_amount + ${amount}, status = CASE WHEN paid_amount + ${amount} >= total THEN 'paid' ELSE status END,
      paid_date = CASE WHEN paid_amount + ${amount} >= total THEN ${d}::date ELSE paid_date END WHERE id = ${invoiceId}`;
    await tx`UPDATE supplier_prepayments SET used = used + ${amount} WHERE id = ${prepaymentId}`;
    await tx`INSERT INTO supplier_prepayment_uses ${tx({ prepayment_id: prepaymentId, kind: 'settled', supplier_invoice_id: invoiceId, amount, date: d, voucher_id: v.id })}`;
    await auditBy(tx, actor, 'supplier_prepayment_settled', 'supplier_invoice', invoiceId, { prepayment_id: prepaymentId, amount });
    return { amount, left: i.remaining - amount };
  });
}

/** Leverantören betalar tillbaka det som inte har avräknats */
export async function refund(actor: Actor, prepaymentId: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const [p] = await tx<{ amount: number; used: number }[]>`SELECT amount::float8 AS amount, used::float8 AS used FROM supplier_prepayments WHERE id = ${prepaymentId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!p) throw new NotFoundError('Förskottet');
    const left = p.amount - p.used;
    if (left <= 0) throw new ConflictError('Förskottet är redan avräknat');
    const v = await createVoucher(tx, { actor, date: d, description: 'Återbetalt förskott från leverantör', lines: fromSigned(refundLines(left)), sourceType: 'supplier_prepayment', sourceId: prepaymentId });
    await tx`UPDATE supplier_prepayments SET used = amount WHERE id = ${prepaymentId}`;
    await tx`INSERT INTO supplier_prepayment_uses ${tx({ prepayment_id: prepaymentId, kind: 'refunded', amount: left, date: d, voucher_id: v.id })}`;
    await auditBy(tx, actor, 'supplier_prepayment_refunded', 'supplier_prepayment', prepaymentId, { amount: left });
    return left;
  });
}
