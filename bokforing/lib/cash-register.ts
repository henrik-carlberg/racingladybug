// Kassaregister med kontrollenhet (SFL 39 kap.) – ren logik.
import { priceBase } from './small-assets';

/** Kassaregisterplikt: kontant- och kortförsäljning över fyra prisbasbelopp per räkenskapsår (undantag finns, t.ex. för små belopp eller viss verksamhet) */
export const obligationLimit = (year: number) => 4 * priceBase(year);

/** Kontrollenhetens tillverkningsnummer: bokstäver och siffror, 8–40 tecken */
export const validSerial = (s: string) => /^[A-Z0-9-]{8,40}$/i.test(s.trim());

/** Dagar som saknar Z-rapport: öppetdagar (veckodag 1 = måndag … 7 = söndag) från registreringen till och med i går */
export function missingDays(o: { from: string; until: string; openDays: number[]; reported: Set<string> }, max = 31) {
  const out: string[] = [];
  for (let t = Date.parse(o.until); t >= Date.parse(o.from) && out.length < max; t -= 864e5) {
    const d = new Date(t), iso = d.toISOString().slice(0, 10), wd = ((d.getUTCDay() + 6) % 7) + 1;
    if (o.openDays.includes(wd) && !o.reported.has(iso)) out.push(iso);
  }
  return out;
}
export const WEEKDAYS = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];
