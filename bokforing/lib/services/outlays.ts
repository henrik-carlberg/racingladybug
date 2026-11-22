import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { OUTLAY_ACCOUNT, invoiceLine, outlayError, paidLines } from '@/lib/outlays';
import type { Actor } from './actor';
import { date, int, str } from './input';
import { saveDraftTx } from './invoices';

export async function overview(companyId: number) {
  const rows = await sql<{ id: number; customer_id: number; customer: string; date: string; description: string; amount: number; invoice_id: number | null; invoice_status: string | null }[]>`
    SELECT o.id, o.customer_id, c.name AS customer, to_char(o.date,'YYYY-MM-DD') AS date, o.description, o.amount::float8 AS amount, o.invoice_id, i.status AS invoice_status
    FROM customer_outlays o JOIN customers c ON c.id = o.customer_id LEFT JOIN invoices i ON i.id = o.invoice_id WHERE o.company_id = ${companyId} ORDER BY o.invoice_id NULLS FIRST, o.date DESC LIMIT 100`;
  const customers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name`;
  return { rows, customers, open: rows.filter((r) => !r.invoice_id).reduce((s, r) => s + r.amount, 0) };
}

/** Utlägget betalas: fordran på kunden (1680) mot bank */
export async function register(actor: Actor, input: Record<string, unknown>) {
  const err = outlayError({ receiptInCustomerName: input.receipt === 'on', onBehalf: input.on_behalf === 'on' });
  if (err) throw new ValidationError(err);
  const customerId = int(input, 'customer_id', 'Kund');
  const amount = parseAmount(str(input, 'amount'));
  if (amount == null || amount <= 0) throw new ValidationError('Ange beloppet i kronor');
  const d = date(input, 'date', 'Datum');
  const what = str(input, 'description', { required: true, label: 'Beskrivning', max: 200 });
  return sql.begin(async (tx) => {
    const [c] = await tx<{ name: string }[]>`SELECT name FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
    if (!c) throw new NotFoundError('Kunden');
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${OUTLAY_ACCOUNT}, 'Andra kortfristiga fordringar') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: `Utlägg för ${c.name}: ${what}`, lines: fromSigned(paidLines(amount)), sourceType: 'customer_outlay' });
    await tx`INSERT INTO customer_outlays ${tx({ company_id: actor.companyId, customer_id: customerId, date: d, description: what, amount, voucher_id: v.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'customer_outlay', 'customer', customerId, { amount });
  });
}

/** Fakturautkast till kunden med alla ofakturerade utlägg som momsfria rader mot 1680 */
export async function invoiceOutlays(actor: Actor, customerId: number) {
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: number; description: string; amount: number }[]>`SELECT id, description, amount::float8 AS amount FROM customer_outlays
      WHERE company_id = ${actor.companyId} AND customer_id = ${customerId} AND invoice_id IS NULL ORDER BY date FOR UPDATE`;
    if (!rows.length) throw new ValidationError('Kunden har inga ofakturerade utlägg');
    const inv = await saveDraftTx(tx, actor, null, { customer_id: customerId, invoice_date: today(), lines: rows.map(invoiceLine), notes: 'Utlägg för er räkning – ingen moms (kvitton bifogas)' });
    await tx`UPDATE customer_outlays SET invoice_id = ${inv.id} WHERE id IN ${tx(rows.map((r) => r.id))}`;
    await auditBy(tx, actor, 'invoice_outlays', 'customer', customerId, { invoice: inv.id });
    return inv.id;
  });
}
