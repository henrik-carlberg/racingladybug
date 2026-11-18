import { createAllBankStatements } from '@/lib/services/time';

import { runCron } from '@/lib/server/monitor';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Skapar förra månadens timbanksavräkningar som fakturautkast. Anropas av Vercel Cron den 1:a varje månad. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 });
  return Response.json(await runCron('timbank', () => createAllBankStatements()));
}
