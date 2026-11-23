// Lantbruk. Belopp i öre; rader med positivt belopp = debet.
export const SUBSIDY_RECEIVABLE = 1684, SUBSIDY_INCOME = 3981, LIVESTOCK = 1450, LIVESTOCK_CHANGE = 4950;

/** Stödet tas upp som fordran och intäkt för det år det avser */
export const receivableLines = (amount: number) => [{ account: SUBSIDY_RECEIVABLE, amount }, { account: SUBSIDY_INCOME, amount: -amount }];
/** Utbetalningen löser upp fordran; skillnad mot det bokförda justerar intäkten */
export function paymentLines(paid: number, booked: number, bank = 1930) {
  const diff = paid - booked;
  return [{ account: bank, amount: paid }, ...(booked ? [{ account: SUBSIDY_RECEIVABLE, amount: -booked }] : []), ...(diff ? [{ account: SUBSIDY_INCOME, amount: -diff }] : [])];
}

/** Djurinventeringens värde: antal × värde per djur för varje djurslag */
export function valuation(counts: { type: string; heads: number; value_per_head: number }[]) {
  const rows = counts.filter((c) => c.heads > 0).map((c) => ({ ...c, value: c.heads * c.value_per_head }));
  return { rows, value: rows.reduce((s, r) => s + r.value, 0) };
}
/** Lagerförändring: ökat djurlager minskar kostnaden (kredit 4950), minskat ökar den */
export const changeLines = (change: number) => (change ? [{ account: LIVESTOCK, amount: change }, { account: LIVESTOCK_CHANGE, amount: -change }] : []);
