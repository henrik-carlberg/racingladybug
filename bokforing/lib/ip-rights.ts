// Immateriella rättigheter. Belopp i öre.
import { halfPriceBase } from './small-assets';

export const KINDS = {
  trademark: { label: 'Varumärke', months: 120, asset: 1050, accDep: 1059, assetName: 'Varumärken', expense: 6900, warnDays: 180 },
  patent: { label: 'Patent', months: 12, asset: 1030, accDep: 1039, assetName: 'Patent', expense: 6900, warnDays: 90 },
  domain: { label: 'Domän', months: 12, asset: 1020, accDep: 1029, assetName: 'Koncessioner och liknande rättigheter', expense: 6540, warnDays: 30 },
  design: { label: 'Designskydd', months: 60, asset: 1020, accDep: 1029, assetName: 'Koncessioner och liknande rättigheter', expense: 6900, warnDays: 90 },
  other: { label: 'Annan rättighet', months: 12, asset: 1020, accDep: 1029, assetName: 'Koncessioner och liknande rättigheter', expense: 6900, warnDays: 60 },
} as const;
export type Kind = keyof typeof KINDS;
export const COST_KINDS = { application: 'Ansökan och registrering', renewal: 'Förnyelse eller årsavgift', legal: 'Juridisk hjälp (ombud, bevakning, tvist)', acquisition: 'Förvärv av rättigheten' } as const;
export type CostKind = keyof typeof COST_KINDS;
export const LEGAL = 6550, DEPRECIATION = 7810;

const addMonths = (d: string, m: number) => { const x = new Date(`${d}T00:00:00Z`); const day = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + m); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(day, last)); return x.toISOString().slice(0, 10); };
export const renewedUntil = (renewal: string, kind: Kind) => addMonths(renewal, KINDS[kind].months);
/** Dagar till förnyelsen och om det är dags; varumärken kan förnyas sex månader i förväg och har sex månaders frist efteråt (med tilläggsavgift) */
export function renewal(date: string | null, kind: Kind, today: string) {
  if (!date) return null;
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 864e5);
  const grace = kind === 'trademark' ? addMonths(date, 6) : null;
  return { days, due: days <= KINDS[kind].warnDays && days >= 0, overdue: days < 0, grace, opensOn: kind === 'trademark' ? addMonths(date, -6) : null };
}
/**
 * Kostnadsföring eller aktivering: förvärvade rättigheter aktiveras om utgiften är minst ett halvt prisbasbelopp.
 * Egna ansöknings-, förnyelse- och ombudsavgifter kostnadsförs (egenupparbetade immateriella tillgångar får inte aktiveras i K2).
 */
export function treatment(kind: CostKind, amount: number, year: number): 'expensed' | 'capitalized' {
  return kind === 'acquisition' && amount >= halfPriceBase(year) ? 'capitalized' : 'expensed';
}
export const costAccount = (right: Kind, cost: CostKind, t: 'expensed' | 'capitalized') => (t === 'capitalized' ? KINDS[right].asset : cost === 'legal' ? LEGAL : KINDS[right].expense);
export const costLines = (amount: number, account: number, credit: number) => [{ account, amount }, { account: credit, amount: -amount }];
