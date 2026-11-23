// Franchise. Belopp i öre; rader med positivt belopp = debet.
export const ENTRY_DEFERRED = 2973, FUND = 2974, ROYALTY_INCOME = 3041, ENTRY_INCOME = 3042, FUND_INCOME = 3043;
export const ACCOUNT_NAMES: Record<number, string> = { [ENTRY_DEFERRED]: 'Förutbetalda inträdesavgifter', [FUND]: 'Marknadsföringsfond (franchise)', [ROYALTY_INCOME]: 'Royalty från franchisetagare',
  [ENTRY_INCOME]: 'Inträdesavgifter', [FUND_INCOME]: 'Marknadsavgifter, använda i fonden' };

/** Royalty och marknadsavgift på rapporterad omsättning exkl. moms */
export function fees(turnover: number, royaltyPct: number, marketingPct: number) {
  return { royalty: Math.round(turnover * royaltyPct / 100), marketing: Math.round(turnover * marketingPct / 100) };
}

const monthIndex = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
/** Påbörjade avtalsmånader fram till och med ett datum (högst hela avtalstiden) */
export function elapsedMonths(start: string, end: string, at: string) {
  const total = Math.max(1, monthIndex(end) - monthIndex(start) + (end.slice(8) >= start.slice(8) ? 1 : 0));
  if (at < start) return { elapsed: 0, total };
  return { elapsed: Math.min(total, monthIndex(at) - monthIndex(start) + 1), total };
}
/** Den del av inträdesavgiften som ska vara intäktsförd: linjärt per påbörjad avtalsmånad */
export const recognizedEntry = (fee: number, start: string, end: string, at: string) => { const m = elapsedMonths(start, end, at); return Math.round(fee * m.elapsed / m.total); };

/** Perioder sedan avtalets start (till och med föregående månad) som saknar rapport */
export function missingPeriods(start: string, end: string, reported: string[], today: string) {
  const out: string[] = [];
  const last = Math.min(monthIndex(today) - 1, monthIndex(end));
  for (let i = monthIndex(start); i <= last; i++) {
    const p = `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
    if (!reported.includes(p)) out.push(p);
  }
  return out;
}

export const recognitionLines = (amount: number) => [{ account: ENTRY_DEFERRED, amount }, { account: ENTRY_INCOME, amount: -amount }];
export const fundUseLines = (amount: number) => [{ account: FUND, amount }, { account: FUND_INCOME, amount: -amount }];
