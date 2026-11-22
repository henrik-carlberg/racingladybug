// Kassabok för kontantkassan (ren logik). Belopp i öre.
export const CASH_ACCOUNT = 1910, DIFF_ACCOUNT = 3740;
/** Kassan ska räknas minst så här ofta (dagar) */
export const COUNT_INTERVAL = 30;

/** Löpande saldo per post; kassan får aldrig bli negativ */
export function running(opening: number, entries: { date: string; amount: number }[]) {
  let bal = opening;
  return [...entries].sort((a, b) => a.date.localeCompare(b.date)).map((e) => { bal += e.amount; return { ...e, balance: bal, negative: bal < 0 }; });
}

/** Kassainventering: räknat belopp mot bokfört saldo – differensen bokförs mot 3740 (öres- och kassadifferenser) */
export function countLines(counted: number, booked: number) {
  const diff = counted - booked;
  return { diff, lines: diff ? [{ account: CASH_ACCOUNT, amount: diff }, { account: DIFF_ACCOUNT, amount: -diff }] : [] };
}
