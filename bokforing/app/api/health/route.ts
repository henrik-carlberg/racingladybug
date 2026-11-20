import { sql } from '@/lib/db';
import { CRON_EXPECTED_HOURS } from '@/lib/server/monitor';

export const dynamic = 'force-dynamic';

/** Hälsokontroll för övervakning (t.ex. en uptime-tjänst): 200 när allt är bra, 503 annars */
export async function GET() {
  const started = Date.now();
  try {
    await sql`SELECT 1`;
    const crons = await sql<{ job: string; last_ok: string | null; hours: number | null; failing: boolean }[]>`
      SELECT job, to_char(last_ok AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI"Z"') AS last_ok, extract(epoch FROM now() - last_ok) / 3600 AS hours,
        (last_error <> '' AND (last_ok IS NULL OR last_started > last_ok)) AS failing FROM cron_runs`;
    const problems = crons.filter((c) => c.failing || (c.hours != null && c.hours > (CRON_EXPECTED_HOURS[c.job] ?? 26))).map((c) => c.job);
    const [{ errors }] = await sql<{ errors: number }[]>`SELECT count(*)::int AS errors FROM error_log WHERE resolved_at IS NULL AND last_seen > now() - interval '1 hour'`;
    // Senaste migreringen i databasen appen använder – ska stämma med koden efter en utrullning
    const [m] = await sql<{ name: string | null; n: number }[]>`SELECT max(name) FILTER (WHERE name NOT LIKE '%/%') AS name, count(*)::int AS n FROM schema_migrations`;
    const ok = problems.length === 0;
    return Response.json({ ok, db: 'ok', db_ms: Date.now() - started, cron_problems: problems, errors_last_hour: errors, schema: m?.name ?? null, migrations: m?.n ?? 0, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null },
      { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, db: 'error' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
