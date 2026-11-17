import 'server-only';
import type { Tx } from '@/lib/db';
import { sql } from '@/lib/db';
import type { Actor } from '@/lib/services/actor';

export async function audit(
  db: Tx | typeof sql,
  e: { companyId: number | null; userId: number | null; apiKeyId?: number | null; action: string; entity: string; entityId?: number | null; details?: unknown },
) {
  await db`INSERT INTO audit_log (company_id, user_id, api_key_id, action, entity, entity_id, details)
    VALUES (${e.companyId}, ${e.userId}, ${e.apiKeyId ?? null}, ${e.action}, ${e.entity}, ${e.entityId ?? null},
            ${e.details == null ? null : db.json(e.details as never)})`;
}

/** Loggar en händelse utförd av en aktör (användare eller API-nyckel) */
export function auditBy(db: Tx | typeof sql, a: Actor, action: string, entity: string, entityId?: number | null, details?: unknown) {
  return audit(db, { companyId: a.companyId, userId: a.userId, apiKeyId: a.apiKeyId, action, entity, entityId, details });
}
