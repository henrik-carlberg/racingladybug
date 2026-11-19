import 'server-only';
import { after } from 'next/server';
import webpush from 'web-push';
import { sql } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { isPushKind, validPushEndpoint, validPushKeys, type PushKind } from '@/lib/push';

export const pushEnabled = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? '';
/** Bara för test: tillåter http://localhost som pushtjänst */
const allowInsecure = () => process.env.PUSH_ALLOW_INSECURE === '1';

export interface PushMessage { title: string; body: string; url: string; tag?: string }

export async function subscribe(userId: number, input: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }, device: string) {
  const endpoint = String(input.endpoint ?? '');
  const p256dh = String(input.keys?.p256dh ?? ''), auth = String(input.keys?.auth ?? '');
  if (!validPushEndpoint(endpoint, allowInsecure())) throw new ValidationError('Okänd pushtjänst');
  if (!validPushKeys(p256dh, auth)) throw new ValidationError('Ogiltiga nycklar');
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = ${userId}`;
  if (n >= 10) throw new ValidationError('Högst tio enheter kan ta emot notiser');
  await sql`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device) VALUES (${userId}, ${endpoint}, ${p256dh}, ${auth}, ${device.slice(0, 120)})
    ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, device = EXCLUDED.device, failures = 0
    WHERE push_subscriptions.user_id = EXCLUDED.user_id OR push_subscriptions.auth = EXCLUDED.auth`; // en annan användares enhet kan bara tas över av webbläsaren som har dess hemliga nyckel
}

export async function unsubscribe(userId: number, endpoint: string) {
  await sql`DELETE FROM push_subscriptions WHERE user_id = ${userId} AND endpoint = ${endpoint}`;
}

export async function setPushPrefs(userId: number, kinds: string[]) {
  await sql`UPDATE users SET push_prefs = ${kinds.filter(isPushKind)} WHERE id = ${userId}`;
}

/** Skickar till användarnas enheter. Enheter som inte längre finns (404/410) tas bort. */
export async function sendToUsers(userIds: number[], kind: PushKind | 'test', msg: PushMessage): Promise<number> {
  if (!pushEnabled() || !userIds.length) return 0;
  const subs = await sql<{ id: number; endpoint: string; p256dh: string; auth: string }[]>`
    SELECT s.id, s.endpoint, s.p256dh, s.auth FROM push_subscriptions s JOIN users u ON u.id = s.user_id
    WHERE s.user_id IN ${sql(userIds)} AND (${kind} = 'test' OR ${kind} = ANY(u.push_prefs))`;
  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag ?? kind });
  let sent = 0;
  for (const s of subs) {
    try {
      // Förfrågan byggs av web-push (kryptering och VAPID) och skickas med fetch
      const r = webpush.generateRequestDetails({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
        vapidDetails: { subject: process.env.VAPID_SUBJECT || 'mailto:support@example.com', publicKey: process.env.VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY! },
        TTL: 24 * 3600, urgency: 'normal',
      });
      if (!validPushEndpoint(r.endpoint, allowInsecure())) continue;
      const res = await fetch(r.endpoint, { method: 'POST', headers: r.headers as Record<string, string>, body: r.body as unknown as BodyInit, signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (res.status === 404 || res.status === 410) await sql`DELETE FROM push_subscriptions WHERE id = ${s.id}`;
      else if (res.ok) { sent++; await sql`UPDATE push_subscriptions SET last_ok_at = now(), failures = 0 WHERE id = ${s.id}`; }
      else await sql`UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ${s.id}`;
    } catch (e) {
      console.error('push', e);
      await sql`UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ${s.id}`;
    }
  }
  await sql`DELETE FROM push_subscriptions WHERE failures >= 20`;
  return sent;
}

/** Bolagets medlemmar (inte anställda) som har behörigheten, utom den som själv gjorde det */
async function members(companyId: number, perm: string | null, except: number | null) {
  const rows = await sql<{ user_id: number }[]>`
    SELECT m.user_id FROM memberships m WHERE m.company_id = ${companyId} AND m.role IN ('owner','accountant')
      AND (${perm}::text IS NULL OR m.role = 'owner' OR m.permissions IS NULL OR ${perm} = ANY(m.permissions))
      AND m.user_id IS DISTINCT FROM ${except}`;
  return rows.map((r) => r.user_id);
}

/** Skicka efter att svaret har gått iväg (och transaktionen är klar) */
export function notifyLater(fn: () => Promise<unknown>) {
  if (!pushEnabled()) return;
  const run = () => fn().catch((e) => console.error('push', e));
  try { after(run); } catch { void run(); }
}

export const notify = {
  attest: (companyId: number, by: number | null, supplier: string, total: number, id: number) => notifyLater(async () =>
    sendToUsers(await members(companyId, 'attest', by), 'attest', { title: 'Faktura att attestera', body: `${supplier}: ${(total / 100).toLocaleString('sv-SE')} kr`, url: `/c/${companyId}/leverantorsfakturor/${id}`, tag: `attest-${id}` })),
  paid: (companyId: number, customer: string, number: number | null, amount: number, id: number) => notifyLater(async () =>
    sendToUsers(await members(companyId, 'invoicing', null), 'paid', { title: 'Kunden har betalat', body: `${customer} betalade faktura ${number ?? ''} (${(amount / 100).toLocaleString('sv-SE')} kr)`, url: `/c/${companyId}/fakturor/${id}`, tag: `paid-${id}` })),
  mention: (companyId: number, userIds: number[], who: string, text: string, url: string) => notifyLater(async () =>
    sendToUsers(userIds, 'mention', { title: `${who} nämnde dig`, body: text.slice(0, 140), url })),
};

/** Daglig körning: deadlines om tre dagar och bankkopplingar som har slutat fungera. Varje notis skickas en gång. */
export async function pushDaily(): Promise<{ deadlines: number; bank: number }> {
  if (!pushEnabled()) return { deadlines: 0, bank: 0 };
  const { companyDeadlines } = await import('./deadlines');
  const { addDays, today } = await import('@/lib/format');
  const in3 = addDays(today(), 3);
  let deadlines = 0, bank = 0;
  const companies = await sql<{ id: number }[]>`SELECT DISTINCT c.id FROM companies c JOIN memberships m ON m.company_id = c.id JOIN push_subscriptions s ON s.user_id = m.user_id`;
  for (const c of companies) {
    for (const d of (await companyDeadlines(c.id)).filter((x) => x.due === in3 && x.status !== 'done')) {
      const [first] = await sql`INSERT INTO push_log (key) VALUES (${`deadline:${c.id}:${d.key}:${d.due}`}) ON CONFLICT DO NOTHING RETURNING key`;
      if (first) deadlines += await sendToUsers(await members(c.id, null, null), 'deadline', { title: `Deadline ${d.due}`, body: d.title, url: d.href, tag: `deadline-${d.key}` });
    }
    const conns = await sql<{ id: number; bank: string }[]>`SELECT id, COALESCE(aspsp_name, 'Banken') AS bank FROM bank_connections WHERE company_id = ${c.id} AND status IN ('expired','error')`;
    for (const k of conns) {
      const [first] = await sql`INSERT INTO push_log (key) VALUES (${`bank:${k.id}`}) ON CONFLICT DO NOTHING RETURNING key`;
      if (first) bank += await sendToUsers(await members(c.id, 'ledger', null), 'bank', { title: 'Bankkopplingen fungerar inte', body: `${k.bank}: koppla banken igen med BankID för att få nya transaktioner.`, url: `/c/${c.id}/bank`, tag: `bank-${k.id}` });
    }
  }
  return { deadlines, bank };
}
