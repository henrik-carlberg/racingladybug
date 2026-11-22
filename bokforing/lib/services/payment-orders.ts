import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { APPLICATION_FEE, FEE_COST, FEE_INCOME, FEE_RECEIVABLE, INTEREST_INCOME, MAX_REMINDER_FEE, NEXT, STATUS_LABEL, allocate, interest, type Status } from '@/lib/payment-order';
import type { Actor } from './actor';
import { date, int, str } from './input';
import { registerPaymentTx } from './invoices';

async function ensure(tx: Tx, companyId: number) {
  await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${FEE_RECEIVABLE}, 'Andra kortfristiga fordringar'), (${companyId}, ${INTEREST_INCOME}, 'Ränteintäkter från kundfordringar'),
    (${companyId}, ${FEE_INCOME}, 'Övriga ersättningar och intäkter'), (${companyId}, ${FEE_COST}, 'Övriga externa kostnader') ON CONFLICT DO NOTHING`;
}

export async function overview(companyId: number) {
  const t = today();
  const orders = await sql<{ id: number; invoice_id: number; number: number; customer: string; orgnr: string; due: string; status: Status; applied_on: string; case_no: string; capital: number; interest_rate: number; reminder_fee: number; fee: number; recovered: number; remaining: number }[]>`
    SELECT o.id, o.invoice_id, i.invoice_number AS number, c.name AS customer, c.orgnr, to_char(i.due_date,'YYYY-MM-DD') AS due, o.status, to_char(o.applied_on,'YYYY-MM-DD') AS applied_on, o.case_no,
      o.capital::float8 AS capital, o.interest_rate::float8 AS interest_rate, o.reminder_fee::float8 AS reminder_fee, o.fee::float8 AS fee, o.recovered::float8 AS recovered, (i.total - i.paid_amount)::float8 AS remaining
    FROM payment_orders o JOIN invoices i ON i.id = o.invoice_id JOIN customers c ON c.id = i.customer_id WHERE o.company_id = ${companyId} ORDER BY o.applied_on DESC, o.id DESC`;
  const candidates = await sql<{ id: number; number: number; customer: string; due: string; remaining: number }[]>`SELECT i.id, i.invoice_number AS number, c.name AS customer, to_char(i.due_date,'YYYY-MM-DD') AS due,
    (i.total - i.paid_amount)::float8 AS remaining FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.company_id = ${companyId} AND i.status = 'booked' AND i.currency = 'SEK' AND i.total > i.paid_amount AND i.due_date < ${t}
      AND NOT EXISTS (SELECT 1 FROM payment_orders o WHERE o.invoice_id = i.id AND o.status NOT IN ('withdrawn','paid')) ORDER BY i.due_date`;
  return { candidates, orders: orders.map((o) => ({ ...o, label: STATUS_LABEL[o.status], next: NEXT[o.status], interestNow: interest(o.capital, o.interest_rate, o.due, t) })) };
}

/** Ansökan: underlag med kapital, ränta och kostnader; ansökningsavgiften betalas och bokas som fordran på gäldenären */
export async function apply(actor: Actor, input: Record<string, unknown>) {
  const invoiceId = int(input, 'invoice_id', 'Faktura');
  const rate = Number(str(input, 'interest_rate').replace(',', '.'));
  if (!Number.isFinite(rate) || rate < 0 || rate > 30) throw new ValidationError('Ange räntesatsen i procent (referensräntan + 8)');
  const reminder = parseAmount(str(input, 'reminder_fee') || '0');
  if (reminder == null || reminder < 0 || reminder > MAX_REMINDER_FEE) throw new ValidationError('Påminnelseavgiften får vara högst 60 kr och ska ha avtalats');
  const d = date(input, 'applied_on', 'Ansökningsdag');
  return sql.begin(async (tx) => {
    const [i] = await tx<{ remaining: number; number: number; due: string; status: string; currency: string }[]>`SELECT (total - paid_amount)::float8 AS remaining, invoice_number AS number, to_char(due_date,'YYYY-MM-DD') AS due, status, currency
      FROM invoices WHERE id = ${invoiceId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!i) throw new NotFoundError('Fakturan');
    if (i.status !== 'booked' || i.remaining <= 0 || i.currency !== 'SEK') throw new ConflictError('Fakturan är inte en obetald faktura i kronor');
    if (i.due >= d) throw new ValidationError('Fakturan har inte förfallit');
    await ensure(tx, actor.companyId);
    const v = await createVoucher(tx, { actor, date: d, description: `Ansökningsavgift betalningsföreläggande, faktura ${i.number} (återkrävs av gäldenären)`,
      lines: fromSigned([{ account: FEE_RECEIVABLE, amount: APPLICATION_FEE }, { account: 1930, amount: -APPLICATION_FEE }]), sourceType: 'payment_order' });
    try {
      await tx`INSERT INTO payment_orders ${tx({ company_id: actor.companyId, invoice_id: invoiceId, applied_on: d, case_no: str(input, 'case_no', { max: 60 }), capital: i.remaining, interest_rate: rate,
        reminder_fee: reminder, fee: APPLICATION_FEE, fee_voucher_id: v.id, created_by: actor.userId })}`;
    } catch (e) { if (String((e as Error).message).includes('payment_orders_active')) throw new ConflictError('Det finns redan ett betalningsföreläggande för fakturan'); throw e; }
    await auditBy(tx, actor, 'payment_order', 'invoice', invoiceId, { capital: i.remaining });
    return { capital: i.remaining, interest: interest(i.remaining, rate, i.due, d) };
  });
}

