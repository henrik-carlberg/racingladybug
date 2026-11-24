// Ränteswappar (betala fast ränta, ta emot rörlig). Belopp i öre, räntor i procent per år.
export const INTEREST_COST = 8410, BANK = 1930;
const addMonths = (d: string, m: number) => { const x = new Date(`${d}T00:00:00Z`); const day = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + m); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(day, last)); return x.toISOString().slice(0, 10); };
export const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/** Avräkningsperioder från start till slut */
export function schedule(start: string, end: string, months: number) {
  const out: { start: string; end: string }[] = [];
  for (let i = 0, s = start; s < end && i < 600; i++) { const e = addMonths(start, months * (i + 1)); out.push({ start: s, end: e < end ? e : end }); s = e; }
  return out;
}
/** Nettobetalning för perioden (dagar/360): positiv när den rörliga räntan är högre än den fasta och bolaget får betalt */
export const settlement = (notional: number, fixed: number, floating: number, d: number) => Math.round(notional * (floating - fixed) / 100 * d / 360);
/** Nettot bokförs mot räntekostnaden: betalning ökar kostnaden, mottagen betalning minskar den */
export const settlementLines = (amount: number) => (amount >= 0
  ? [{ account: BANK, amount }, { account: INTEREST_COST, amount: -amount }]
  : [{ account: INTEREST_COST, amount: -amount }, { account: BANK, amount }]);
/** Lånets effektiva ränta efter säkringen: den säkrade andelen får swapräntan i stället för den rörliga referensräntan */
export function effectiveRate(loanRate: number, floating: number, fixed: number, hedged: number, balance: number) {
  const share = balance > 0 ? Math.min(1, hedged / balance) : 0;
  return Math.round((loanRate + share * (fixed - floating)) * 1000) / 1000;
}
/** Upplysning i årsredovisningen om derivat som inte redovisas till verkligt värde */
export const noteText = (s: { counterparty: string; notional: number; fixed_rate: number; floating_index: string; end_date: string }, mv: number | null, date: string | null, fmt: (n: number) => string) =>
  `Bolaget har ett ränteswapavtal med ${s.counterparty} om nominellt ${fmt(s.notional)} kr där bolaget betalar fast ränta ${s.fixed_rate.toLocaleString('sv-SE')} % och erhåller ${s.floating_index} till och med ${s.end_date}. Avtalet säkrar ränterisken i bolagets lån.${mv != null && date ? ` Verkligt värde per ${date} uppgick till ${fmt(mv)} kr.` : ''}`;
