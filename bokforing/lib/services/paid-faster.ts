import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { emit } from '@/lib/server/events';
import { today } from '@/lib/format';
import { installmentPlan, mapSwishStatus, planStatus, swishMessage, swishPayer } from '@/lib/paid-faster';
import { createPaymentRequest, getPaymentRequest, swishConfigured } from '@/lib/server/swish';
import type { Actor } from './actor';
import { invoiceByToken } from './invoice-send';
import { registerPaymentTx } from './invoices';

const ownerActor = async (companyId: number): Promise<Actor> => {
  const [m] = await sql<{ user_id: number }[]>`SELECT user_id FROM memberships WHERE company_id = ${companyId} AND role = 'owner' ORDER BY user_id LIMIT 1`;
  return { companyId, userId: m.user_id, apiKeyId: null, role: 'owner' };
};

export async function installments(invoiceId: number) {
  return [...await sql<{ n: number; due: string; amount: number }[]>`SELECT n, to_char(due_date,'YYYY-MM-DD') AS due, amount::float8 AS amount FROM invoice_installments WHERE invoice_id = ${invoiceId} ORDER BY n`];
}

interface PayInfo { id: number; company_id: number; number: number; status: string; remaining: number; paid: number; due: string; ocr: string | null; currency: string; swish_number: string; swish_commerce: boolean }
async function payInfo(invoiceId: number): Promise<PayInfo> {
  const [i] = await sql<PayInfo[]>`SELECT i.id, i.company_id, i.invoice_number AS number, i.status, (i.total - i.paid_amount)::float8 AS remaining, i.paid_amount::float8 AS paid,
      to_char(i.due_date,'YYYY-MM-DD') AS due, i.ocr, i.currency, c.swish_number, c.swish_commerce FROM invoices i JOIN companies c ON c.id = i.company_id WHERE i.id = ${invoiceId}`;
  if (!i) throw new NotFoundError('Fakturan');
  return i;
}

/** Belopp att betala nu: hela resten, eller med delbetalningsplan det som förfallit plus nästa del */
async function amountNow(i: PayInfo) {
  const plan = await installments(i.id);
  if (!plan.length) return i.remaining;
  const s = planStatus(plan, i.paid, today());
  return Math.min(i.remaining, Math.max(s.overdue, s.next?.left ?? 0) || i.remaining);
}

export async function swishAvailable(invoiceId: number) {
  if (!swishConfigured()) return null;
  const i = await payInfo(invoiceId);
  if (!i.swish_commerce || !i.swish_number || i.status !== 'booked' || i.currency !== 'SEK' || i.remaining <= 0) return null;
  return { amount: await amountNow(i) };
}

/** Kunden startar en Swish-betalning från fakturalänken. Med mobilnummer skickas förfrågan till appen, annars öppnas appen på samma telefon. */
export async function startSwish(token: string, phone: string, origin: string) {
  const ref = await invoiceByToken(token);
  if (!ref) throw new NotFoundError('Fakturan');
  const i = await payInfo(ref.id);
  const avail = await swishAvailable(ref.id);
  if (!avail) throw new ValidationError('Swish är inte tillgängligt för fakturan');
  const payer = phone ? swishPayer(phone) : null;
  if (phone && !payer) throw new ValidationError('Ange ett svenskt mobilnummer');
  const pending = await sql`SELECT 1 FROM swish_payments WHERE invoice_id = ${i.id} AND status = 'created' AND created_at > now() - interval '3 minutes'`;
  if (pending.length) throw new ConflictError('En Swish-betalning väntar redan – godkänn den i appen eller vänta tre minuter');
  const instruction = randomBytes(16).toString('hex').toUpperCase();
  const amount = avail.amount;
  await sql`INSERT INTO swish_payments (company_id, invoice_id, instruction_id, amount, payer) VALUES (${i.company_id}, ${i.id}, ${instruction}, ${amount}, ${payer})`;
  try {
    const r = await createPaymentRequest(instruction, { payeePaymentReference: (i.ocr ?? String(i.number)).slice(0, 35), callbackUrl: `${origin}/api/swish/callback`, payeeAlias: i.swish_number.replace(/\D/g, ''),
      amount: (amount / 100).toFixed(2), currency: 'SEK', message: swishMessage(`Faktura ${i.number}`), ...(payer ? { payerAlias: payer } : {}) });
    return { instruction, token: r.token };
  } catch (e) {
    await sql`UPDATE swish_payments SET status = 'error', message = ${e instanceof Error ? e.message.slice(0, 300) : 'Fel'} WHERE instruction_id = ${instruction}`;
    throw e;
  }
}