export async function setStatus(actor: Actor, id: number, input: Record<string, unknown>) {
  const to = str(input, 'status') as Status;
  return sql.begin(async (tx) => {
    const [o] = await tx<{ status: Status; fee: number; recovered: number; number: number }[]>`SELECT o.status, o.fee::float8 AS fee, o.recovered::float8 AS recovered, i.invoice_number AS number
      FROM payment_orders o JOIN invoices i ON i.id = o.invoice_id WHERE o.id = ${id} AND o.company_id = ${actor.companyId} FOR UPDATE OF o`;
    if (!o) throw new NotFoundError('Betalningsföreläggandet');
    if (!NEXT[o.status].includes(to)) throw new ValidationError(`Kan inte gå från ${STATUS_LABEL[o.status].toLowerCase()} till ${STATUS_LABEL[to]?.toLowerCase() ?? to}`);
    // Återkallat: avgiften som inte har betalats av gäldenären blir en kostnad
    if (to === 'withdrawn' && o.fee > o.recovered) {
      await ensure(tx, actor.companyId);
      const left = o.fee - Math.min(o.fee, o.recovered);
      await createVoucher(tx, { actor, date: today(), description: `Återkallat betalningsföreläggande, faktura ${o.number}: ansökningsavgiften kostnadsförs`,
        lines: fromSigned([{ account: FEE_COST, amount: left }, { account: FEE_RECEIVABLE, amount: -left }]), sourceType: 'payment_order' });
    }
    await tx`UPDATE payment_orders SET status = ${to}, case_no = COALESCE(NULLIF(${str(input, 'case_no', { max: 60 })}, ''), case_no) WHERE id = ${id}`;
  });
}

/** Inbetalning via Kronofogden: avräknas mot kostnader, ränta och sist kapitalet (som registreras som betalning på fakturan) */
export async function receive(actor: Actor, id: number, input: Record<string, unknown>) {
  const paid = parseAmount(str(input, 'amount'));
  if (paid == null || paid <= 0) throw new ValidationError('Ange inbetalt belopp');
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const [o] = await tx<{ invoice_id: number; status: Status; capital: number; interest_rate: number; reminder_fee: number; fee: number; recovered: number; interest_paid: number; due: string; remaining: number; number: number }[]>`
      SELECT o.invoice_id, o.status, o.capital::float8 AS capital, o.interest_rate::float8 AS interest_rate, o.reminder_fee::float8 AS reminder_fee, o.fee::float8 AS fee, o.recovered::float8 AS recovered, o.interest_paid::float8 AS interest_paid,
        to_char(i.due_date,'YYYY-MM-DD') AS due, (i.total - i.paid_amount)::float8 AS remaining, i.invoice_number AS number
      FROM payment_orders o JOIN invoices i ON i.id = o.invoice_id WHERE o.id = ${id} AND o.company_id = ${actor.companyId} FOR UPDATE OF o, i`;
    if (!o) throw new NotFoundError('Betalningsföreläggandet');
    if (o.status === 'withdrawn' || o.status === 'paid') throw new ConflictError('Ärendet är avslutat');
    // Kostnader som redan har återvunnits räknas av
    const costsLeft = Math.max(0, o.fee + o.reminder_fee - o.recovered);
    const feeLeft = Math.min(o.fee, costsLeft), reminderLeft = costsLeft - feeLeft;
    const a = allocate(paid, { fee: feeLeft, reminder: reminderLeft, interest: Math.max(0, interest(o.capital, o.interest_rate, o.due, d) - o.interest_paid), capital: o.remaining });
    if (a.excess) throw new ValidationError(`Beloppet är ${(a.excess / 100).toLocaleString('sv-SE')} kr mer än skulden`);
    await ensure(tx, actor.companyId);
    const extra = a.fee + a.reminder + a.interest;
    if (extra) await createVoucher(tx, { actor, date: d, description: `Inbetalning via Kronofogden, faktura ${o.number}: kostnader och dröjsmålsränta`, sourceType: 'payment_order',
      lines: fromSigned([{ account: 1930, amount: extra }, ...(a.fee ? [{ account: FEE_RECEIVABLE, amount: -a.fee }] : []), ...(a.reminder ? [{ account: FEE_INCOME, amount: -a.reminder }] : []), ...(a.interest ? [{ account: INTEREST_INCOME, amount: -a.interest }] : [])]) });
    if (a.capital) await registerPaymentTx(tx, actor, o.invoice_id, { amount: a.capital, date: d });
    await tx`UPDATE payment_orders SET recovered = recovered + ${a.fee + a.reminder}, interest_paid = interest_paid + ${a.interest}, status = CASE WHEN ${a.capital >= o.remaining} THEN 'paid' ELSE status END WHERE id = ${id}`;
    await auditBy(tx, actor, 'payment_order_received', 'invoice', o.invoice_id, a);
    return a;
  });
}
