// Anbud och ramavtal. Belopp i öre exkl. moms.
export const STATUS: Record<string, string> = { draft: 'Under arbete', submitted: 'Inlämnat', won: 'Vunnet', lost: 'Förlorat', withdrawn: 'Återkallat' };

/** Vinstprocent: vunna av avgjorda anbud */
export function winRate(statuses: string[]) {
  const won = statuses.filter((s) => s === 'won').length, decided = statuses.filter((s) => s === 'won' || s === 'lost').length;
  return decided ? Math.round(won / decided * 1000) / 10 : null;
}
export const bidMargin = (bid: number, cost: number) => (bid ? Math.round((bid - cost) / bid * 1000) / 10 : 0);

/** Avropat mot taket: varning vid gränsen och när taket är nått eller överskridet */
export function capStatus(used: number, cap: number, warnPct: number) {
  const pct = cap ? Math.round(used / cap * 1000) / 10 : 0;
  return { used, left: cap - used, pct, level: pct >= 100 ? 'over' : pct >= warnPct ? 'warn' : 'ok' } as const;
}

export const daysTo = (d: string, today: string) => Math.round((Date.parse(d) - Date.parse(today)) / 864e5);
export const expiring = (end: string, today: string, days = 60) => daysTo(end, today) <= days;
