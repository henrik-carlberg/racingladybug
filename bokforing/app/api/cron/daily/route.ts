import { generateAll } from '@/modules/avtal/service';
import { remindAll } from '@/modules/reskontra/service';
import { cleanupInbox, processPending } from '@/lib/services/inbox';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Dagliga jobb: återkommande avtalsfakturor, betalningspåminnelser (som utkast) och leverantörsfakturor i inkorgen som inte har tolkats. Anropas av Vercel Cron. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 });
  const out: Record<string, unknown> = {};
  for (const [k, job] of [['avtal', generateAll], ['paminnelser', remindAll], ['inkorg', () => processPending(100)], ['inkorg_gallring', cleanupInbox]] as const) {
    try { out[k] = await job(); } catch (e) { out[k] = { error: (e as Error).message }; }
  }
  return Response.json(out);
}
