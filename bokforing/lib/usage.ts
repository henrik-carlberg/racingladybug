// Inlärning av vanliga åtgärder: rena funktioner (testas utan databas)

/** Halveringstid i dagar: en vana som inte används längre tappar halva vikten på tre veckor */
export const HALF_LIFE_DAYS = 21;
/** Poäng som krävs för att något ska räknas som "ofta använt" respektive "din vanligaste åtgärd" */
export const FREQUENT = 2;
export const TOP = 3;

export const decayed = (score: number, ageDays: number) => score * Math.pow(0.5, Math.max(0, ageDays) / HALF_LIFE_DAYS);

/**
 * Adressen som ska räknas, relativt bolaget (/c/12/fakturor/ny → { cid: 12, path: '/fakturor/ny' }).
 * Sidor för en enskild post (siffror i adressen) räknas inte, så att bara menyval och åtgärder lärs in.
 */
export function usagePath(pathname: string): { cid: number; path: string } | null {
  const m = /^\/c\/(\d{1,9})((?:\/[a-z0-9-]{1,40}){0,4})\/?$/.exec(pathname);
  if (!m) return null;
  const path = m[2];
  if (path.split('/').some((s) => /^\d+$/.test(s))) return null;
  return { cid: Number(m[1]), path };
}

/** Sorterar efter användning, mest använt först; lika (och oanvända) behåller sin ordning */
export function rankByUsage<T>(items: T[], score: (x: T) => number): T[] {
  return items.map((x, i) => ({ x, i, s: score(x) })).sort((a, b) => b.s - a.s || a.i - b.i).map((r) => r.x);
}
