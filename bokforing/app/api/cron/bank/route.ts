import { syncAllAccounts } from '@/lib/services/bank';

import { runCron } from '@/lib/server/monitor';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Hämtar nya transaktioner för alla kopplade bankkonton. Anropas av Vercel Cron. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 });
  return Response.json(await runCron('bank', () => syncAllAccounts()));
}
