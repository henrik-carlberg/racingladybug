import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { auditBy } from './audit';
import { sha256 } from './auth';
import type { Actor } from '@/lib/services/actor';
import { allScopes } from '@/lib/api/scopes';

export interface ApiKeyRow {
  id: number; name: string; prefix: string; scopes: string[]; created_by: string; created_at: string; last_used_at: string | null; revoked_at: string | null;
}

/** Skapar en nyckel. Själva nyckeln visas bara en gång och lagras endast som hash. */
export async function createApiKey(actor: Actor, name: string, scopes: string[]): Promise<{ id: number; token: string }> {
  if (!name.trim()) throw new ValidationError('Ge nyckeln ett namn');
  const valid = new Set(allScopes().map((s) => s.scope));
  const bad = scopes.filter((s) => !valid.has(s));
  if (bad.length) throw new ValidationError(`Okända behörigheter: ${bad.join(', ')}`);
  if (scopes.length === 0) throw new ValidationError('Välj minst en behörighet');
  const token = `bok_${randomBytes(4).toString('hex')}_${randomBytes(24).toString('base64url')}`;
  const [k] = await sql<{ id: number }[]>`INSERT INTO api_keys (company_id, name, prefix, token_hash, scopes, created_by)
    VALUES (${actor.companyId}, ${name.trim()}, ${token.slice(0, 12)}, ${sha256(token)}, ${scopes}, ${actor.userId}) RETURNING id`;
  await auditBy(sql, actor, 'create', 'api_key', k.id, { name, scopes });
  return { id: k.id, token };
}

export async function revokeApiKey(actor: Actor, id: number) {
  await sql`UPDATE api_keys SET revoked_at = now() WHERE id = ${id} AND company_id = ${actor.companyId} AND revoked_at IS NULL`;
  await auditBy(sql, actor, 'revoke', 'api_key', id);
}

export async function listApiKeys(companyId: number): Promise<ApiKeyRow[]> {
  return [...await sql<ApiKeyRow[]>`
    SELECT k.id, k.name, k.prefix, k.scopes, u.name AS created_by,
      to_char(k.created_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS created_at,
      to_char(k.last_used_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS last_used_at,
      to_char(k.revoked_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS revoked_at
    FROM api_keys k JOIN users u ON u.id = k.created_by WHERE k.company_id = ${companyId} ORDER BY k.revoked_at NULLS FIRST, k.id DESC`];
}

/** Slår upp en nyckel från Authorization-headern. Nyckeln måste vara aktiv och skaparen fortfarande ägare i bolaget. */
export async function authenticateApiKey(token: string): Promise<{ actor: Actor; scopes: string[] } | null> {
  if (!token.startsWith('bok_')) return null;
  const [k] = await sql<{ id: number; company_id: number; scopes: string[]; created_by: number }[]>`
    SELECT k.id, k.company_id, k.scopes, k.created_by FROM api_keys k
    JOIN memberships m ON m.user_id = k.created_by AND m.company_id = k.company_id AND m.role = 'owner'
    WHERE k.token_hash = ${sha256(token)} AND k.revoked_at IS NULL`;
  if (!k) return null;
  await sql`UPDATE api_keys SET last_used_at = now() WHERE id = ${k.id} AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`;
  return { actor: { companyId: k.company_id, userId: k.created_by, apiKeyId: k.id, role: 'api' }, scopes: k.scopes };
}
