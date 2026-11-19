import 'server-only';
import { after } from 'next/server';
import { sql, type Tx } from '@/lib/db';

type Handler = (payload: Record<string, unknown>) => Promise<unknown>;
const handlers = new Map<string, () => Promise<Handler>>([
  ['mail.thanks', async () => { const { sendThanks } = await import('@/lib/services/templates'); return (p) => sendThanks(Number(p.companyId), Number(p.invoiceId)); }],
  ['inbox.process', async () => { const { processDocument } = await import('@/lib/services/inbox'); return (p) => processDocument(Number(p.id)); }],
]);
const MAX_ATTEMPTS = 5;

/** Lägger ett jobb i kön (gärna i samma transaktion som ändringen) och kör kön efter svaret */
export async function enqueue(kind: string, payload: Record<string, unknown>, db: Tx | typeof sql = sql) {
  if (!handlers.has(kind)) throw new Error(`Okänt jobb: ${kind}`);
  await db`INSERT INTO jobs (kind, payload) VALUES (${kind}, ${db.json(payload as never)})`;
  try { after(() => runJobs(20).catch((e) => console.error('jobb', e))); } catch { void runJobs(20).catch((e) => console.error('jobb', e)); }
}

/** Kör förfallna jobb. Säkert att köra parallellt (SKIP LOCKED). Misslyckade försöker igen med längre och längre väntan. */
export async function runJobs(limit = 50): Promise<{ done: number; failed: number }> {
  let done = 0, failed = 0;
  const claimed = await sql<{ id: number; kind: string; payload: Record<string, unknown>; attempts: number }[]>`
    UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id IN (
      SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now() ORDER BY run_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING id, kind, payload, attempts`;
  for (const j of claimed) {
    try {
      const h = await handlers.get(j.kind)!();
      await h(j.payload);
      await sql`UPDATE jobs SET status = 'done', last_error = NULL WHERE id = ${j.id}`;
      done++;
    } catch (e) {
      failed++;
      const last = j.attempts >= MAX_ATTEMPTS;
      await sql`UPDATE jobs SET status = ${last ? 'failed' : 'queued'}, last_error = ${String((e as Error)?.message ?? e).slice(0, 500)},
        run_at = now() + make_interval(mins => ${2 ** j.attempts}) WHERE id = ${j.id}`;
    }
  }
  // Fastnade jobb (t.ex. avbruten funktion) släpps efter 15 minuter; klara jobb gallras efter en vecka
  await sql`UPDATE jobs SET status = 'queued' WHERE status = 'running' AND run_at < now() - interval '15 minutes'`;
  await sql`DELETE FROM jobs WHERE status = 'done' AND created_at < now() - interval '7 days'`;
  return { done, failed };
}

export async function jobStats() {
  const [r] = await sql<{ queued: number; failed: number; oldest: string | null }[]>`
    SELECT count(*) FILTER (WHERE status = 'queued')::int AS queued, count(*) FILTER (WHERE status = 'failed')::int AS failed,
      to_char(min(run_at) FILTER (WHERE status = 'queued'), 'YYYY-MM-DD HH24:MI') AS oldest FROM jobs`;
  return r;
}
