// Intrastat: statistik över varuhandel med andra EU-länder till SCB (ren logik). Belopp i öre.
import { isEu } from './eu';

/** Tröskelvärden per flöde, rullande tolv månader (SCB – kontrollera aktuella belopp varje år) */
export const THRESHOLDS = { arrival: 1200000000, dispatch: 450000000 } as const;
export type Flow = keyof typeof THRESHOLDS;
export const FLOW_LABEL: Record<Flow, string> = { arrival: 'Införsel', dispatch: 'Utförsel' };
/** Konton för varuhandel med andra EU-länder */
export const DISPATCH_ACCOUNTS = [3106, 3108];
export const ARRIVAL_ACCOUNTS = [4515, 4516, 4517];
/** Vanliga transaktionsslag */
export const TRANSACTIONS: Record<string, string> = { '11': 'Köp eller försäljning', '21': 'Retur', '31': 'Gåva eller utan ersättning', '41': 'Varor för bearbetning', '51': 'Efter bearbetning' };

/** Rapporteringsplikt när flödet de senaste tolv månaderna överstiger tröskeln; varning från 80 % */
export function obligation(flow: Flow, rolling: number) {
  const t = THRESHOLDS[flow];
  return { threshold: t, required: rolling > t, warning: rolling > t * 0.8 && rolling <= t };
}

export interface Line { flow: Flow; kn: string; country: string; origin: string; txn: string; value: number; mass: number; supp: number | null }
export function validate(l: Line): string | null {
  if (!/^\d{8}$/.test(l.kn)) return 'Varukoden (KN-nummer) ska ha åtta siffror';
  if (!isEu(l.country)) return 'Partnerlandet ska vara ett annat EU-land';
  if (l.flow === 'arrival' && !/^[A-Z]{2}$/.test(l.origin)) return 'Ange ursprungsland med två bokstäver';
  if (!TRANSACTIONS[l.txn]) return 'Välj transaktionsslag';
  if (!(l.value > 0)) return 'Fakturerat värde ska vara större än noll';
  if (!Number.isInteger(l.mass) || l.mass < 0) return 'Nettovikten anges i hela kilo';
  return null;
}

/** Skillnad mellan deklarerat värde och bokföringen för månaden (i procent) – underlag för kontroll */
export const deviation = (declared: number, ledger: number) => (ledger ? Math.round(((declared - ledger) / ledger) * 1000) / 10 : declared ? 100 : 0);

/** Fil för uppladdning (semikolonseparerad): flöde, period, varukod, land, ursprung, transaktion, värde i hela kronor, vikt, extra mängd */
export function file(period: string, lines: Line[]) {
  const head = 'flode;period;varukod;partnerland;ursprungsland;transaktion;fakturerat_varde_sek;nettovikt_kg;kvantitet';
  return [head, ...lines.map((l) => [l.flow === 'arrival' ? 1 : 2, period.replace('-', ''), l.kn, l.country, l.flow === 'arrival' ? l.origin : '', l.txn, Math.round(l.value / 100), l.mass, l.supp ?? ''].join(';'))].join('\r\n') + '\r\n';
}
