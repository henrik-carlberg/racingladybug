import { ValidationError } from '@/lib/errors';

// Validering av indata från API (JSON) och formulär. Belopp anges alltid i öre (heltal).
type O = Record<string, unknown>;

export function str(o: O, k: string, opts: { required?: boolean; label?: string; max?: number } = {}): string {
  const v = o[k];
  if (v == null || v === '') {
    if (opts.required) throw new ValidationError(`${opts.label ?? k} saknas`);
    return '';
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw new ValidationError(`${opts.label ?? k} måste vara text`);
  const s = String(v).trim();
  if (opts.required && !s) throw new ValidationError(`${opts.label ?? k} saknas`);
  if (s.length > (opts.max ?? 2000)) throw new ValidationError(`${opts.label ?? k} är för lång`);
  return s;
}

export function optInt(o: O, k: string, label = k): number | null {
  const v = o[k];
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ValidationError(`${label} måste vara ett heltal`);
  return n;
}

export function int(o: O, k: string, label = k): number {
  const n = optInt(o, k, label);
  if (n == null) throw new ValidationError(`${label} saknas`);
  return n;
}

/** Belopp i öre (heltal) */
export function ore(o: O, k: string, label = k, opts: { min?: number } = {}): number {
  const n = int(o, k, label);
  if (opts.min != null && n < opts.min) throw new ValidationError(`${label} får inte vara mindre än ${opts.min}`);
  return n;
}

export function date(o: O, k: string, label = k, required = true): string {
  const s = str(o, k, { required, label });
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new ValidationError(`${label} måste vara ett datum (ÅÅÅÅ-MM-DD)`);
  return s;
}

export function bool(o: O, k: string): boolean {
  const v = o[k];
  return v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
}

export function arr(o: O, k: string, label = k): O[] {
  const v = o[k];
  if (!Array.isArray(v)) throw new ValidationError(`${label} måste vara en lista`);
  return v as O[];
}

/** Plockar ut de fält som faktiskt skickats (för PATCH) */
export function has(o: O, k: string) {
  return Object.prototype.hasOwnProperty.call(o, k);
}

export interface Page { limit: number; startingAfter: number | null }
export function page(q: URLSearchParams | Record<string, string | undefined>): Page {
  const get = (k: string) => (q instanceof URLSearchParams ? q.get(k) : q[k]) ?? undefined;
  const limit = Math.min(Math.max(Number(get('limit') ?? 50) || 50, 1), 500);
  const sa = get('starting_after');
  return { limit, startingAfter: sa ? Number(sa) : null };
}

/** Listsvar: { data, has_more } – nästa sida hämtas med starting_after = sista id:t */
export function list<T extends { id: number }>(rows: T[], p: Page) {
  const more = rows.length > p.limit;
  return { object: 'list' as const, data: more ? rows.slice(0, p.limit) : rows, has_more: more };
}
