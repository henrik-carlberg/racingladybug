import 'server-only';
// Hjälpfunktioner för OAuth-endpoints: formulär eller JSON, och klientuppgifter via Basic-autentisering.

export async function readForm(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) { const j = await req.json().catch(() => ({})); return Object.fromEntries(Object.entries(j ?? {}).map(([k, v]) => [k, String(v)])); }
  return Object.fromEntries(new URLSearchParams(await req.text()));
}
export function basicAuth(req: Request) {
  const h = req.headers.get('authorization') ?? '';
  if (!/^Basic /i.test(h)) return null;
  const [id, ...rest] = Buffer.from(h.slice(6), 'base64').toString().split(':');
  return { id: decodeURIComponent(id ?? ''), secret: decodeURIComponent(rest.join(':')) };
}

