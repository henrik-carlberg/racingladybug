import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { stripe, stripeConfigured } from '@/lib/server/stripe';
import { ACC } from '@/lib/bas';
import { today } from '@/lib/format';
import type { Actor } from './actor';
import { invoiceByToken } from './invoice-send';
import { registerPaymentTx } from './invoices';

/** Kortbetalning kräver plattformens Stripe-nyckel och en webhook-hemlighet för anslutna konton */
export const cardPaymentsAvailable = () => stripeConfigured() && !!process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

/** Plattformsavgift i procent av fakturabeloppet (valfritt, standard 0) */
const feePercent = () => Math.max(0, Number(process.env.PAYMENT_FEE_PERCENT || 0));

export async function paymentStatus(companyId: number) {
  const [c] = await sql<{ account: string | null; enabled: boolean }[]>`SELECT stripe_account_id AS account, stripe_charges_enabled AS enabled FROM companies WHERE id = ${companyId}`;
  return c;
}

/** Skapar (vid behov) ett Stripe-konto för bolaget och returnerar länken till Stripes registrering */
export async function connectStripe(actor: Actor, origin: string): Promise<string> {
  if (!cardPaymentsAvailable()) throw new ValidationError('Kortbetalning är inte uppsatt på tjänsten (STRIPE_SECRET_KEY och STRIPE_CONNECT_WEBHOOK_SECRET)');
  const [c] = await sql<{ account: string | null; email: string; name: string }[]>`SELECT stripe_account_id AS account, email, name FROM companies WHERE id = ${actor.companyId}`;
  let account = c.account;
  if (!account) {
    const a = await stripe<{ id: string }>('POST', '/accounts', {
      type: 'standard', country: 'SE', ...(c.email ? { email: c.email } : {}), business_profile: { name: c.name }, metadata: { company_id: actor.companyId },
    }, { idempotencyKey: `connect-${actor.companyId}` });
    account = a.id;
    await sql`UPDATE companies SET stripe_account_id = ${account} WHERE id = ${actor.companyId}`;
    await auditBy(sql, actor, 'connect_stripe', 'company', actor.companyId, { account });
  }
  const back = `${origin}/c/${actor.companyId}/installningar/betalningar`;
  const link = await stripe<{ url: string }>('POST', '/account_links', { account, refresh_url: `${back}?stripe=refresh`, return_url: `${back}?stripe=return`, type: 'account_onboarding' });
  return link.url;
}

/** Hämtar kontots status från Stripe (anropas när användaren kommer tillbaka, och vid account.updated) */
export async function refreshStripeAccount(companyId: number) {
  const [c] = await sql<{ account: string | null }[]>`SELECT stripe_account_id AS account FROM companies WHERE id = ${companyId}`;
  if (!c?.account) return null;
  const a = await stripe<{ charges_enabled: boolean; details_submitted: boolean }>('GET', `/accounts/${c.account}`);
  await sql`UPDATE companies SET stripe_charges_enabled = ${!!a.charges_enabled} WHERE id = ${companyId}`;
  return a;
}

export async function disconnectStripe(actor: Actor) {
  await sql`UPDATE companies SET stripe_account_id = NULL, stripe_charges_enabled = false WHERE id = ${actor.companyId}`;
  await auditBy(sql, actor, 'disconnect_stripe', 'company', actor.companyId);
}

/** Kan fakturan betalas med kort från kundens länk? */
export async function canPayByCard(invoiceId: number) {
  const [r] = await sql<{ ok: boolean }[]>`
    SELECT (i.status = 'booked' AND i.total > 0 AND i.credit_of_id IS NULL AND c.stripe_charges_enabled AND c.stripe_account_id IS NOT NULL) AS ok
    FROM invoices i JOIN companies c ON c.id = i.company_id WHERE i.id = ${invoiceId}`;
  return !!r?.ok && cardPaymentsAvailable();
}

