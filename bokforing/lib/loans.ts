// Lån och finansiering: amorteringsplaner (rak amortering eller annuitet), bokföring och factoring. Ren logik, öre.

export type LoanType = 'straight' | 'annuity';
export interface Row { n: number; date: string; interest: number; amortization: number; payment: number; balance: number }

const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};

/** Månadsvis plan från första betalningsdagen. Räntan = skuld × årsränta / 12. Sista raden tar resten. */
export function schedule(o: { principal: number; ratePct: number; firstDate: string; months: number; type: LoanType; startN?: number }): Row[] {
  if (!(o.principal > 0) || !(o.months > 0) || o.months > 600) throw new Error('Ange belopp och löptid');
  const r = o.ratePct / 100 / 12;
  const annuity = o.type === 'annuity' ? (r === 0 ? o.principal / o.months : (o.principal * r) / (1 - Math.pow(1 + r, -o.months))) : 0;
  let bal = o.principal;
  const out: Row[] = [];
  for (let i = 0; i < o.months; i++) {
    const interest = Math.round(bal * r);
    let amort = o.type === 'straight' ? Math.round(o.principal / o.months) : Math.round(annuity) - interest;
    if (i === o.months - 1 || amort > bal) amort = bal;
    bal -= amort;
    out.push({ n: (o.startN ?? 1) + i, date: addMonths(o.firstDate, i), interest, amortization: amort, payment: interest + amort, balance: bal });
  }
  return out;
}

/** Bokföring av en betalning: ränta (8410) och amortering (lånekontot) mot banken */
export function paymentLines(row: Pick<Row, 'interest' | 'amortization'>, loanAccount: number, bankAccount = 1930) {
  return [
    ...(row.interest ? [{ account: 8410, amount: row.interest }] : []),
    ...(row.amortization ? [{ account: loanAccount, amount: row.amortization }] : []),
    { account: bankAccount, amount: -(row.interest + row.amortization) },
  ];
}

/**
 * Factoring (försäljning av kundfakturan utan regress): kundfordran ersätts av en fordran på finansiären (1689),
 * utbetalningen och avgiften bokas mot den. Avgift på 6064 Factoringavgifter.
 */
export function factoringLines(o: { invoiceAmount: number; advance: number; fee: number }) {
  if (o.advance + o.fee !== o.invoiceAmount) throw new Error('Utbetalning och avgift ska tillsammans vara fakturans belopp');
  return [{ account: 1930, amount: o.advance }, ...(o.fee ? [{ account: 6064, amount: o.fee }] : []), { account: 1689, amount: -o.invoiceAmount }];
}

/** Hur mycket av en kredit som används (negativt banksaldo) */
export const creditUse = (limit: number, bankBalance: number) => ({ used: Math.max(0, -bankBalance), left: Math.max(0, limit + Math.min(0, bankBalance)), pct: limit > 0 ? Math.round((Math.max(0, -bankBalance) / limit) * 100) : 0 });
