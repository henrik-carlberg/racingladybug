import 'server-only';
// Anslutning till en Peppol-åtkomstpunkt (AP). Adresser och fält är samlade här så att de kan anpassas efter operatörens API.
// Skicka: POST /documents · Status: GET /documents/{id} · Uppslag i SMP: GET /participants/{schema:id}
// Mottagning och statusändringar kommer som webhook till /api/peppol/inbound, signerad med HMAC-SHA256 över "tidsstämpel.kropp".

const base = () => (process.env.PEPPOL_AP_URL || '').replace(/\/$/, '');
export const apEnabled = () => !!(process.env.PEPPOL_AP_URL && process.env.PEPPOL_AP_KEY);
const insecureOk = () => process.env.PEPPOL_AP_ALLOW_INSECURE === '1';

async function call(path: string, init: RequestInit = {}) {
  const u = new URL(base() + path);
  if (u.protocol !== 'https:' && !(insecureOk() && u.protocol === 'http:')) throw new Error('Åtkomstpunkten måste använda https');
  return fetch(u, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000), headers: { ...init.headers, authorization: `Bearer ${process.env.PEPPOL_AP_KEY}` } });
}

export const isParticipant = (id: string) => /^\d{4}:[A-Za-z0-9.-]{1,60}$/.test(id);

export interface Lookup { registered: boolean; name?: string; canReceiveInvoice: boolean }
/** Slår upp om mottagaren finns i Peppol och kan ta emot fakturor (BIS Billing 3) */
export async function apLookup(participant: string): Promise<Lookup> {
  if (!isParticipant(participant)) throw new Error('Ogiltigt Peppol-ID');
  const r = await call(`/participants/${encodeURIComponent(participant)}`);
  if (r.status === 404) return { registered: false, canReceiveInvoice: false };
  if (!r.ok) throw new Error(`Åtkomstpunkten svarade ${r.status}`);
  const j = await r.json() as { name?: string; documentTypes?: string[] };
  return { registered: true, name: j.name, canReceiveInvoice: (j.documentTypes ?? []).some((d) => /billing:3\.0|poacc:billing/i.test(d)) };
}

export type ApStatus = 'sent' | 'delivered' | 'failed';
const mapStatus = (s?: string): ApStatus => /^(delivered|levererad)$/i.test(s ?? '') ? 'delivered' : /fail|error|reject|fel/i.test(s ?? '') ? 'failed' : 'sent';

export async function apSend(o: { sender: string; receiver: string; xml: string; documentType: 'invoice' | 'creditnote' }) {
  const r = await call('/documents', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sender: o.sender, receiver: o.receiver, documentType: o.documentType, process: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0', document: Buffer.from(o.xml, 'utf8').toString('base64') }) });
  const j = await r.json().catch(() => ({})) as { id?: string; status?: string; message?: string };
  if (!r.ok) return { id: '', status: 'failed' as ApStatus, message: j.message ?? `Åtkomstpunkten svarade ${r.status}` };
  return { id: String(j.id ?? ''), status: mapStatus(j.status), message: j.message ?? '' };
}

export async function apStatus(id: string) {
  const r = await call(`/documents/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`Status kunde inte hämtas (${r.status})`);
  const j = await r.json() as { status?: string; message?: string };
  return { status: mapStatus(j.status), message: j.message ?? '' };
}

export { verifyApWebhook } from '@/lib/peppol-webhook';
export { mapStatus as apMapStatus };
