import 'server-only';
// Anslutning till Skatteverkets och Bolagsverkets API:er. Kräver avtal och behörighet hos myndigheten.
// Adresser och fältnamn är samlade här så att de kan anpassas efter myndighetens tekniska beskrivning utan att resten ändras.

export type Authority = 'skv' | 'bv';
const conf = (a: Authority) => a === 'skv'
  ? { url: process.env.SKV_API_URL, id: process.env.SKV_CLIENT_ID, secret: process.env.SKV_CLIENT_SECRET }
  : { url: process.env.BV_API_URL, id: process.env.BV_CLIENT_ID, secret: process.env.BV_CLIENT_SECRET };
export const authorityEnabled = (a: Authority) => { const c = conf(a); return !!(c.url && c.id && c.secret); };
const insecureOk = () => process.env.AUTHORITY_ALLOW_INSECURE === '1';

async function token(a: Authority): Promise<string> {
  const c = conf(a);
  const u = new URL(`${c.url!.replace(/\/$/, '')}/oauth/token`);
  if (u.protocol !== 'https:' && !(insecureOk() && u.protocol === 'http:')) throw new Error('Myndighetens API måste använda https');
  const r = await fetch(u, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: a === 'skv' ? 'moms agi' : 'arsredovisning' }) });
  if (!r.ok) throw new Error(`Inloggningen hos ${a === 'skv' ? 'Skatteverket' : 'Bolagsverket'} misslyckades (${r.status})`);
  return ((await r.json()) as { access_token: string }).access_token;
}

const PATH = { moms: ['skv', '/moms/v1/deklarationer'], agi: ['skv', '/agi/v1/deklarationer'], arsredovisning: ['bv', '/arsredovisning/v1/inlamningar'] } as const;
export type FilingKind = keyof typeof PATH;
export const authorityFor = (k: FilingKind) => PATH[k][0] as Authority;

export interface AuthorityStatus { id: string; status: 'submitted' | 'accepted' | 'rejected'; receipt?: string; message?: string }
const map = (j: { id?: string; status?: string; kvittensnummer?: string; referens?: string; meddelande?: string }, id?: string): AuthorityStatus => ({
  id: String(j.id ?? id ?? ''),
  status: /godk|accept|klar/i.test(j.status ?? '') ? 'accepted' : /fel|avvis|reject/i.test(j.status ?? '') ? 'rejected' : 'submitted',
  receipt: j.kvittensnummer ?? j.referens, message: j.meddelande,
});

export async function submitToAuthority(kind: FilingKind, o: { orgnr: string; period: string; filename: string; content: string; contentType: string }): Promise<AuthorityStatus> {
  const a = authorityFor(kind), c = conf(a);
  const r = await fetch(`${c.url!.replace(/\/$/, '')}${PATH[kind][1]}`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${await token(a)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ organisationsnummer: o.orgnr.replace(/\D/g, ''), period: o.period, filnamn: o.filename, innehallstyp: o.contentType, innehall: Buffer.from(o.content, /iso-8859-1/i.test(o.contentType) ? 'latin1' : 'utf8').toString('base64') }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { id: '', status: 'rejected', message: (j as { meddelande?: string }).meddelande ?? `Myndigheten svarade ${r.status}` };
  return map(j as never);
}

export async function authorityStatus(kind: FilingKind, id: string): Promise<AuthorityStatus> {
  const a = authorityFor(kind), c = conf(a);
  const r = await fetch(`${c.url!.replace(/\/$/, '')}${PATH[kind][1]}/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${await token(a)}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Status kunde inte hämtas (${r.status})`);
  return map(await r.json() as never, id);
}

/** Kontroll av inloggningen – används av driftsidans test. */
export async function testAuthority(a: Authority) { await token(a); }
