import 'server-only';
import { sql } from '@/lib/db';
import { HALF_LIFE_DAYS } from '@/lib/usage';

const MAX_ROWS = 80;

/** Är användaren medlem i bolaget (direkt eller via redovisningsbyrå)? */
async function member(userId: number, companyId: number) {
  const [r] = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM memberships WHERE user_id = ${userId} AND company_id = ${companyId})
      OR EXISTS (SELECT 1 FROM firm_clients fc JOIN firm_members fm ON fm.firm_id = fc.firm_id WHERE fc.company_id = ${companyId} AND fm.user_id = ${userId}) AS ok`;
  return !!r?.ok;
}

/**
 * Räknar ett besök. Samma sida två gånger i rad (omladdning, tillbaka efter sparat) räknas en gång.
 * Poängen räknas ned med halveringstiden innan besöket läggs till.
 */
export async function recordUsage(userId: number, companyId: number, path: string) {
  const [u] = await sql<{ learn: boolean }[]>`SELECT learn_usage AS learn FROM users WHERE id = ${userId}`;
  if (!u?.learn || !(await member(userId, companyId))) return false;
  const [last] = await sql<{ path: string }[]>`SELECT path FROM user_usage WHERE user_id = ${userId} AND company_id = ${companyId} ORDER BY last_at DESC LIMIT 1`;
  if (last?.path === path) return false;
  await sql`
    INSERT INTO user_usage (user_id, company_id, path, score, uses, last_at) VALUES (${userId}, ${companyId}, ${path}, 1, 1, now())
    ON CONFLICT (user_id, company_id, path) DO UPDATE SET
      score = user_usage.score * power(0.5, EXTRACT(EPOCH FROM now() - user_usage.last_at) / 86400.0 / ${HALF_LIFE_DAYS}) + 1,
      uses = user_usage.uses + 1, last_at = now()`;
  // Bara de vanligaste sparas
  await sql`
    DELETE FROM user_usage WHERE user_id = ${userId} AND company_id = ${companyId} AND path IN (
      SELECT path FROM user_usage WHERE user_id = ${userId} AND company_id = ${companyId}
      ORDER BY score * power(0.5, EXTRACT(EPOCH FROM now() - last_at) / 86400.0 / ${HALF_LIFE_DAYS}) DESC OFFSET ${MAX_ROWS})`;
  return true;
}

/** Poäng per adress (relativt bolaget), nedräknad till i dag */
export async function usageScores(userId: number, companyId: number): Promise<Record<string, number>> {
  const rows = await sql<{ path: string; s: number }[]>`
    SELECT path, score * power(0.5, EXTRACT(EPOCH FROM now() - last_at) / 86400.0 / ${HALF_LIFE_DAYS}) AS s
    FROM user_usage WHERE user_id = ${userId} AND company_id = ${companyId}`;
  return Object.fromEntries(rows.map((r) => [r.path, Number(r.s)]));
}

export async function setLearnUsage(userId: number, on: boolean) {
  await sql`UPDATE users SET learn_usage = ${on} WHERE id = ${userId}`;
  if (!on) await forgetUsage(userId);
}

export async function forgetUsage(userId: number) {
  await sql`DELETE FROM user_usage WHERE user_id = ${userId}`;
}
