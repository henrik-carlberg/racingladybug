import 'server-only';
import { createHash } from 'node:crypto';
import { sql } from '@/lib/db';
import { sendMail } from './mail';
import { APP_NAME } from '@/lib/brand';

/** E-postadresser för larm till den som driver tjänsten */
export const opsEmails = () => (process.env.OPS_ALERT_EMAILS || process.env.OPS_ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * Behörighet till driftsidan. OPS_ADMIN_USER_IDS (användar-id) är säkrast. OPS_ADMIN_EMAILS fungerar också men kräver
 * tvåstegsverifiering eller passkey, eftersom e-postadresser inte verifieras vid registrering.
 */
export async function isOpsAdmin(user: { id: number; email: string }): Promise<boolean> {
  const ids = (process.env.OPS_ADMIN_USER_IDS || '').split(',').map((s) => Number(s.trim())).filter(Boolean);
  if (ids.includes(user.id)) return true;
  const emails = (process.env.OPS_ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!emails.includes(user.email.toLowerCase())) return false;
  const [r] = await sql<{ strong: boolean }[]>`SELECT (u.totp_enabled_at IS NOT NULL OR EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = u.id)) AS strong FROM users u WHERE u.id = ${user.id}`;
  return !!r?.strong;
}

/** Samma fel med olika id:n och tal grupperas */
const normalize = (s: string) => s.replace(/\b\d+\b/g, 'N').replace(/[0-9a-f]{8,}/gi, 'X').slice(0, 300);

export async function recordError(e: { message: string; stack?: string; path?: string; method?: string; kind?: string }) {
  try {
    const frame = (e.stack ?? '').split('\n').find((l) => l.includes(' at ')) ?? '';
    const fingerprint = createHash('sha256').update(`${normalize(e.message)}|${normalize(frame)}|${(e.path ?? '').replace(/\/\d+/g, '/N')}`).digest('hex').slice(0, 32);
    const [r] = await sql<{ id: number; count: number; alert: boolean }[]>`
      INSERT INTO error_log (fingerprint, message, stack, path, method, kind) VALUES (${fingerprint}, ${e.message.slice(0, 1000)}, ${(e.stack ?? '').slice(0, 4000)},
        ${(e.path ?? '').slice(0, 300)}, ${e.method ?? ''}, ${e.kind ?? ''})
      ON CONFLICT (fingerprint) DO UPDATE SET count = error_log.count + 1, last_seen = now(), resolved_at = NULL, path = EXCLUDED.path
      RETURNING id, count, (alerted_at IS NULL OR alerted_at < now() - interval '1 hour') AS alert`;
    // Larm högst en gång i timmen per feltyp
    if (r.alert && opsEmails().length) {
      await sql`UPDATE error_log SET alerted_at = now() WHERE id = ${r.id}`;
      for (const to of opsEmails()) {
        await sendMail(to, `Fel i ${APP_NAME}: ${e.message.slice(0, 80)}`, `${e.message}\n\n${e.method ?? ''} ${e.path ?? ''}\nFörekomster: ${r.count}\n\n${(e.stack ?? '').slice(0, 2000)}\n\nSe driftsidan: /drift`);
      }
    }
  } catch (err) {
    console.error('Kunde inte spara fel', err, e.message);
  }
}

/** Kör ett schemalagt jobb och sparar när det senast gick bra (hälsokontrollen larmar om det dröjer) */
export async function runCron<T>(job: string, fn: () => Promise<T>): Promise<T> {
  await sql`INSERT INTO cron_runs (job, last_started) VALUES (${job}, now()) ON CONFLICT (job) DO UPDATE SET last_started = now()`;
  try {
    const result = await fn();
    await sql`UPDATE cron_runs SET last_ok = now(), last_error = '', last_result = ${sql.json(result as never)} WHERE job = ${job}`;
    return result;
  } catch (e) {
    await sql`UPDATE cron_runs SET last_error = ${String((e as Error).message).slice(0, 500)} WHERE job = ${job}`;
    await recordError({ message: (e as Error).message, stack: (e as Error).stack, path: `/api/cron/${job}`, kind: 'cron' });
    throw e;
  }
}

/** Hur ofta varje jobb ska gå (timmar) – används för att upptäcka jobb som har slutat köras */
export const CRON_EXPECTED_HOURS: Record<string, number> = { webhooks: 26, bank: 26, daily: 26, timbank: 24 * 32 };
