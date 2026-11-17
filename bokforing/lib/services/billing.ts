import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { stripe, stripeConfigured } from '@/lib/server/stripe';
import { TRIAL_DAYS, monthlyPrice } from '@/lib/billing';
import { companyAccess } from '@/lib/server/auth';
import { addDays, today } from '@/lib/format';
import type { Actor } from './actor';

export async function startTrial(db: typeof sql | Tx, companyId: number) {
  await db`INSERT INTO subscriptions (company_id, status, trial_ends_at) VALUES (${companyId}, 'trialing', ${addDays(today(), TRIAL_DAYS)}) ON CONFLICT DO NOTHING`;
}

export async function enabledModuleIds(companyId: number) {
  return (await sql<{ module_id: string }[]>`SELECT module_id FROM company_modules WHERE company_id = ${companyId} ORDER BY module_id`).map((r) => r.module_id);
}

export async function billingOverview(companyId: number) {
  const [s] = await sql<{ status: string; trial_ends_at: string; stripe_customer_id: string | null; stripe_subscription_id: string | null; current_period_end: string | null; cancel_at_period_end: boolean; exempt: boolean }[]>`
    SELECT s.status, to_char(s.trial_ends_at,'YYYY-MM-DD') AS trial_ends_at, s.stripe_customer_id, s.stripe_subscription_id, to_char(s.current_period_end,'YYYY-MM-DD') AS current_period_end,
      COALESCE(s.cancel_at_period_end, false) AS cancel_at_period_end, c.billing_exempt AS exempt
    FROM companies c LEFT JOIN subscriptions s ON s.company_id = c.id WHERE c.id = ${companyId}`;
  return { ...s, access: await companyAccess(companyId), price: monthlyPrice(await enabledModuleIds(companyId)), stripe: stripeConfigured() };
}

const productName = (name: string) => `Bokföring – ${name}`;

/** Stripe Checkout för abonnemang. Priset = grundpris + aktiverade moduler. */
export async function checkout(actor: Actor, origin: string, email: string) {
  if (!stripeConfigured()) throw new ValidationError('Betalning är inte konfigurerad (STRIPE_SECRET_KEY saknas)');
  const [c] = await sql<{ name: string; orgnr: string }[]>`SELECT name, orgnr FROM companies WHERE id = ${actor.companyId}`;
  const [s] = await sql<{ stripe_customer_id: string | null }[]>`SELECT stripe_customer_id FROM subscriptions WHERE company_id = ${actor.companyId}`;
  const price = monthlyPrice(await enabledModuleIds(actor.companyId));
  const session = await stripe<{ id: string; url: string }>('POST', '/checkout/sessions', {
    mode: 'subscription', client_reference_id: String(actor.companyId),
    ...(s?.stripe_customer_id ? { customer: s.stripe_customer_id } : { customer_email: email }),
    line_items: [{ quantity: 1, price_data: { currency: 'sek', unit_amount: price.total, recurring: { interval: 'month' }, product_data: { name: productName(c.name) } } }],
    subscription_data: { metadata: { company_id: String(actor.companyId) }, ...(process.env.STRIPE_TAX_RATE_ID ? { default_tax_rates: [process.env.STRIPE_TAX_RATE_ID] } : {}) }, metadata: { company_id: String(actor.companyId), orgnr: c.orgnr },
    automatic_tax: { enabled: 'false' }, tax_id_collection: { enabled: 'true' }, allow_promotion_codes: 'true',
    success_url: `${origin}/c/${actor.companyId}/abonnemang?ok=${encodeURIComponent('Tack! Abonnemanget är startat.')}`,
    cancel_url: `${origin}/c/${actor.companyId}/abonnemang`,
  });
  await auditBy(sql, actor, 'checkout', 'subscription', actor.companyId, { amount: price.total });
  return session.url;
}

