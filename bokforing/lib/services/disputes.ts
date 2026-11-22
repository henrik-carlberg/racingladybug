import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { REDUCTION_ACCOUNT, reductionLines } from '@/lib/disputes';
import type { Actor } from './actor';
import { date, int, str } from './input';
import { registerPaymentTx } from './invoices';

/** Kastar om fakturan är tvistig – påminnelser, inkasso och betalningsföreläggande väntar tills tvisten är avslutad */
export async function assertNotDisputed(db: Tx | typeof sql, invoiceId: number) {
  const [d] = await db`SELECT 1 FROM invoice_disputes WHERE invoice_id = ${invoiceId} AND status = 'open'`;
  if (d) throw new ConflictError('Fakturan är tvistig – påminnelser, inkasso och betalningsföreläggande är pausade tills tvisten är avslutad');
}

export async function overview(companyId: number) {
  const disputes = await sql<{ id: number; invoice_id: number; number: number; customer: string; opened_on: string; reason: string; status: string; closed_on: string | null; agreed_amount: number | null; reduction: number | null; remaining: number; total: number }[]>`
    SELECT d.id, d.invoice_id, i.invoice_number AS number, c.name AS customer, to_char(d.opened_on,'YYYY-MM-DD') AS opened_on, d.reason, d.status, to_char(d.closed_on,'YYYY-MM-DD') AS closed_on,
      d.agreed_amount::float8 AS agreed_amount, d.reduction::float8 AS reduction, (i.total - i.paid_amount)::float8 AS remaining, i.total::float8 AS total
    FROM invoice_disputes d JOIN invoices i ON i.id = d.invoice_id JOIN customers c ON c.id = i.customer_id WHERE d.company_id = ${companyId} ORDER BY d.status = 'open' DESC, d.opened_on DESC LIMIT 200`;
  const candidates = await sql<{ id: number; number: number; customer: string; remaining: number }[]>`SELECT i.id, i.invoice_number AS number, c.name AS customer, (i.total - i.paid_amount)::float8 AS remaining
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.company_id = ${companyId} AND i.status = 'booked' AND i.total > i.paid_amount
      AND NOT EXISTS (SELECT 1 FROM invoice_disputes d WHERE d.invoice_id = i.id AND d.status = 'open') ORDER BY i.due_date LIMIT 300`;
  return { disputes, candidates, open: disputes.filter((d) => d.status === 'open') };
}

export async function openDispute(actor: Actor, input: Record<string, unknown>) {
  const invoiceId = int(input, 'invoice_id', 'Faktura');
  const reason = str(input, 'reason', { required: true, label: 'Vad kunden invänder', max: 1000 });
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const [i] = await tx<{ status: string }[]>`SELECT status FROM invoices WHERE id = ${invoiceId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!i) throw new NotFoundError('Fakturan');
    if (i.status !== 'booked') throw new ConflictError('Bara obetalda fakturor kan markeras som tvistiga');
    const [open] = await tx`SELECT 1 FROM invoice_disputes WHERE invoice_id = ${invoiceId} AND status = 'open'`;
    if (open) throw new ConflictError('Fakturan är redan markerad som tvistig');
    const [po] = await tx`SELECT 1 FROM payment_orders WHERE invoice_id = ${invoiceId} AND status IN ('applied','ruling','enforcement')`;
    const [r] = await tx<{ id: number }[]>`INSERT INTO invoice_disputes ${tx({ company_id: actor.companyId, invoice_id: invoiceId, opened_on: d, reason, created_by: actor.userId })} RETURNING id`;
    await auditBy(tx, actor, 'dispute_opened', 'invoice', invoiceId, { reason });
    return { id: r.id, paymentOrder: !!po };
  });
}

const lock = async (tx: Tx, actor: Actor, id: number) => {
  const [d] = await tx<{ invoice_id: number; status: string }[]>`SELECT invoice_id, status FROM invoice_disputes WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
  if (!d) throw new NotFoundError('Tvisten');
  if (d.status !== 'open') throw new ConflictError('Tvisten är redan avslutad');
  return d;
};

/** Kunden drar tillbaka invändningen eller har betalat hela fakturan – påminnelserna fortsätter om något återstår */
export async function close(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const x = await lock(tx, actor, id);
    const [i] = await tx<{ status: string }[]>`SELECT status FROM invoices WHERE id = ${x.invoice_id}`;
    const status = i.status === 'paid' ? 'paid' : 'withdrawn';
    await tx`UPDATE invoice_disputes SET status = ${status}, closed_on = ${d} WHERE id = ${id}`;
    await auditBy(tx, actor, 'dispute_closed', 'invoice', x.invoice_id, { status });
    return status;
  });
}

/** Förlikning: kunden betalar det avtalade beloppet, resten sätts ned med momsreduktion och fakturan är reglerad */
export async function settle(actor: Actor, id: number, input: Record<string, unknown>) {
  const agreed = parseAmount(String(input.agreed ?? '').trim() || '');
  if (agreed == null || agreed < 0) throw new ValidationError('Ange det avtalade beloppet i kronor (0 om hela fakturan stryks)');
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const x = await lock(tx, actor, id);
    const [i] = await tx<{ status: string; remaining: number; voucher_id: number | null; currency: string; number: number; customer: string }[]>`
      SELECT i.status, (i.total - i.paid_amount)::float8 AS remaining, i.voucher_id, i.currency, i.invoice_number AS number, c.name AS customer
      FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${x.invoice_id} FOR UPDATE OF i`;
    if (i.status !== 'booked' || i.remaining <= 0) throw new ConflictError('Fakturan är inte obetald');
    if (!i.voucher_id || i.currency !== 'SEK') throw new ConflictError('Förlikning stöds för fakturor i kronor som är bokförda enligt faktureringsmetoden');
    if (agreed >= i.remaining) throw new ValidationError(`Det avtalade beloppet ska vara lägre än det som återstår (${(i.remaining / 100).toLocaleString('sv-SE')} kr) – annars avslutas tvisten med vanlig betalning`);
    if (agreed > 0) await registerPaymentTx(tx, actor, x.invoice_id, { amount: agreed, date: d });
    const reduction = i.remaining - agreed;
    const lines = await tx<{ account: number; amount: number }[]>`SELECT account_number AS account, SUM(debit - credit)::float8 AS amount FROM voucher_lines WHERE voucher_id = ${i.voucher_id} GROUP BY account_number`;
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${REDUCTION_ACCOUNT}, 'Lämnade rabatter') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: `Förlikning faktura ${i.number}, ${i.customer}: nedsättning`, lines: fromSigned(reductionLines(lines, reduction)), sourceType: 'dispute_settlement', sourceId: id, series: 'B' });
    await tx`INSERT INTO invoice_payments (company_id, invoice_id, date, amount, voucher_id) VALUES (${actor.companyId}, ${x.invoice_id}, ${d}, ${reduction}, ${v.id})`;
    await tx`UPDATE invoices SET paid_amount = paid_amount + ${reduction}, status = 'paid', paid_date = ${d} WHERE id = ${x.invoice_id}`;
    await tx`UPDATE invoice_disputes SET status = 'settled', closed_on = ${d}, agreed_amount = ${agreed}, reduction = ${reduction}, voucher_id = ${v.id} WHERE id = ${id}`;
    await auditBy(tx, actor, 'dispute_settled', 'invoice', x.invoice_id, { agreed, reduction });
    return { agreed, reduction };
  });
}
