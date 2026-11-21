// Styrelsearvoden: lön eller faktura, F-skatt, skatteavdrag och arbetsgivaravgifter. Belopp i öre.
export type Mode = 'salary' | 'invoice';
export type Recipient = 'person' | 'company';
export const FEE_ACCOUNT = 7240;
export const WITHHOLDING = 30;          // skatteavdrag när mottagaren saknar F-skatt
export const FEE_RATE = 31.42;          // full arbetsgivaravgift
export const NO_FEE_LIMIT = 100000;     // ersättning under 1 000 kr per år och mottagare är avgiftsfri

export interface Member { mode: Mode; recipient: Recipient; fSkatt: boolean; inBusiness: boolean }

/**
 * Styrelsearvode är normalt inkomst av tjänst och betalas som lön. Fakturering godtas bara om uppdraget utförs i mottagarens
 * näringsverksamhet (Skatteverkets villkor) och mottagaren har F-skatt; annars dras skatt och, för fysiska personer, arbetsgivaravgifter.
 */
export function assess(m: Member) {
  if (m.mode === 'salary') return { treatment: 'salary' as const, withhold: true, fees: true, note: 'Betalas som lön i lönekörningen med skatteavdrag och arbetsgivaravgifter' };
  if (!m.inBusiness) return { treatment: 'salary' as const, withhold: true, fees: true, note: 'Fakturering godtas inte när uppdraget inte ingår i mottagarens näringsverksamhet – betala som lön' };
  if (m.fSkatt) return { treatment: 'invoice' as const, withhold: false, fees: false, note: 'Faktura från mottagare med F-skatt – inget skatteavdrag och inga arbetsgivaravgifter' };
  return { treatment: 'invoice' as const, withhold: true, fees: m.recipient === 'person', note: m.recipient === 'person' ? 'Mottagaren saknar F-skatt – dra 30 % skatt och betala arbetsgivaravgifter' : 'Mottagaren saknar F-skatt – dra 30 % skatt' };
}

/** Utbetalning mot faktura: kostnad, eventuellt skatteavdrag och avgifter, utbetalt netto */
export function invoiceLines(amount: number, a: ReturnType<typeof assess>, yearTotalBefore: number, bank = 1930) {
  const tax = a.withhold ? Math.floor((amount * WITHHOLDING) / 10000) * 100 : 0;
  const feesDue = a.fees && yearTotalBefore + amount >= NO_FEE_LIMIT;
  const fee = feesDue ? Math.round((amount * FEE_RATE) / 100) : 0;
  const lines = [{ account: FEE_ACCOUNT, amount }, { account: 2710, amount: -tax }, { account: bank, amount: -(amount - tax) }, { account: 7510, amount: fee }, { account: 2731, amount: -fee }].filter((l) => l.amount);
  return { lines, tax, fee, net: amount - tax };
}

/** Stämmoperioden: från årsstämman till nästa års stämma */
export function period(agm: string) { const y = Number(agm.slice(0, 4)); return `${y}/${String(y + 1).slice(2)}`; }
