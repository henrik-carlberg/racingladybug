// Sponsring och gåvor till affärsförbindelser: avdragsrätt och moms (ren logik). Belopp i öre.
export const ACCOUNTS = { sponsor: 5980, gift: 5990, nonDeductible: 6993, vatIn: 2641, bank: 1930 } as const;
/** Gåvor till affärsförbindelser är avdragsgilla om värdet är obetydligt: högst 300 kr exkl. moms per mottagare (kontrollera hos Skatteverket) */
export const GIFT_LIMIT = 30000;

/**
 * Sponsring är avdragsgill när bolaget får en motprestation (t.ex. reklamplats eller exponering) som motsvarar betalningen.
 * Utan motprestation är det en gåva, som inte är avdragsgill och där momsen inte heller får dras av.
 */
export function sponsorLines(o: { amount: number; vat: number; counter: boolean }) {
  if (o.counter) return { deductible: true, lines: [{ account: ACCOUNTS.sponsor, amount: o.amount }, ...(o.vat ? [{ account: ACCOUNTS.vatIn, amount: o.vat }] : []), { account: ACCOUNTS.bank, amount: -(o.amount + o.vat) }] };
  return { deductible: false, lines: [{ account: ACCOUNTS.nonDeductible, amount: o.amount + o.vat }, { account: ACCOUNTS.bank, amount: -(o.amount + o.vat) }] };
}

/** Gåvor till kunder och affärskontakter: avdragsgilla med moms om värdet per mottagare ryms inom gränsen, annars inte alls */
export function giftLines(o: { amount: number; vat: number; recipients: number }) {
  const per = Math.round(o.amount / Math.max(1, o.recipients));
  const deductible = per <= GIFT_LIMIT;
  return { per, deductible, lines: deductible
    ? [{ account: ACCOUNTS.gift, amount: o.amount }, ...(o.vat ? [{ account: ACCOUNTS.vatIn, amount: o.vat }] : []), { account: ACCOUNTS.bank, amount: -(o.amount + o.vat) }]
    : [{ account: ACCOUNTS.nonDeductible, amount: o.amount + o.vat }, { account: ACCOUNTS.bank, amount: -(o.amount + o.vat) }] };
}
