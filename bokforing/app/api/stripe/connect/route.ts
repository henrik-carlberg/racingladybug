import { verifyStripeSignature } from '@/lib/server/stripe';
import { handleConnectEvent } from '@/lib/services/payments';

export const dynamic = 'force-dynamic';

/** Webhook för händelser på anslutna Stripe-konton (Connect): kortbetalningar av kundfakturor */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  const payload = await req.text();
  if (!secret || !verifyStripeSignature(payload, req.headers.get('stripe-signature'), secret)) return new Response('Ogiltig signatur', { status: 400 });
  try {
    return Response.json({ result: await handleConnectEvent(JSON.parse(payload)) });
  } catch (e) {
    console.error('stripe connect webhook', e);
    return new Response('Fel', { status: 500 });
  }
}