/** Skapar en Stripe Checkout-session på bolagets konto för fakturans belopp att betala */
export async function createInvoiceCheckout(token: string, origin: string): Promise<string> {
  const ref = await invoiceByToken(token);
  if (!ref || !(await canPayByCard(ref.id))) throw new ValidationError('Fakturan kan inte betalas med kort');
  const [i] = await sql<{ number: number; total: number; company: string; account: string; email: string; ocr: string | null }[]>`
    SELECT i.invoice_number AS number, i.total, co.name AS company, co.stripe_account_id AS account, cu.email, i.ocr
    FROM invoices i JOIN companies co ON co.id = i.company_id JOIN customers cu ON cu.id = i.customer_id WHERE i.id = ${ref.id}`;
  const fee = Math.round((i.total * feePercent()) / 100);
  const s = await stripe<{ id: string; url: string }>('POST', '/checkout/sessions', {
    mode: 'payment',
    line_items: [{ quantity: 1, price_data: { currency: 'sek', unit_amount: i.total, product_data: { name: `Faktura ${i.number} från ${i.company}` } } }],
    success_url: `${origin}/f/${token}?betalning=klar`, cancel_url: `${origin}/f/${token}`,
    client_reference_id: String(ref.id), ...(i.email ? { customer_email: i.email } : {}),
    metadata: { invoice_id: ref.id, company_id: ref.company_id, invoice_number: i.number },
    payment_intent_data: { description: `Faktura ${i.number}${i.ocr ? ` (OCR ${i.ocr})` : ''}`, metadata: { invoice_id: ref.id }, ...(fee ? { application_fee_amount: fee } : {}) },
  }, { account: i.account });
  await sql`INSERT INTO invoice_checkouts (company_id, invoice_id, session_id, amount) VALUES (${ref.company_id}, ${ref.id}, ${s.id}, ${i.total})`;
  return s.url;
}

interface ConnectEvent { type: string; account?: string; created?: number; data: { object: Record<string, unknown> } }

/** Händelser från anslutna Stripe-konton: genomförd kortbetalning bokförs som inbetalning mot 1580 */
export async function handleConnectEvent(e: ConnectEvent) {
  if (e.type === 'account.updated' && e.account) {
    const o = e.data.object as { charges_enabled?: boolean };
    await sql`UPDATE companies SET stripe_charges_enabled = ${!!o.charges_enabled} WHERE stripe_account_id = ${e.account}`;
    return 'account';
  }
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(e.type)) return 'ignored';
  const o = e.data.object as { id: string; payment_status?: string; amount_total?: number };
  if (o.payment_status !== 'paid') return 'pending'; // t.ex. Swish eller bankbetalning som inte är klar än
  const [co] = await sql<{ id: number; owner: number | null }[]>`
    SELECT c.id, (SELECT m.user_id FROM memberships m WHERE m.company_id = c.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) AS owner
    FROM companies c WHERE c.stripe_account_id = ${e.account ?? ''}`;
  if (!co?.owner) return 'unknown_account';
  return sql.begin(async (tx) => {
    const [chk] = await tx<{ id: number; invoice_id: number; amount: number; status: string }[]>`
      SELECT id, invoice_id, amount, status FROM invoice_checkouts WHERE session_id = ${o.id} AND company_id = ${co.id} FOR UPDATE`;
    if (!chk) return 'unknown_session';
    if (chk.status === 'paid') return 'duplicate';
    const [inv] = await tx<{ status: string; total: number }[]>`SELECT status, total FROM invoices WHERE id = ${chk.invoice_id} FOR UPDATE`;
    const actor: Actor = { companyId: co.id, userId: co.owner!, apiKeyId: null, role: 'owner' };
    if (inv.status !== 'booked' || inv.total !== chk.amount || o.amount_total !== chk.amount) {
      // Redan betald på annat sätt eller ändrat belopp: registreras inte automatiskt – syns för manuell hantering
      await tx`UPDATE invoice_checkouts SET status = 'mismatch', paid_at = now() WHERE id = ${chk.id}`;
      await auditBy(tx, actor, 'card_payment_mismatch', 'invoice', chk.invoice_id, { session: o.id, amount: o.amount_total });
      return 'mismatch';
    }
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${co.id}, ${ACC.cardClearing}, 'Fordringar för kontokort och kuponger') ON CONFLICT DO NOTHING`;
    const d = e.created ? new Date(e.created * 1000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }) : today();
    await registerPaymentTx(tx, actor, chk.invoice_id, { date: d, amount: chk.amount, bank_account: ACC.cardClearing });
    await tx`UPDATE invoice_checkouts SET status = 'paid', paid_at = now() WHERE id = ${chk.id}`;
    await auditBy(tx, actor, 'card_payment', 'invoice', chk.invoice_id, { session: o.id });
    return 'paid';
  });
}

/** Kortbetalningar som inte kunde bokföras automatiskt */
export async function paymentIssues(companyId: number) {
  return sql<{ id: number; invoice_id: number; number: number; amount: number; paid_at: string }[]>`
    SELECT k.id, k.invoice_id, i.invoice_number AS number, k.amount, to_char(k.paid_at,'YYYY-MM-DD') AS paid_at
    FROM invoice_checkouts k JOIN invoices i ON i.id = k.invoice_id WHERE k.company_id = ${companyId} AND k.status = 'mismatch' ORDER BY k.paid_at DESC`;
}

export async function resolveIssue(actor: Actor, id: number) {
  const r = await sql`UPDATE invoice_checkouts SET status = 'expired' WHERE id = ${id} AND company_id = ${actor.companyId} AND status = 'mismatch'`;
  if (!r.count) throw new ConflictError('Finns inte');
}
