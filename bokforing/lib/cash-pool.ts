// Koncernkonto (cash pool). Belopp i öre; rader med positivt belopp = debet.
export interface SignedLine { account: number; amount: number }
export const MEMBER_CLAIM = 1660; // Kortfristiga fordringar hos koncernföretag (negativt saldo = skuld)
export const MASTER_DEBT = 2860; // Kortfristiga skulder till koncernföretag (negativt saldo = fordran)
export const INTEREST_INCOME = 8310, INTEREST_COST = 8420;

/** Överföring till (positiv) eller från (negativ) huvudkontot */
export const sweepLines = (amount: number, side: 'member' | 'master', bank: number): SignedLine[] =>
  side === 'member' ? [{ account: MEMBER_CLAIM, amount }, { account: bank, amount: -amount }] : [{ account: bank, amount }, { account: MASTER_DEBT, amount: -amount }];

/** Internränta som läggs till saldot: positiv = dotterbolaget får ränta, negativ = dotterbolaget betalar */
export function interestLines(interest: number, side: 'member' | 'master'): SignedLine[] {
  if (!interest) return [];
  if (side === 'member') return interest > 0 ? [{ account: MEMBER_CLAIM, amount: interest }, { account: INTEREST_INCOME, amount: -interest }] : [{ account: INTEREST_COST, amount: -interest }, { account: MEMBER_CLAIM, amount: interest }];
  return interest > 0 ? [{ account: INTEREST_COST, amount: interest }, { account: MASTER_DEBT, amount: -interest }] : [{ account: MASTER_DEBT, amount: -interest }, { account: INTEREST_INCOME, amount: interest }];
}

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
export function monthBounds(period: string) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
}

/**
 * Ränta för en månad på det dagliga saldot (överföringar räknas från och med sin dag), dagräkning faktiska dagar/365.
 * Positivt saldo ger insättningsräntan, negativt saldo utlåningsräntan.
 */
export function monthlyInterest(transfers: { date: string; amount: number }[], period: string, depositRate: number, borrowRate: number) {
  const { from, to } = monthBounds(period);
  let balance = transfers.filter((t) => t.date < from).reduce((s, t) => s + t.amount, 0);
  const inMonth = transfers.filter((t) => t.date >= from && t.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  let acc = 0, cursor = from, sumBalance = 0;
  const step = (until: string) => {
    const n = days(cursor, until) - 1; // dagar före "until"
    if (n > 0) { acc += balance * (balance >= 0 ? depositRate : borrowRate) / 100 / 365 * n; sumBalance += balance * n; }
  };
  for (const t of inMonth) { step(t.date); cursor = t.date; balance += t.amount; }
  const total = days(from, to);
  const n = days(cursor, to);
  acc += balance * (balance >= 0 ? depositRate : borrowRate) / 100 / 365 * n; sumBalance += balance * n;
  return { interest: Math.round(acc), average: Math.round(sumBalance / total), closing: balance };
}
