// Nedsättning av arbetsgivaravgifter för personer som arbetar med forskning och utveckling (ren logik). Belopp i öre.
export const FOU_SHARE = 0.20;            // 20 % av avgiftsunderlaget
export const FOU_MONTHLY_CAP = 300000000; // högst 3 miljoner kronor per månad
export const PENSION_FLOOR_PCT = 10.21;   // avgiften får inte bli lägre än ålderspensionsavgiften
export const MIN_HOURS = 15;              // minst 15 timmar FoU-arbete i månaden …
export const MIN_SHARE = 0.5;             // … och minst halva arbetstiden

export interface FouSlip { id: number; name: string; base: number; feeRate: number; fouHours: number; totalHours: number }

/** Kvalificerar personen? Minst 15 timmar och minst hälften av arbetstiden i månaden */
export function qualifies(s: Pick<FouSlip, 'fouHours' | 'totalHours'>) {
  return s.fouHours >= MIN_HOURS && s.totalHours > 0 && s.fouHours / s.totalHours >= MIN_SHARE;
}

/** Avdraget per person och totalt (taket gäller hela månaden) */
export function deduction(slips: FouSlip[]) {
  const rows = slips.map((s) => {
    const ok = qualifies(s);
    const room = Math.max(0, s.feeRate - PENSION_FLOOR_PCT) / 100;
    const amount = ok ? Math.round(s.base * Math.min(FOU_SHARE, room)) : 0;
    return { ...s, qualifies: ok, amount, reason: !s.fouHours ? '' : ok ? '' : s.fouHours < MIN_HOURS ? `Mindre än ${MIN_HOURS} timmar` : 'Mindre än halva arbetstiden' };
  });
  const uncapped = rows.reduce((t, r) => t + r.amount, 0);
  const total = Math.min(uncapped, FOU_MONTHLY_CAP);
  const base = rows.filter((r) => r.qualifies).reduce((t, r) => t + r.base, 0);
  return { rows, base, total, capped: uncapped > total };
}

/** Avdraget minskar arbetsgivaravgifterna: skulden på 2731 mot kostnaden på 7510 */
export const deductionLines = (amount: number) => (amount ? [{ account: 2731, amount }, { account: 7510, amount: -amount }] : []);
