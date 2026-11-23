// Tidsbokning. Belopp i öre inkl. moms om inget annat sägs; tider i minuter efter midnatt.
import { defaultSalesAccount } from '@/lib/invoice';
export const ADVANCE = 2420; // Förskott från kunder
export const VAT_OUT: Record<number, number> = { 25: 2611, 12: 2621, 6: 2631 };
export const salesAccount = (vatRate: number) => defaultSalesAccount(vatRate, false);

export const toMin = (hhmm: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim()); if (!m) return null; const v = Number(m[1]) * 60 + Number(m[2]); return Number(m[1]) < 24 && Number(m[2]) < 60 ? v : null; };
export const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const weekday = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

export const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && a.end > b.start;

/** Lediga starttider en dag: inom öppettiderna, i steg om 15 minuter, utan krock med andra bokningar */
export function freeSlots(o: { from: number; to: number; minutes: number; booked: { start: number; end: number }[]; step?: number }) {
  const out: number[] = [];
  for (let s = o.from; s + o.minutes <= o.to; s += o.step ?? 15) if (!o.booked.some((b) => overlaps({ start: s, end: s + o.minutes }, b))) out.push(s);
  return out;
}

export const split = (gross: number, vatRate: number) => { const net = Math.round(gross / (1 + vatRate / 100)); return { net, vat: gross - net }; };

/** Förskott: momsen redovisas när betalningen tas emot, nettot är förutbetald intäkt */
export function prepayLines(gross: number, vatRate: number, bank = 1930) {
  const s = split(gross, vatRate);
  return [{ account: bank, amount: gross }, { account: ADVANCE, amount: -s.net }, ...(s.vat ? [{ account: VAT_OUT[vatRate], amount: -s.vat }] : [])];
}
/** Utförd tjänst: förskottet blir intäkt, eller betalning på plats */
export function doneLines(gross: number, vatRate: number, prepaid: boolean, bank = 1930) {
  const s = split(gross, vatRate);
  if (prepaid) return [{ account: ADVANCE, amount: s.net }, { account: salesAccount(vatRate), amount: -s.net }];
  return [{ account: bank, amount: gross }, { account: salesAccount(vatRate), amount: -s.net }, ...(s.vat ? [{ account: VAT_OUT[vatRate], amount: -s.vat }] : [])];
}
/** Avbokning eller uteblivet besök med förskott: en del behålls som intäkt, resten (med sin moms) betalas tillbaka */
export function keepAndRefundLines(gross: number, vatRate: number, keepGross: number, bank = 1930) {
  const all = split(gross, vatRate), keep = split(keepGross, vatRate);
  const refundNet = all.net - keep.net, refundVat = all.vat - keep.vat;
  return [
    { account: ADVANCE, amount: all.net },
    ...(keep.net ? [{ account: salesAccount(vatRate), amount: -keep.net }] : []),
    ...(refundVat ? [{ account: VAT_OUT[vatRate], amount: refundVat }] : []),
    ...(refundNet + refundVat ? [{ account: bank, amount: -(refundNet + refundVat) }] : []),
  ];
}

/** Hur mycket av förskottet som behålls: inget vid avbokning i tid, annars andelen för uteblivet besök */
export function keepOnCancel(o: { price: number; hoursBefore: number; cancelHours: number; noShowPct: number }) {
  return o.hoursBefore >= o.cancelHours ? 0 : Math.round(o.price * o.noShowPct / 100);
}
