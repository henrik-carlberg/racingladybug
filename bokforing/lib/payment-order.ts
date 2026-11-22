// Betalningsföreläggande hos Kronofogden för en obetald kundfaktura (ren logik). Belopp i öre.
/** Ansökningsavgift (kontrollera Kronofogdens aktuella avgift) och högsta påminnelseavgift enligt inkassokostnadslagen */
export const APPLICATION_FEE = 30000, MAX_REMINDER_FEE = 6000;
export const FEE_RECEIVABLE = 1680, INTEREST_INCOME = 8313, FEE_INCOME = 3990, FEE_COST = 6990;
export type Status = 'applied' | 'ruling' | 'enforcement' | 'paid' | 'withdrawn';
export const STATUS_LABEL: Record<Status, string> = { applied: 'Ansökt', ruling: 'Utslag meddelat', enforcement: 'Verkställighet', paid: 'Betald', withdrawn: 'Återkallad' };
export const NEXT: Record<Status, Status[]> = { applied: ['ruling', 'withdrawn'], ruling: ['enforcement', 'withdrawn'], enforcement: ['withdrawn'], paid: [], withdrawn: [] };

/** Dröjsmålsränta från förfallodagen till ett datum (räntelagen: referensräntan + 8 procentenheter) */
export function interest(capital: number, ratePct: number, from: string, to: string) {
  const days = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 864e5));
  return Math.round((capital * ratePct * days) / 100 / 365);
}

/** Inbetalning via Kronofogden avräknas först mot kostnader (ansökningsavgift, påminnelseavgift), sedan ränta och sist kapital */
export function allocate(paid: number, o: { fee: number; reminder: number; interest: number; capital: number }) {
  let left = paid;
  const take = (x: number) => { const t = Math.min(left, Math.max(0, x)); left -= t; return t; };
  const fee = take(o.fee), reminder = take(o.reminder), int = take(o.interest), capital = take(o.capital);
  return { fee, reminder, interest: int, capital, excess: left };
}
