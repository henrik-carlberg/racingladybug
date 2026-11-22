// Tantiem och vinstdelning. Belopp i öre, procent i hundradelar.
export const SALARY_ACCOUNT = 7210;   // Löner till tjänstemän
export const ACCRUED_SALARY = 2910;   // Upplupna löner
export const FEE_ACCOUNT = 7519;      // Sociala avgifter för upplupna löner
export const ACCRUED_FEES = 2940;     // Upplupna lagstadgade sociala avgifter

export interface Plan { kind: 'percent' | 'target'; pct: number | null; target: number | null; amount: number | null; cap: number | null }

/** Tantiem på årets resultat (före tantiem och skatt): procent av vinsten, eller ett fast belopp när resultatet når målet. Taket begränsar. */
export function profitShare(p: Plan, result: number) {
  let v = 0;
  if (p.kind === 'percent') v = Math.max(0, Math.round((result * (p.pct ?? 0)) / 10000));
  else v = result >= (p.target ?? Infinity) ? p.amount ?? 0 : 0;
  if (p.cap != null) v = Math.min(v, p.cap);
  return Math.round(v / 100) * 100;
}

/** Upplupen tantiem med sociala avgifter: debet 7210/7519, kredit 2910/2940 (negativa belopp minskar) */
export const accrualLines = (amount: number, fee: number) => [
  { account: SALARY_ACCOUNT, amount }, { account: ACCRUED_SALARY, amount: -amount },
  { account: FEE_ACCOUNT, amount: fee }, { account: ACCRUED_FEES, amount: -fee },
].filter((l) => l.amount !== 0);
