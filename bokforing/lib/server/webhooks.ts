import 'server-only';
import { lookup } from 'node:dns/promises';
import { after } from 'next/server';
import { sql } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { backoffMinutes, isPublicIp, MAX_ATTEMPTS, signPayload } from '@/lib/webhook-utils';

// Endast för utveckling/test: tillåt http och interna adresser
const allowInsecure = () => process.env.WEBHOOK_ALLOW_INSECURE === '1';

/** Kontrollerar att en webhook-URL är https och pekar på en publik adress (SSRF-skydd). */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ValidationError('Ogiltig URL'); }
  if (url.protocol !== 'https:' && !(allowInsecure() && url.protocol === 'http:')) throw new ValidationError('Webhook-URL måste börja med https://');
  if (url.username || url.password) throw new ValidationError('URL får inte innehålla inloggningsuppgifter');
  if (!allowInsecure()) {
    const addrs = await lookup(url.hostname, { all: true }).catch(() => []);
    if (addrs.length === 0) throw new ValidationError(`Kan inte slå upp ${url.hostname}`);
    if (addrs.some((a) => !isPublicIp(a.address))) throw new ValidationError('Webhook-URL får inte peka på en intern adress');
  }
  return url;
}

/** Schemalägger utskick efter att HTTP-svaret skickats (Vercel håller funktionen vid liv). */
export function scheduleWebhookDispatch() {
  try {
    after(() => dispatchDueWebhooks().catch((e) => console.error('webhook dispatch', e)));
  } catch {
    // utanför en request (t.ex. skript) – skicka direkt i bakgrunden
    void dispatchDueWebhooks().catch((e) => console.error('webhook dispatch', e));
  }
}

interface Due { id: number; attempts: number; url: string; secret: string; event_public_id: string; type: string; company_id: number; data: unknown; created_at: string }

/** Skickar förfallna webhook-leveranser. Säkert att köra parallellt (SKIP LOCKED). */
export async function dispatchDueWebhooks(limit = 25): Promise<{ sent: number; failed: number }> {
  // Gör anspråk på leveranser genom att skjuta fram next_attempt_at, så att parallella körningar inte dubbelskickar
  const due = await sql<Due[]>`
    WITH claimed AS (
      UPDATE webhook_deliveries SET next_attempt_at = now() + interval '5 minutes'
      WHERE id IN (
        SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= now()
        ORDER BY next_attempt_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING id, attempts, endpoint_id, event_id)
    SELECT c.id, c.attempts, w.url, w.secret, e.public_id AS event_public_id, e.type, e.company_id, e.data,
      to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
    FROM claimed c JOIN webhook_endpoints w ON w.id = c.endpoint_id JOIN events e ON e.id = c.event_id`;
  let sent = 0, failed = 0;
  await Promise.all(due.map(async (d) => {
    const body = JSON.stringify({ id: d.event_public_id, type: d.type, created_at: d.created_at, company_id: d.company_id, data: d.data });
    let code: number | null = null;
    let error: string | null = null;
    try {
      await assertSafeUrl(d.url);
      const res = await fetch(d.url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Bokforing-Webhooks/1.0',
          'X-Bokforing-Event': d.type,
          'X-Bokforing-Event-Id': d.event_public_id,
          'X-Bokforing-Delivery': String(d.id),
          'X-Bokforing-Signature': signPayload(d.secret, body),
        },
        body,
      });
      code = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const attempts = d.attempts + 1;
    if (!error) {
      sent++;
      await sql`UPDATE webhook_deliveries SET status = 'succeeded', attempts = ${attempts}, last_attempt_at = now(),
        last_status_code = ${code}, last_error = NULL WHERE id = ${d.id}`;
    } else {
      failed++;
      const wait = attempts >= MAX_ATTEMPTS ? null : backoffMinutes(attempts);
      await sql`UPDATE webhook_deliveries SET attempts = ${attempts}, last_attempt_at = now(), last_status_code = ${code},
        last_error = ${error.slice(0, 500)}, status = ${wait == null ? 'failed' : 'pending'},
        next_attempt_at = now() + make_interval(mins => ${wait ?? 0}) WHERE id = ${d.id}`;
    }
  }));
  return { sent, failed };
}
