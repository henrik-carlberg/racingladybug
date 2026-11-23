// Körjournal per fordon. Sträckor i km, ersättningar i öre per mil (10 km).
export interface SignedLine { account: number; amount: number }
export const OWN_CAR_RATE = 2500; // schablonavdrag för egen bil i tjänsten, 25 kr per mil
export const OWN_CAR_COST = 7331, OWNER_DEPOSIT = 2018, OWNER_WITHDRAWAL = 2013, PRIVATE_USE_INCOME = 3990;
export const CAR_COSTS: [number, number] = [5600, 5699];

/** Sträckan från mätarställning eller angiven sträcka; mätarställningen ska öka */
export function tripKm(o: { km?: number | null; odoStart?: number | null; odoEnd?: number | null }) {
  if (o.odoStart != null && o.odoEnd != null) {
    if (o.odoEnd <= o.odoStart) throw new Error('Mätarställningen vid ankomst ska vara högre än vid avfärd');
    return o.odoEnd - o.odoStart;
  }
  if (!o.km || o.km <= 0) throw new Error('Ange sträckan i km eller mätarställningar');
  return Math.round(o.km * 10) / 10;
}

export interface TripRow { km: number; private: boolean; customer: string | null }
export function summary(trips: TripRow[]) {
  const business = trips.filter((t) => !t.private).reduce((s, t) => s + t.km, 0);
  const priv = trips.filter((t) => t.private).reduce((s, t) => s + t.km, 0);
  const total = business + priv;
  const byCustomer = new Map<string, number>();
  for (const t of trips) if (!t.private && t.customer) byCustomer.set(t.customer, (byCustomer.get(t.customer) ?? 0) + t.km);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return { business: r1(business), private: r1(priv), total: r1(total), privateShare: total ? Math.round((priv / total) * 1000) / 10 : 0,
    customers: [...byCustomer].map(([customer, km]) => ({ customer, km: r1(km) })).sort((a, b) => b.km - a.km) };
}

/** Kronor för en sträcka med en ersättning per mil */
export const perMil = (km: number, ratePerMil: number) => Math.round((km / 10) * ratePerMil);
/** Bilens kostnad per mil: årets bilkostnader delat med årets körda mil */
export const costPerMil = (costs: number, totalKm: number) => (totalKm > 0 ? Math.round(costs / (totalKm / 10)) : 0);

/** Egen bil i tjänsten (enskild firma): avdraget bokförs som kostnad mot egen insättning */
export const deductionLines = (amount: number): SignedLine[] => [{ account: OWN_CAR_COST, amount }, { account: OWNER_DEPOSIT, amount: -amount }];
/** Privat körning med firmans bil (enskild firma): uttag till självkostnad */
export const privateUseLines = (amount: number): SignedLine[] => [{ account: OWNER_WITHDRAWAL, amount }, { account: PRIVATE_USE_INCOME, amount: -amount }];