/** Status hämtas alltid från Swish (anropet till callback-adressen kan komma från vem som helst). Betald → inbetalningen bokförs på fakturan. */
export async function checkSwish(instruction: string) {
  if (!/^[0-9A-F]{32}$/.test(instruction)) throw new NotFoundError('Betalningen');
  const [p] = await sql<{ id: number; company_id: number; invoice_id: number; amount: number; status: string }[]>`SELECT id, company_id, invoice_id, amount::float8 AS amount, status FROM swish_payments WHERE instruction_id = ${instruction}`;
  if (!p) throw new NotFoundError('Betalningen');
  if (p.status !== 'created') return p.status;
  const r = await getPaymentRequest(instruction);
  const st = mapSwishStatus(r.status);
  if (st === 'created') return st;
  const actor = await ownerActor(p.company_id);
  await sql.begin(async (tx) => {
    const [cur] = await tx<{ status: string }[]>`SELECT status FROM swish_payments WHERE id = ${p.id} FOR UPDATE`;
    if (cur.status !== 'created') return;
    const paid = st === 'paid' && Math.round(Number(r.amount) * 100) === p.amount;
    await tx`UPDATE swish_payments SET status = ${paid || st !== 'paid' ? st : 'error'}, reference = ${r.paymentReference ?? null}, message = ${paid || st !== 'paid' ? (r.errorMessage ?? '') : 'Beloppet stämmer inte'},
      paid_at = ${paid ? new Date() : null}, updated_at = now() WHERE id = ${p.id}`;
    if (paid) {
      const [inv] = await tx<{ remaining: number; status: string }[]>`SELECT (total - paid_amount)::float8 AS remaining, status FROM invoices WHERE id = ${p.invoice_id} FOR UPDATE`;
      if (inv.status === 'booked' && inv.remaining >= p.amount) {
        await registerPaymentTx(tx, actor, p.invoice_id, { date: (r.datePaid ?? new Date().toISOString()).slice(0, 10), amount: p.amount, bank_account: 1930 });
        await emit(tx, p.company_id, 'invoice.swish.paid', { invoice_id: p.invoice_id, amount: p.amount, reference: r.paymentReference ?? null });
      } else await tx`UPDATE swish_payments SET message = 'Fakturan var redan betald – betala tillbaka i Swish' WHERE id = ${p.id}`;
    }
  });
  return st;
}

export async function swishStatusFor(token: string, instruction: string) {
  const ref = await invoiceByToken(token);
  if (!ref) return null;
  const [p] = await sql<{ status: string; amount: number; message: string }[]>`SELECT status, amount::float8 AS amount, message FROM swish_payments WHERE instruction_id = ${instruction} AND invoice_id = ${ref.id}`;
  return p ?? null;
}

/** Nattlig kontroll av Swish-betalningar som inte fått något svar */
export async function refreshSwish() {
  let n = 0;
  for (const p of await sql<{ instruction_id: string }[]>`SELECT instruction_id FROM swish_payments WHERE status = 'created' AND created_at > now() - interval '2 days'`) {
    try { if ((await checkSwish(p.instruction_id)) !== 'created') n++; } catch (e) { console.error('swish', e instanceof Error ? e.message : e); }
  }
  await sql`UPDATE swish_payments SET status = 'cancelled', updated_at = now() WHERE status = 'created' AND created_at <= now() - interval '2 days'`;
  return n;
}

// ---------- Delbetalning som kunden väljer ----------
export async function planOptions(companyId: number, invoiceId: number) {
  const [c] = await sql<{ max: number; min: number }[]>`SELECT part_payment_max AS max, part_payment_min::float8 AS min FROM companies WHERE id = ${companyId}`;
  if (!c || c.max < 2) return null;
  const i = await payInfo(invoiceId);
  if (i.company_id !== companyId || i.status !== 'booked' || i.remaining < c.min || i.paid > 0) return null;
  if ((await installments(invoiceId)).length) return null;
  if ((await sql`SELECT 1 FROM rk_collections WHERE invoice_id = ${invoiceId}`).length) return null;
  const first = i.due < today() ? today() : i.due;
  return { max: c.max, options: Array.from({ length: c.max - 1 }, (_, k) => ({ n: k + 2, plan: installmentPlan(i.remaining, k + 2, first) })) };
}

/** Kunden väljer delbetalning i portalen (fakturan ska tillhöra portalens kund) */
export async function choosePlan(companyId: number, customerId: number, invoiceId: number, n: number) {
  const [own] = await sql`SELECT 1 FROM invoices WHERE id = ${invoiceId} AND company_id = ${companyId} AND customer_id = ${customerId}`;
  if (!own) throw new NotFoundError('Fakturan');
  return sql.begin(async (tx) => {
    await tx`SELECT 1 FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
    const o = await planOptions(companyId, invoiceId);
    const opt = o?.options.find((x) => x.n === n);
    if (!opt) throw new ValidationError('Delbetalning går inte att välja för fakturan');
    for (const p of opt.plan) await tx`INSERT INTO invoice_installments (invoice_id, n, due_date, amount) VALUES (${invoiceId}, ${p.n}, ${p.due}, ${p.amount})`;
    await tx`UPDATE invoices SET plan_chosen_at = now() WHERE id = ${invoiceId}`;
    await emit(tx, companyId, 'invoice.plan.chosen', { invoice_id: invoiceId, installments: opt.plan });
    return opt.plan;
  });
}
