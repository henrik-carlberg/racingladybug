// Konvertibler och teckningsoptioner. Belopp i öre; rader med positivt belopp = debet.
export const CONVERTIBLE = 2320, SHARE_CAPITAL = 2081, PREMIUM_FUND = 2097, INTEREST_COST = 8410, ACCRUED_INTEREST = 2960;

/** Utgivning: konvertibeln är ett lån, optionspremien tillförs fritt eget kapital */
export const issueLines = (kind: 'convertible' | 'warrant', amount: number, bank = 1930) =>
  amount ? [{ account: bank, amount }, { account: kind === 'convertible' ? CONVERTIBLE : PREMIUM_FUND, amount: -amount }] : [];

/** Upplupen ränta (faktiska dagar/365) från utgivningen till ett datum, minus det som redan bokförts */
export function accruedInterest(o: { amount: number; pct: number; from: string; to: string; booked: number }) {
  const days = Math.max(0, Math.round((Date.parse(o.to) - Date.parse(o.from)) / 864e5));
  return Math.max(0, Math.round(o.amount * o.pct / 100 * days / 365) - o.booked);
}
export const interestLines = (amount: number) => (amount ? [{ account: INTEREST_COST, amount }, { account: ACCRUED_INTEREST, amount: -amount }] : []);

/** Konvertering: lånet blir aktiekapital (kvotvärdet) och överkurs */
export function conversionLines(amount: number, shares: number, quota: number) {
  const capital = Math.round(shares * quota);
  if (capital > amount) throw new Error('Konverteringskursen får inte vara lägre än kvotvärdet');
  return { capital, lines: [{ account: CONVERTIBLE, amount }, { account: SHARE_CAPITAL, amount: -capital }, ...(amount > capital ? [{ account: PREMIUM_FUND, amount: -(amount - capital) }] : [])] };
}
/** Teckning med optioner: teckningslikviden blir aktiekapital och överkurs */
export function exerciseLines(shares: number, strike: number, quota: number, bank = 1930) {
  const total = shares * strike, capital = Math.round(shares * quota);
  if (capital > total) throw new Error('Teckningskursen får inte vara lägre än kvotvärdet');
  return { total, capital, lines: [{ account: bank, amount: total }, { account: SHARE_CAPITAL, amount: -capital }, ...(total > capital ? [{ account: PREMIUM_FUND, amount: -(total - capital) }] : [])] };
}

/** Utspädning: ägarandel i dag och om alla utestående instrument utnyttjas */
export function dilution(holders: { name: string; shares: number }[], potential: { name: string; shares: number }[]) {
  const now = holders.reduce((s, h) => s + h.shares, 0), extra = potential.reduce((s, p) => s + p.shares, 0);
  const names = [...new Set([...holders.map((h) => h.name), ...potential.map((p) => p.name)])];
  return names.map((n) => {
    const cur = holders.filter((h) => h.name === n).reduce((s, h) => s + h.shares, 0), add = potential.filter((p) => p.name === n).reduce((s, p) => s + p.shares, 0);
    return { name: n, shares: cur, pct: now ? Math.round(cur / now * 1000) / 10 : 0, diluted: now + extra ? Math.round((cur + add) / (now + extra) * 1000) / 10 : 0 };
  }).sort((a, b) => b.diluted - a.diluted);
}
