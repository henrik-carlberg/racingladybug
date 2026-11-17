// Tidrapportering, fakturaunderlag och timbank. Rena funktioner utan databas.

/** Tolkar "1,5", "1.5", "1:30", "90m", "2h", "2 h 15 min" → minuter. null om ogiltigt. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{1,2}):([0-5]\d)$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = s.match(/^(\d+)\s*m(in)?$/))) return Number(m[1]);
  if ((m = s.match(/^(\d+)\s*h\s*(\d+)\s*m(in)?$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = s.match(/^(\d+(?:[.,]\d+)?)\s*(h|tim|timmar)?$/))) {
    const h = Number(m[1].replace(',', '.'));
    return Number.isFinite(h) ? Math.round(h * 60) : null;
  }
  return null;
}

/** Minuter → timmar med högst tre decimaler (fakturans antal) */
export const hoursQty = (minutes: number) => Math.round((minutes / 60) * 1000) / 1000;

/** Minuter → "1,5 h" */
export function fmtHours(minutes: number): string {
  const h = minutes / 60;
  return `${h.toLocaleString('sv-SE', { maximumFractionDigits: 2 })} h`;
}

export interface TimeForInvoice { minutes: number; activity: string; rate: number }
export interface TimeInvoiceLine { description: string; quantity: number; unit: string; unit_price: number; vat_rate: number }

/** Grupperar tidrader per aktivitet och timpris till fakturarader */
export function timeInvoiceLines(entries: TimeForInvoice[], o: { suffix: string; vatRate: number }): TimeInvoiceLine[] {
  const groups = new Map<string, { activity: string; rate: number; minutes: number }>();
  for (const e of entries) {
    const k = `${e.activity}|${e.rate}`;
    const g = groups.get(k) ?? { activity: e.activity, rate: e.rate, minutes: 0 };
    g.minutes += e.minutes;
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => ({
    description: `${g.activity}${o.suffix ? `, ${o.suffix}` : ''}`, quantity: hoursQty(g.minutes), unit: 'h', unit_price: g.rate, vat_rate: o.vatRate,
  }));
}

export interface BankStatement {
  purchased: number; // minuter köpta (fakturerade)
  drawnBefore: number; // minuter dragna i tidigare avräkningar
  usedNow: number; // minuter använda i perioden
  drawn: number; // minuter som dras från banken nu
  overage: number; // minuter utöver banken (faktureras)
  remaining: number; // minuter kvar efter perioden
}

/** Månadsavräkning av en timbank */
export function bankStatement(purchased: number, drawnBefore: number, usedNow: number): BankStatement {
  const available = Math.max(0, purchased - drawnBefore);
  const drawn = Math.min(usedNow, available);
  return { purchased, drawnBefore, usedNow, drawn, overage: usedNow - drawn, remaining: available - drawn };
}

const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
/** "2026-10" → "oktober 2026" */
export const monthName = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
/** Första och sista dagen i en månad */
export function monthRange(period: string): [string, string] {
  const y = Number(period.slice(0, 4)), m = Number(period.slice(5, 7));
  return [`${period}-01`, `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`];
}
/** Föregående månad (YYYY-MM) från ett datum */
export function previousMonth(date: string): string {
  let y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)) - 1;
  if (m === 0) { m = 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
/** Måndag i veckan för ett datum */
export function weekStart(date: string): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
/** ISO-veckonummer */
export function isoWeek(date: string): number {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

export const BILLING_LABEL: Record<string, string> = {
  hourly: 'Löpande räkning', hour_bank: 'Timbank', fixed: 'Fast pris', internal: 'Internt (faktureras inte)',
};
