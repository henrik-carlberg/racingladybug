// Ägarbyte och generationsskifte (ren logik): omkostnadsbelopp och sparat utdelningsutrymme vid överlåtelse av aktier,
// och aktieägartillskott. Belopp i öre.
export type TransferKind = 'sale' | 'gift' | 'inheritance';
export const TRANSFER_LABEL: Record<TransferKind, string> = { sale: 'Försäljning', gift: 'Gåva', inheritance: 'Arv' };

/**
 * Köp: köparens omkostnadsbelopp är köpeskillingen; säljarens andel av omkostnadsbeloppet dras av mot priset (kapitalvinst)
 * och det sparade utdelningsutrymmet för de sålda aktierna följer inte med.
 * Gåva och arv (benefikt fång): köparen övertar säljarens omkostnadsbelopp och sparade utdelningsutrymme för aktierna
 * (kontinuitetsprincipen). En "gåva" där ersättningen överstiger omkostnadsbeloppet behandlas som försäljning (huvudsaklighetsprincipen).
 */
export function transferTax(o: { kind: TransferKind; price: number; sellerShares: number; shares: number; sellerCost: number; sellerSaved: number }) {
  if (!(o.shares > 0 && o.shares <= o.sellerShares)) throw new Error('Ogiltigt antal aktier');
  const f = o.shares / o.sellerShares;
  const movedCost = Math.round(o.sellerCost * f), movedSaved = Math.round(o.sellerSaved * f);
  const asSale = o.kind === 'sale' || (o.kind === 'gift' && o.price > movedCost);
  return {
    asSale, movedCost, movedSaved,
    buyerCost: asSale ? o.price : movedCost,
    buyerSaved: asSale ? 0 : movedSaved,
    gain: asSale ? o.price - movedCost : 0,
    sellerCostAfter: o.sellerCost - movedCost,
    sellerSavedAfter: o.sellerSaved - movedSaved,
    note: o.kind === 'gift' && asSale ? 'Ersättningen överstiger omkostnadsbeloppet – överlåtelsen behandlas som försäljning' : '',
  };
}

export type ContributionKind = 'ovillkorat' | 'villkorat';
/** Aktieägartillskott: bank mot 2093. Ett ovillkorat tillskott ökar ägarens omkostnadsbelopp för aktierna. */
export function contributionLines(amount: number, bank = 1930) {
  return [{ account: bank, amount }, { account: 2093, amount: -amount }];
}
