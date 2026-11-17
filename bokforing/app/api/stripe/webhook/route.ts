import { verifyStripeSignature } from '@/lib/server/stripe';
import { handleStripeEvent } from '@/lib/services/billing';

export const dynamic = 'force-dynamic';

/** Tar emot händelser från Stripe (abonnemang startat, ändrat, betalning misslyckad, avslutat) */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const payload = await req.text();
  if (!secret || !verifyStripeSignature(payload, req.headers.get('stripe-signature'), secret)) return new Response('Ogiltig signatur', { status: 400 });
  try {
    await handleStripeEvent(JSON.parse(payload));
  } catch (e) {
    console.error('stripe webhook', e);
    return new Response('Fel', { status: 500 });
  }
  return Response.json({ received: true });
}
