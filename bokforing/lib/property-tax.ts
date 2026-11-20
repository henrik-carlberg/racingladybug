// Fastighetsskatt, kommunal fastighetsavgift och skattemässiga avskrivningar på fastigheter (ren logik). Belopp i öre.
export type PropertyType = 'bostad' | 'lokal' | 'industri' | 'tomt';
export const TYPE_LABEL: Record<PropertyType, string> = { bostad: 'Hyreshus, bostäder', lokal: 'Hyreshus, lokaler', industri: 'Industrienhet', tomt: 'Obebyggd tomt' };
/** Fastighetsskatt i procent av taxeringsvärdet; bostäder har kommunal fastighetsavgift per lägenhet (högst 0,3 %) */
export const RATE: Record<PropertyType, number> = { bostad: 0.3, lokal: 1, industri: 0.5, tomt: 1 };
/** Nybyggda bostäder är befriade från fastighetsavgift de första 15 åren räknat från värdeåret */
export const NEW_BUILD_YEARS = 15;
export const COST_ACCOUNT = 5191, LIABILITY_ACCOUNT = 2513;

export interface TaxProperty { type: PropertyType; taxValue: number; apartments: number; capPerApartment: number; valueYear: number | null }
/** Årets fastighetsskatt eller fastighetsavgift */
export function yearlyTax(p: TaxProperty, year: number) {
  if (p.type === 'bostad') {
    if (p.valueYear && year - p.valueYear < NEW_BUILD_YEARS) return { amount: 0, rule: `Nybyggd (värdeår ${p.valueYear}) – ingen avgift de första ${NEW_BUILD_YEARS} åren` };
    const pct = Math.round((p.taxValue * RATE.bostad) / 100);
    const cap = p.apartments * p.capPerApartment;
    return pct <= cap || !p.apartments ? { amount: pct, rule: '0,3 % av taxeringsvärdet' } : { amount: cap, rule: `${p.apartments} lägenheter × takbeloppet` };
  }
  return { amount: Math.round((p.taxValue * RATE[p.type]) / 100), rule: `${String(RATE[p.type]).replace('.', ',')} % av taxeringsvärdet` };
}

/** Månadens andel: årsbeloppet fördelat jämnt, med öresresten i december */
export function monthlyShare(yearly: number, month: number) {
  const base = Math.floor(yearly / 12);
  return month === 12 ? yearly - base * 11 : base;
}
export const taxLines = (amount: number) => [{ account: COST_ACCOUNT, amount }, { account: LIABILITY_ACCOUNT, amount: -amount }];

export interface Depreciable { buildingCost: number; buildingRate: number; improvementCost: number; acquired: string }
/**
 * Värdeminskningsavdrag för året: byggnaden med sin procentsats (2–5 % beroende på användning), markanläggningar 5 %, mark inget.
 * Första året räknas efter antal månader fastigheten ägts. Avdraget blir aldrig större än det som återstår.
 */
export function taxDepreciation(p: Depreciable, year: number, before: { building: number; improvement: number }) {
  const [ay, am] = p.acquired.split('-').map(Number);
  if (year < ay) return { building: 0, improvement: 0, total: 0, months: 0 };
  const months = year === ay ? 13 - am : 12;
  const b = Math.min(Math.max(0, p.buildingCost - before.building), Math.round((p.buildingCost * p.buildingRate * months) / 1200));
  const i = Math.min(Math.max(0, p.improvementCost - before.improvement), Math.round((p.improvementCost * 5 * months) / 1200));
  return { building: b, improvement: i, total: b + i, months };
}

/** Skillnaden mot bokföringen: bokförd avskrivning återförs och den skattemässiga dras av (positivt = höjer skattepliktigt resultat) */
export const taxAdjustment = (booked: number, tax: number) => booked - tax;
