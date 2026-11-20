// Klimatbokföring: utsläpp ur bokföringen (utgiftsbaserade schabloner per konto) och exakta värden (kWh, liter).
// Faktorerna är grova schabloner i kg CO2e per krona exkl. moms – byt till leverantörens eller branschens värden när de finns.

export type Scope = 1 | 2 | 3;
export interface Category { key: string; label: string; scope: Scope; from: number; to: number; factor: number }

/** Standardfaktorer per kontointervall (BAS), kg CO2e per krona */
export const DEFAULT_CATEGORIES: Category[] = [
  { key: 'fuel', label: 'Drivmedel till egna fordon', scope: 1, from: 5610, to: 5619, factor: 0.25 },
  { key: 'energy', label: 'El och värme i lokaler', scope: 2, from: 5020, to: 5069, factor: 0.03 },
  { key: 'goods', label: 'Inköp av varor och material', scope: 3, from: 4000, to: 4799, factor: 0.3 },
  { key: 'rent', label: 'Lokalhyra', scope: 3, from: 5010, to: 5019, factor: 0.02 },
  { key: 'equipment', label: 'Förbrukningsinventarier och material', scope: 3, from: 5400, to: 5499, factor: 0.2 },
  { key: 'vehicles', label: 'Fordon (leasing, service)', scope: 3, from: 5600, to: 5609, factor: 0.08 },
  { key: 'freight', label: 'Frakt och transporter', scope: 3, from: 5700, to: 5799, factor: 0.25 },
  { key: 'travel', label: 'Resor (biljetter, hotell)', scope: 3, from: 5800, to: 5899, factor: 0.15 },
  { key: 'office', label: 'Kontorsmaterial och trycksaker', scope: 3, from: 6100, to: 6199, factor: 0.15 },
  { key: 'it', label: 'Tele, IT och datakommunikation', scope: 3, from: 6200, to: 6299, factor: 0.03 },
  { key: 'services', label: 'Köpta tjänster', scope: 3, from: 6400, to: 6599, factor: 0.03 },
  { key: 'food', label: 'Representation och personalmat', scope: 3, from: 6070, to: 6079, factor: 0.15 },
];

/** Exakta värden per enhet (kg CO2e) */
export const ACTIVITIES = {
  electricity_kwh: { label: 'El (kWh)', unit: 'kWh', factor: 0.03, scope: 2 as Scope, replaces: 'energy' },
  district_heat_kwh: { label: 'Fjärrvärme (kWh)', unit: 'kWh', factor: 0.06, scope: 2 as Scope, replaces: 'energy' },
  petrol_l: { label: 'Bensin (liter)', unit: 'l', factor: 2.3, scope: 1 as Scope, replaces: 'fuel' },
  diesel_l: { label: 'Diesel (liter)', unit: 'l', factor: 2.6, scope: 1 as Scope, replaces: 'fuel' },
} as const;
export type ActivityKind = keyof typeof ACTIVITIES;
export const isActivity = (k: string): k is ActivityKind => k in ACTIVITIES;
/** Tjänsteresor med egen bil enligt körjournalen (kg per km) */
export const PRIVATE_CAR_KG_PER_KM = 0.12;

export function categoryOf(account: number, cats: Category[]) { return cats.find((c) => account >= c.from && account <= c.to) ?? null; }

/**
 * Årets utsläpp: kostnader per konto × faktor. Har bolaget exakta värden för en kategori ersätter de schablonen för den.
 * costs: konto → belopp i öre (debet − kredit), activities: [{kind, quantity}], km: tjänsteresor med egen bil.
 */
export function emissions(o: { costs: Map<number, number>; categories: Category[]; activities: { kind: ActivityKind; quantity: number }[]; privateKm: number }) {
  const replaced = new Set<string>(o.activities.map((a) => ACTIVITIES[a.kind].replaces));
  const rows = new Map<string, { key: string; label: string; scope: Scope; kg: number; spend: number; source: 'spend' | 'exact' }>();
  for (const [acc, ore] of o.costs) {
    const c = categoryOf(acc, o.categories);
    if (!c || ore <= 0 || replaced.has(c.key)) continue;
    const r = rows.get(c.key) ?? { key: c.key, label: c.label, scope: c.scope, kg: 0, spend: 0, source: 'spend' as const };
    r.kg += (ore / 100) * c.factor; r.spend += ore; rows.set(c.key, r);
  }
  for (const a of o.activities) {
    const d = ACTIVITIES[a.kind];
    const k = `act:${a.kind}`;
    const r = rows.get(k) ?? { key: k, label: d.label.replace(/ \(.*\)$/, ''), scope: d.scope, kg: 0, spend: 0, source: 'exact' as const };
    r.kg += a.quantity * d.factor; rows.set(k, r);
  }
  if (o.privateKm > 0) rows.set('car', { key: 'car', label: 'Tjänsteresor med egen bil', scope: 3, kg: o.privateKm * PRIVATE_CAR_KG_PER_KM, spend: 0, source: 'exact' });
  const list = [...rows.values()].map((r) => ({ ...r, kg: Math.round(r.kg) })).sort((a, b) => b.kg - a.kg);
  const byScope = { 1: 0, 2: 0, 3: 0 } as Record<Scope, number>;
  for (const r of list) byScope[r.scope] += r.kg;
  return { rows: list, byScope, total: byScope[1] + byScope[2] + byScope[3] };
}

export const tonnes = (kg: number) => (kg / 1000).toLocaleString('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
