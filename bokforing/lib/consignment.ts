// Konsignationslager: varor hos återförsäljare ägs av oss tills de är sålda (ren logik). Belopp i öre.
export const STOCK = 1460, AT_RESELLER = 1465, COST = 4990;
/** Utleverans: lagervärdet flyttas till "varulager hos återförsäljare" – ingen försäljning ännu */
export const shipLines = (cost: number) => [{ account: AT_RESELLER, amount: cost }, { account: STOCK, amount: -cost }];
/** Retur från återförsäljaren */
export const returnLines = (cost: number) => [{ account: STOCK, amount: cost }, { account: AT_RESELLER, amount: -cost }];
/** Sålt enligt återförsäljarens rapport: lagerminskning till kostnad (försäljningen faktureras) */
export const soldLines = (cost: number) => [{ account: COST, amount: cost }, { account: AT_RESELLER, amount: -cost }];
export function onHand(moves: { kind: 'ship' | 'return' | 'sold'; qty: number }[]) {
  return moves.reduce((s, m) => s + (m.kind === 'ship' ? m.qty : -m.qty), 0);
}
