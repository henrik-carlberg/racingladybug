import { dispatchDueWebhooks } from '@/lib/server/webhooks';

export const dynamic = 'force-dynamic';

/** Skickar om förfallna webhook-leveranser. Anropas av Vercel Cron (se vercel.json). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 });
  let total = { sent: 0, failed: 0 };
  for (let i = 0; i < 10; i++) {
    const r = await dispatchDueWebhooks(50);
    total = { sent: total.sent + r.sent, failed: total.failed + r.failed };
    if (r.sent + r.failed < 50) break;
  }
  return Response.json(total);
}
