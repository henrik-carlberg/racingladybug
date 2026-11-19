import { generateAll } from '@/modules/avtal/service';
import { remindAll } from '@/modules/reskontra/service';
import { cleanupInbox, processPending } from '@/lib/services/inbox';
import { cleanupRateLimits } from '@/lib/server/ratelimit';
import { runCron } from '@/lib/server/monitor';
import { sendDigests, sendMonthlyReports } from '@/lib/services/digest';
import { pushDaily } from '@/lib/services/push';
import { runDueSchedules } from '@/lib/services/report-schedules';
import { runJobs } from '@/lib/server/jobs';
import { runAllIntegrity } from '@/lib/services/integrity';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Dagliga jobb: återkommande avtalsfakturor, betalningspåminnelser (som utkast) leverantörsfakturor i inkorgen som inte har tolkats och e-postsammandrag. Anropas av Vercel Cron. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 });
  return Response.json(await runCron('daily', async () => {
    const out: Record<string, unknown> = {};
    const jobs = [['avtal', generateAll], ['paminnelser', remindAll], ['inkorg', () => processPending(100)], ['inkorg_gallring', cleanupInbox], ['ratelimit_gallring', cleanupRateLimits], ['sammandrag', () => sendDigests()], ['manadsrapport', () => sendMonthlyReports()], ['notiser', pushDaily], ['rapportutskick', () => runDueSchedules()], ['jobbko', () => runJobs(500)], ['integritet', runAllIntegrity]] as const;
    for (const [k, job] of jobs) {
      try { out[k] = await job(); } catch (e) { out[k] = { error: (e as Error).message }; }
    }
    return out;
  }));
}
