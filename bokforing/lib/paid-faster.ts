// Betalt snabbare: delbetalningsplaner, SMS-text, telefonnummer, Swish och inkasso. Ren logik, belopp i öre.

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Samma dag N månader senare (sista dagen om månaden är kortare) */
export function addMonthsKeepDay(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const ty = t.getUTCFullYear(), tm = t.getUTCMonth() + 1;
  return `${ty}-${String(tm).padStart(2, '0')}-${String(Math.min(d, lastDay(ty, tm))).padStart(2, '0')}`;
}

/** Jämna delbetalningar i hela kronor; sista delen tar resten. Första delen förfaller på fakturans förfallodag (eller tidigast idag). */
export function installmentPlan(remaining: number, n: number, firstDue: string) {
  if (!Number.isInteger(n) || n < 2 || n > 12) throw new Error('Välj mellan 2 och 12 delbetalningar');
  if (remaining < n * 100) throw new Error('Beloppet är för litet för att dela upp');
  const part = Math.floor(remaining / n / 100) * 100;
  return Array.from({ length: n }, (_, i) => ({ n: i + 1, due: addMonthsKeepDay(firstDue, i), amount: i === n - 1 ? remaining - part * (n - 1) : part }));
}

/** Hur mycket som har förfallit och vad som är nästa del, givet hur mycket som är betalt */
export function planStatus(plan: { n: number; due: string; amount: number }[], paid: number, today: string) {
  let cum = 0, overdue = 0;
  let next: { n: number; due: string; amount: number; left: number } | null = null;
  for (const p of plan) {
    cum += p.amount;
    const left = Math.max(0, Math.min(p.amount, cum - paid));
    if (left > 0 && p.due < today) overdue += left;
    if (left > 0 && !next) next = { ...p, left };
  }
  return { overdue, next, paidParts: plan.filter((_, i) => plan.slice(0, i + 1).reduce((s, x) => s + x.amount, 0) <= paid).length };
}

/** Svenskt mobilnummer i E.164 (+467…), annars null */
export function mobileE164(raw: string): string | null {
  const s = raw.replace(/[\s\-()]/g, '');
  const m = /^(?:\+46|0046|0)(7\d{8})$/.exec(s);
  return m ? `+46${m[1]}` : null;
}

/** Swish-nummer för betalaren: 467XXXXXXXX (utan plus) */
export const swishPayer = (raw: string) => mobileE164(raw)?.slice(1) ?? null;
/** Meddelandet till Swish: högst 50 tecken av tillåtna tecken */
export const swishMessage = (s: string) => s.replace(/[^a-zA-Z0-9åäöÅÄÖ:;.,?!()"\- ]/g, '').slice(0, 50);

export function mapSwishStatus(s: string | undefined): 'created' | 'paid' | 'declined' | 'error' | 'cancelled' {
  const v = (s ?? '').toUpperCase();
  return v === 'PAID' ? 'paid' : v === 'DECLINED' ? 'declined' : v === 'ERROR' ? 'error' : v === 'CANCELLED' ? 'cancelled' : 'created';
}

export function smsReminder(o: { company: string; number: number; amount: string; due: string; link: string; level: 1 | 2 }) {
  return `${o.company}: ${o.level === 2 ? 'Andra påminnelse' : 'Påminnelse'} – faktura ${o.number} på ${o.amount} kr förföll ${o.due}. Betala här: ${o.link}`;
}

export const COLLECTION_STATUS = {
  registered: 'Registrerat hos inkassobolaget', reminder_sent: 'Inkassokrav skickat', payment_plan: 'Avbetalningsplan med gäldenären',
  enforcement: 'Hos Kronofogden', paid: 'Betalt', recalled: 'Återkallat', closed: 'Avslutat utan betalning',
} as const;
export type CollectionStatus = keyof typeof COLLECTION_STATUS;
export const isCollectionStatus = (s: unknown): s is CollectionStatus => typeof s === 'string' && s in COLLECTION_STATUS;
