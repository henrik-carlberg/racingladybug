// Lojalitetsprogram (bonuspoäng). Belopp i öre.
export const LIABILITY = 2970; // Förutbetalda intäkter (utestående poäng)
export const REVENUE_ADJ = 3790; // Övriga intäktskorrigeringar
export interface Settings { kr_per_point: number; point_value: number; redemption_rate: number; expiry_months: number }

/** Poäng för ett köp: hela poäng per påbörjat belopp exkl. moms räknas inte – bara fulla steg */
export const pointsFor = (netOre: number, krPerPoint: number) => (netOre > 0 ? Math.floor(netOre / 100 / krPerPoint) : 0);

/** Värdet av poäng vid inlösen */
export const redemptionValue = (points: number, s: Pick<Settings, 'point_value'>) => Math.round(points * s.point_value);

/** Skulden för utestående poäng: poängens värde gånger förväntad inlösen */
export const liabilityFor = (points: number, s: Pick<Settings, 'point_value' | 'redemption_rate'>) => Math.round(points * s.point_value * s.redemption_rate / 100);

export interface PointRow { date: string; kind: 'earn' | 'redeem' | 'expire'; points: number }
/** Saldo och poäng som förfaller: intjänade poäng äldre än gränsen som inte förbrukats (först in, först ut) */
export function pointStatus(rows: PointRow[], cutoff: string) {
  const earned = rows.filter((r) => r.kind === 'earn').reduce((s, r) => s + r.points, 0);
  const used = rows.filter((r) => r.kind !== 'earn').reduce((s, r) => s + r.points, 0);
  const oldEarned = rows.filter((r) => r.kind === 'earn' && r.date < cutoff).reduce((s, r) => s + r.points, 0);
  return { balance: earned - used, expiring: Math.max(0, oldEarned - used) };
}

/** Justering av skulden till målvärdet: positiv = mer skuld (minskar intäkten), negativ = intäkt */
export const adjustmentLines = (change: number) => (change ? [{ account: REVENUE_ADJ, amount: change }, { account: LIABILITY, amount: -change }] : []);
