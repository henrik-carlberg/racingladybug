// Kvalificerade personaloptioner (inkomstskattelagen 11 a kap.). Belopp i öre.
export const MAX_EMPLOYEES = 250;
export const MAX_TURNOVER = 28000000000;   // 280 miljoner kronor (nettoomsättning)
export const MAX_BALANCE = 28000000000;    // 280 miljoner kronor (balansomslutning)
export const MAX_AGE_YEARS = 10;           // verksamheten får ha bedrivits i högst tio år
export const MAX_TOTAL_VALUE = 7500000000; // 75 miljoner kronor för alla optioner i bolaget
export const MIN_HOURS = 30;               // minst 30 timmar per vecka …
export const VESTING_YEARS = 3;            // … och minst tre år mellan tilldelning och utnyttjande

export interface Check { ok: boolean; text: string }

export function companyChecks(c: { employees: number; turnover: number; balance: number; startedYear: number; year: number; excluded: boolean }): Check[] {
  return [
    { ok: c.employees < MAX_EMPLOYEES, text: `Färre än ${MAX_EMPLOYEES} anställda (${c.employees})` },
    { ok: c.turnover <= MAX_TURNOVER || c.balance <= MAX_BALANCE, text: 'Nettoomsättning eller balansomslutning högst 280 miljoner kronor' },
    { ok: c.year - c.startedYear < MAX_AGE_YEARS, text: `Verksamheten har bedrivits i mindre än ${MAX_AGE_YEARS} år (sedan ${c.startedYear})` },
    { ok: !c.excluded, text: 'Inte bank-, finans-, försäkrings-, fastighets- eller juridisk/redovisningsverksamhet' },
  ];
}

const addYears = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y + n, m - 1, dd)).toISOString().slice(0, 10); };
export const vestedOn = (grantedOn: string) => addYears(grantedOn, VESTING_YEARS);

/** Tilldelningen: villkor för den anställda och taket för hela bolaget (värdet av aktierna optionerna ger rätt till) */
export function grantChecks(g: { hoursPerWeek: number; options: number; shareValue: number; premium: number }, totalBefore: number): Check[] {
  const value = g.options * g.shareValue;
  return [
    { ok: g.hoursPerWeek >= MIN_HOURS, text: `Arbetar minst ${MIN_HOURS} timmar per vecka (${g.hoursPerWeek})` },
    { ok: g.premium === 0, text: 'Optionerna tilldelas utan ersättning' },
    { ok: totalBefore + value <= MAX_TOTAL_VALUE, text: `Aktiernas sammanlagda värde högst 75 miljoner kronor (efter tilldelningen ${((totalBefore + value) / 100).toLocaleString('sv-SE')} kr)` },
  ];
}

/** Utnyttjande: efter minst tre år och med anställningen kvar beskattas ingen förmån – annars förmånsvärdet som lön */
export function exercise(o: { grantedOn: string; date: string; count: number; strike: number; marketPrice: number; employedThrough: boolean }) {
  const vested = o.date >= vestedOn(o.grantedOn);
  const qualified = vested && o.employedThrough;
  const benefit = qualified ? 0 : Math.max(0, (o.marketPrice - o.strike) * o.count);
  return { qualified, vested, benefit, reason: qualified ? 'Kvalificerad – ingen förmånsbeskattning, beskattas som kapitalvinst vid försäljning' : !vested ? `Utnyttjad före ${vestedOn(o.grantedOn)} – förmånsvärdet beskattas som lön` : 'Anställningen har inte bestått under intjänandetiden – förmånsvärdet beskattas som lön' };
}
