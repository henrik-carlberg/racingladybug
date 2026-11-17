import 'server-only';
import type { Tx } from '@/lib/db';
import { sql } from '@/lib/db';

export async function audit(
  db: Tx | typeof sql,
  e: { companyId: number | null; userId: number | null; action: string; entity: string; entityId?: number | null; details?: unknown },
) {
  await db`INSERT INTO audit_log (company_id, user_id, action, entity, entity_id, details)
    VALUES (${e.companyId}, ${e.userId}, ${e.action}, ${e.entity}, ${e.entityId ?? null}, ${e.details == null ? null : db.json(e.details as never)})`;
}
