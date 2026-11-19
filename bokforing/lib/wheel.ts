// Årshjul och månadshjul – ren logik (testbar): återkommande datum, moduler och geometri för hjulet.

export const WHEEL_MODULES = [
  { key: 'skatt', label: 'Skatter och deklarationer' },
  { key: 'bokslut', label: 'Bokföring och bokslut' },
  { key: 'lon', label: 'Lön' },
  { key: 'avtal', label: 'Avtal och fakturering' },
  { key: 'projekt', label: 'Projekt' },
  { key: 'marknad', label: 'Marknadsföring' },
  { key: 'lonerevision', label: 'Lönerevision' },
  { key: 'allmant', label: 'Övrigt' },
] as const;
export type WheelModule = (typeof WHEEL_MODULES)[number]['key'];
export const isWheelModule = (k: string): k is WheelModule => WHEEL_MODULES.some((m) => m.key === k);
export const moduleIndex = (k: WheelModule) => WHEEL_MODULES.findIndex((m) => m.key === k);

export type Recurrence = 'once' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export const RECURRENCE_LABEL: Record<Recurrence, string> = { once: 'En gång', weekly: 'Varje vecka', monthly: 'Varje månad', quarterly: 'Varje kvartal', yearly: 'Varje år' };

export interface ActivityRule { recurrence: Recurrence; startDate: string; endDate?: string | null; day?: number | null; month?: number | null }

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(Math.min(d, lastDay(y, m)))}`;
export const addDaysIso = (s: string, n: number) => new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/**
 * Tillfällen för en återkommande aktivitet inom [from, to].
 * Varje vecka: veckodag (1 = måndag). Varje månad: dag i månaden. Varje kvartal: dag och första månaden (1–3) i kvartalet.
 * Varje år: dag och månad. Dag 31 blir sista dagen i korta månader.
 */
export function occurrences(r: ActivityRule, from: string, to: string): string[] {
  const start = r.startDate, end = r.endDate && r.endDate < to ? r.endDate : to;
  const lo = start > from ? start : from;
  if (lo > end) return [];
  if (r.recurrence === 'once') return start >= from && start <= end ? [start] : [];
  const out: string[] = [];
  if (r.recurrence === 'weekly') {
    const wd = Math.min(7, Math.max(1, r.day ?? 1));
    let d = lo;
    const cur = ((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1;
    d = addDaysIso(d, (wd - cur + 7) % 7);
    for (; d <= end; d = addDaysIso(d, 7)) out.push(d);
    return out;
  }
  const day = Math.min(31, Math.max(1, r.day ?? Number(start.slice(8, 10))));
  const step = r.recurrence === 'monthly' ? 1 : r.recurrence === 'quarterly' ? 3 : 12;
  const first = r.recurrence === 'monthly' ? 1 : r.recurrence === 'quarterly' ? Math.min(3, Math.max(1, r.month ?? 1)) : Math.min(12, Math.max(1, r.month ?? Number(start.slice(5, 7))));
  for (let y = Number(lo.slice(0, 4)) - 1; y <= Number(end.slice(0, 4)); y++) {
    for (let m = first; m <= 12; m += step) {
      const d = ymd(y, m, day);
      if (d >= lo && d <= end) out.push(d);
    }
  }
  return out.sort();
}

export interface WheelItem { key: string; date: string; module: WheelModule; title: string; href?: string; done: boolean; own: boolean; owner?: string | null }
export const itemStatus = (i: WheelItem, today: string) => (i.done ? 'done' : i.date < today ? 'overdue' : i.date <= addDaysIso(today, 14) ? 'soon' : 'upcoming');

/** Vinkel (radianer, 0 = klockan tolv, medurs) för ett datum i årshjulet eller månadshjulet */
export function angleOf(date: string, view: 'year' | 'month'): number {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
  if (view === 'month') return ((d - 0.5) / lastDay(y, m)) * 2 * Math.PI;
  const start = Date.UTC(y, 0, 1), len = (Date.UTC(y + 1, 0, 1) - start) / 864e5;
  return (((Date.parse(date + 'T00:00:00Z') - start) / 864e5 + 0.5) / len) * 2 * Math.PI;
}
export const polar = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)] as const;

/** Båge (ringsektor) från vinkel a0 till a1 mellan radierna r0 och r1, som SVG-sökväg */
export function sector(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r1, a0), [x1, y1] = polar(cx, cy, r1, a1), [x2, y2] = polar(cx, cy, r0, a1), [x3, y3] = polar(cx, cy, r0, a0);
  const f = (n: number) => n.toFixed(2);
  return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 ${large} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 ${large} 0 ${f(x3)} ${f(y3)}Z`;
}

/** Kalenderfil (iCalendar) med heldagshändelser */
export function icsCalendar(name: string, items: { key: string; date: string; title: string; done: boolean }[], now = new Date()): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const fold = (line: string) => { const out: string[] = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); } out.push(s); return out.join('\r\n'); };
  const ev = items.map((i) => [
    'BEGIN:VEVENT', `UID:${esc(i.key.replace(/[^A-Za-z0-9:._-]/g, '_'))}@bokforing`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${i.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDaysIso(i.date, 1).replace(/-/g, '')}`,
    fold(`SUMMARY:${i.done ? '✓ ' : ''}${esc(i.title)}`), 'TRANSP:TRANSPARENT', 'END:VEVENT',
  ].join('\r\n'));
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bokforing//Arshjul//SV', 'CALSCALE:GREGORIAN', fold(`X-WR-CALNAME:${esc(name)}`), ...ev, 'END:VCALENDAR', ''].join('\r\n');
}
