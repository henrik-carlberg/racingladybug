// Kupongskatt på utdelning till utländska ägare (kupongskattelagen). Belopp i öre.
export const STANDARD = 30;
export const TAX_ACCOUNT = 2750, DIVIDEND_DEBT = 2898;
/** Vanliga avtalssatser för fysiska personer och portföljaktieägare – kontrollera alltid mot skatteavtalet */
export const TREATY: Record<string, number> = { NO: 15, DK: 15, FI: 15, IS: 15, DE: 15, NL: 15, FR: 15, US: 15, GB: 5, ES: 15, IT: 15, CH: 15 };
export const EU = new Set(['AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SI','SK']);

export interface Recipient { country: string; type: 'person' | 'company'; holdingPct: number; businessRelated: boolean; treatyRate: number | null }
/**
 * Skattesatsen: utländska bolag med näringsbetingade andelar (eller minst 10 % av kapitalet för EU-bolag enligt moder-/dotterbolagsdirektivet)
 * är befriade; annars 30 % eller lägre enligt skatteavtal.
 */
export function rate(r: Recipient) {
  const c = r.country.toUpperCase();
  if (r.type === 'company' && (r.businessRelated || (EU.has(c) && r.holdingPct >= 10))) return { pct: 0, rule: 'Befriad – näringsbetingade andelar eller EU-bolag med minst 10 % av kapitalet' };
  if (r.treatyRate != null) return { pct: r.treatyRate, rule: `Skatteavtal (angiven sats ${r.treatyRate} %)` };
  if (TREATY[c] != null) return { pct: TREATY[c], rule: `Skatteavtal med ${c} (${TREATY[c]} %) – kontrollera hemvistintyg och avtalet` };
  return { pct: STANDARD, rule: 'Kupongskatt 30 %' };
}

export function tax(gross: number, pct: number) { return Math.round((gross * pct) / 100); }

/** Utbetalning: skulden för beslutad utdelning minskar, kupongskatten hålls inne och resten betalas ut */
export const payoutLines = (gross: number, withheld: number, bank = 1930) =>
  [{ account: DIVIDEND_DEBT, amount: gross }, { account: TAX_ACCOUNT, amount: -withheld }, { account: bank, amount: -(gross - withheld) }].filter((l) => l.amount);
