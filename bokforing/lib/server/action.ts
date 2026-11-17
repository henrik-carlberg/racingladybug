import 'server-only';
import { redirect, unstable_rethrow } from 'next/navigation';

/** Läser ett formulärfält som trimmad sträng */
export const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
export const int = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === '' ? null : Number.isInteger(Number(v)) ? Number(v) : null;
};

/** Kör en åtgärd; vid fel skickas användaren tillbaka till `back` med felmeddelandet. */
export async function attempt(back: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    unstable_rethrow(e);
    const msg = e instanceof Error ? e.message : 'Något gick fel';
    console.error(e);
    redirect(back + (back.includes('?') ? '&' : '?') + 'error=' + encodeURIComponent(msg));
  }
}

export function done(path: string, msg?: string): never {
  redirect(msg ? path + (path.includes('?') ? '&' : '?') + 'ok=' + encodeURIComponent(msg) : path);
}
