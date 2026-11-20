import 'server-only';
import { ValidationError } from '@/lib/errors';

// EU-kommissionens VIES (kontroll av momsregistreringsnummer). Standard: den officiella REST-tjänsten.
const conf = () => ({ url: (process.env.VIES_API_URL || 'https://ec.europa.eu/taxation_customs/vies/rest-api').replace(/\/$/, ''), insecure: process.env.VIES_ALLOW_INSECURE === '1' });

export async function checkVat(country: string, number: string): Promise<{ valid: boolean; name: string; address: string }> {
  const c = conf();
  if (!c.url.startsWith('https://') && !c.insecure) throw new ValidationError('VIES-adressen måste använda https');
  const r = await fetch(`${c.url}/ms/${encodeURIComponent(country)}/vat/${encodeURIComponent(number)}`, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } }).catch(() => null);
  if (!r) throw new ValidationError('VIES svarar inte just nu – försök igen senare');
  const j = await r.json().catch(() => null) as Record<string, unknown> | null;
  if (!r.ok || !j) throw new ValidationError(`VIES: ${(j?.userError as string) ?? `HTTP ${r.status}`}`);
  if (j.userError && j.userError !== 'VALID' && j.userError !== 'INVALID') throw new ValidationError(`VIES kunde inte kontrollera numret (${String(j.userError)})`);
  const clean = (v: unknown) => (typeof v === 'string' && v !== '---' ? v.trim().slice(0, 300) : '');
  return { valid: j.isValid === true, name: clean(j.name), address: clean(j.address) };
}
