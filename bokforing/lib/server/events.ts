import 'server-only';
import { randomBytes } from 'node:crypto';
import type { Tx } from '@/lib/db';
import { scheduleWebhookDispatch } from './webhooks';

/**
 * Registrerar en händelse i samma transaktion som ändringen (outbox):
 *  1. sparas i events (kan läsas via GET /api/v1/events)
 *  2. aktiverade modulers lyssnare körs
 *  3. utskick köas till prenumererande webhooks och skickas efter att svaret lämnats
 * Rullas transaktionen tillbaka försvinner även händelsen – inga "spökhändelser".
 */
export async function emit(tx: Tx, companyId: number, type: string, data: unknown): Promise<string> {
  const publicId = 'evt_' + randomBytes(12).toString('hex');
  const [ev] = await tx<{ id: number }[]>`
    INSERT INTO events (public_id, company_id, type, data) VALUES (${publicId}, ${companyId}, ${type}, ${tx.json(data as never)}) RETURNING id`;

  const { MODULES } = await import('@/modules/registry');
  if (MODULES.some((m) => m.on)) {
    const enabled = new Set((await tx<{ module_id: string }[]>`SELECT module_id FROM company_modules WHERE company_id = ${companyId}`).map((r) => r.module_id));
    for (const m of MODULES) {
      if (!enabled.has(m.id) || !m.on) continue;
      for (const h of [m.on[type], m.on['*']]) if (h) await h({ id: publicId, type, companyId, data }, tx);
    }
  }

  const queued = await tx`
    INSERT INTO webhook_deliveries (endpoint_id, event_id)
    SELECT id, ${ev.id} FROM webhook_endpoints
    WHERE company_id = ${companyId} AND active AND (${type} = ANY(events) OR '*' = ANY(events))
    RETURNING id`;
  if (queued.length) scheduleWebhookDispatch();
  return publicId;
}
