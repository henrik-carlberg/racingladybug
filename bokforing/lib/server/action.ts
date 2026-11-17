import 'server-only';
import { redirect, unstable_rethrow } from 'next/navigation';
import { parseAmount } from '@/lib/money';
import { ValidationError } from '@/lib/errors';

/** Läser ett formulärfält som trimmad sträng */
export const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
export const int = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === '' ? null : Number.isInteger(Number(v)) ? Number(v) : null;
};
/** Belopp i svenskt format ("1 234,50") → öre. Tomt = null. */
export function amount(fd: FormData | string, k?: string, label = 'Belopp'): number | null {
  const v = typeof fd === 'string' ? fd.trim() : str(fd, k!);
  if (v === '') return null;
  const o = parseAmount(v);
  if (o == null) throw new ValidationError(`${label}: ogiltigt belopp "${v}"`);
  return o;
}
/** Fil från formulär → bilaga (eller null) */
export async function fileFrom(fd: FormData, k = 'file') {
  const f = fd.get(k);
  if (!(f instanceof File) || f.size === 0) return null;
  return { filename: f.name, mimeType: f.type || 'application/octet-stream', data: Buffer.from(await f.arrayBuffer()) };
}

/** Kör en åtgärd; vid fel skickas användaren tillbaka till `back` med felmeddelandet. */
export async function attempt(back: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    unstable_rethrow(e);
    const msg = e instanceof Error ? e.message : 'Något gick fel';
    console.error(e);
    const [path, hash] = back.split('#');
    redirect(path + (path.includes('?') ? '&' : '?') + 'error=' + encodeURIComponent(msg) + (hash ? `#${hash}` : ''));
  }
}

export function done(path: string, msg?: string): never {
  const [p, hash] = path.split('#');
  redirect((msg ? p + (p.includes('?') ? '&' : '?') + 'ok=' + encodeURIComponent(msg) : p) + (hash ? `#${hash}` : ''));
}
