import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { CORE_EVENTS } from '@/lib/events-catalog';
import { MODULES } from '@/modules/registry';
import type { Actor } from '@/lib/services/actor';
import { auditBy } from './audit';
import { assertSafeUrl, scheduleWebhookDispatch } from './webhooks';

export const allEventTypes = () => [...CORE_EVENTS, ...MODULES.flatMap((m) => m.events ?? [])];
const newSecret = () => 'whsec_' + randomBytes(24).toString('base64url');

export async function createWebhook(actor: Actor, input: { url: string; description: string; events: string[] }) {
  const url = (await assertSafeUrl(input.url)).toString();
  const known = new Set(allEventTypes().map((e) => e.type));
  const events = input.events.includes('*') ? ['*'] : input.events.filter((e) => known.has(e));
  if (events.length === 0) throw new ValidationError('Välj minst en händelse');
  const secret = newSecret();
  const [w] = await sql<{ id: number }[]>`INSERT INTO webhook_endpoints (company_id, url, description, secret, events, created_by)
    VALUES (${actor.companyId}, ${url}, ${input.description}, ${secret}, ${events}, ${actor.userId}) RETURNING id`;
  await auditBy(sql, actor, 'create', 'webhook', w.id, { url, events });
  return { id: w.id, secret };
}

async function own(actor: Actor, id: number) {
  const [w] = await sql<{ id: number; url: string }[]>`SELECT id, url FROM webhook_endpoints WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!w) throw new NotFoundError('Webhooken');
  return w;
}

export async function setWebhookActive(actor: Actor, id: number, active: boolean) {
  await own(actor, id);
  await sql`UPDATE webhook_endpoints SET active = ${active} WHERE id = ${id}`;
  await auditBy(sql, actor, active ? 'enable' : 'disable', 'webhook', id);
}

export async function deleteWebhook(actor: Actor, id: number) {
  await own(actor, id);
  await sql`DELETE FROM webhook_endpoints WHERE id = ${id}`;
  await auditBy(sql, actor, 'delete', 'webhook', id);
}

export async function rotateWebhookSecret(actor: Actor, id: number) {
  await own(actor, id);
  const secret = newSecret();
  await sql`UPDATE webhook_endpoints SET secret = ${secret} WHERE id = ${id}`;
  await auditBy(sql, actor, 'rotate_secret', 'webhook', id);
  return secret;
}

/** Skickar en testhändelse till endast denna webhook */
export async function sendTestEvent(actor: Actor, id: number) {
  await own(actor, id);
  await sql.begin(async (tx) => {
    const [ev] = await tx<{ id: number }[]>`INSERT INTO events (public_id, company_id, type, data)
      VALUES (${'evt_' + randomBytes(12).toString('hex')}, ${actor.companyId}, 'webhook.test', ${tx.json({ message: 'Testhändelse från Bokföring' })}) RETURNING id`;
    await tx`INSERT INTO webhook_deliveries (endpoint_id, event_id) VALUES (${id}, ${ev.id})`;
  });
  scheduleWebhookDispatch();
}

export async function retryDelivery(actor: Actor, deliveryId: number) {
  const r = await sql`UPDATE webhook_deliveries d SET status = 'pending', next_attempt_at = now()
    FROM webhook_endpoints w WHERE d.id = ${deliveryId} AND w.id = d.endpoint_id AND w.company_id = ${actor.companyId} RETURNING d.id`;
  if (!r.length) throw new NotFoundError('Leveransen');
  scheduleWebhookDispatch();
}

export async function setModuleEnabled(actor: Actor, moduleId: string, enabled: boolean) {
  if (!MODULES.some((m) => m.id === moduleId)) throw new NotFoundError('Modulen');
  if (enabled) await sql`INSERT INTO company_modules (company_id, module_id, enabled_by) VALUES (${actor.companyId}, ${moduleId}, ${actor.userId}) ON CONFLICT DO NOTHING`;
  else await sql`DELETE FROM company_modules WHERE company_id = ${actor.companyId} AND module_id = ${moduleId}`;
  await auditBy(sql, actor, enabled ? 'enable' : 'disable', 'module', null, { module: moduleId });
}