/** Stripes kundportal: byta kort, se kvitton, avsluta */
export async function portal(actor: Actor, origin: string) {
  const [s] = await sql<{ stripe_customer_id: string | null }[]>`SELECT stripe_customer_id FROM subscriptions WHERE company_id = ${actor.companyId}`;
  if (!s?.stripe_customer_id) throw new ValidationError('Det finns inget abonnemang att hantera');
  const p = await stripe<{ url: string }>('POST', '/billing_portal/sessions', { customer: s.stripe_customer_id, return_url: `${origin}/c/${actor.companyId}/abonnemang` });
  return p.url;
}

/** När moduler slås på eller av: uppdatera abonnemangets pris (proportioneras av Stripe) */
export async function syncPrice(companyId: number) {
  if (!stripeConfigured()) return;
  const [s] = await sql<{ stripe_subscription_id: string | null; status: string; name: string }[]>`SELECT s.stripe_subscription_id, s.status, c.name FROM subscriptions s
    JOIN companies c ON c.id = s.company_id WHERE s.company_id = ${companyId}`;
  if (!s?.stripe_subscription_id || !['active', 'past_due'].includes(s.status)) return;
  const price = monthlyPrice(await enabledModuleIds(companyId));
  const sub = await stripe<{ items: { data: { id: string; price: { product: string; unit_amount: number } }[] } }>('GET', `/subscriptions/${s.stripe_subscription_id}`);
  const item = sub.items.data[0];
  if (!item || item.price.unit_amount === price.total) return;
  await stripe('POST', `/subscriptions/${s.stripe_subscription_id}`, {
    items: [{ id: item.id, price_data: { currency: 'sek', unit_amount: price.total, recurring: { interval: 'month' }, product: item.price.product } }], proration_behavior: 'create_prorations',
  });
  await sql`UPDATE subscriptions SET monthly_amount = ${price.total}, updated_at = now() WHERE company_id = ${companyId}`;
}

const MAP: Record<string, string> = { trialing: 'active', active: 'active', past_due: 'past_due', unpaid: 'unpaid', canceled: 'canceled', incomplete: 'incomplete', incomplete_expired: 'canceled', paused: 'canceled' };
const date = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : null);

/** Webhook-händelser från Stripe */
export async function handleStripeEvent(event: { type: string; data: { object: Record<string, unknown> } }) {
  const o = event.data.object as Record<string, unknown> & { metadata?: Record<string, string> };
  if (event.type === 'checkout.session.completed') {
    const companyId = Number(o.client_reference_id ?? o.metadata?.company_id);
    if (!companyId) return;
    await sql`INSERT INTO subscriptions (company_id, status, trial_ends_at, stripe_customer_id, stripe_subscription_id)
      VALUES (${companyId}, 'active', ${today()}, ${o.customer as string}, ${o.subscription as string})
      ON CONFLICT (company_id) DO UPDATE SET status = 'active', stripe_customer_id = EXCLUDED.stripe_customer_id, stripe_subscription_id = EXCLUDED.stripe_subscription_id, updated_at = now()`;
    return;
  }
  if (event.type.startsWith('customer.subscription.')) {
    const companyId = Number(o.metadata?.company_id);
    const status = event.type === 'customer.subscription.deleted' ? 'canceled' : MAP[o.status as string] ?? 'incomplete';
    const periodEnd = date((o.current_period_end as number) ?? ((o.items as { data?: { current_period_end?: number }[] })?.data?.[0]?.current_period_end));
    await sql`UPDATE subscriptions SET status = ${status}, current_period_end = ${periodEnd}, cancel_at_period_end = ${!!o.cancel_at_period_end},
      stripe_subscription_id = ${o.id as string}, stripe_customer_id = COALESCE(stripe_customer_id, ${o.customer as string}), updated_at = now()
      WHERE ${companyId ? sql`company_id = ${companyId}` : sql`stripe_subscription_id = ${o.id as string}`}`;
  }
  if (event.type === 'invoice.payment_failed' && o.subscription) {
    await sql`UPDATE subscriptions SET status = 'past_due', updated_at = now() WHERE stripe_subscription_id = ${o.subscription as string}`;
  }
}
