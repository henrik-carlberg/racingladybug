// Inköp med omvänd skattskyldighet inom Sverige: köparen räknar fram och redovisar momsen (ren logik). Belopp i öre.
export type PurchaseRc = 'construction' | 'goods';
export const RC_LABEL: Record<PurchaseRc, string> = { construction: 'Byggtjänster (ruta 24)', goods: 'Mobiltelefoner, datorkretsar, metaller, guld eller skrot (ruta 23)' };
/** Underlagskonton för ruta 23 (varor) och 24 (tjänster); utgående moms 2614 (ruta 30) och ingående moms 2647 (ruta 48) */
export const COST_ACCOUNT: Record<PurchaseRc, number> = { construction: 4425, goods: 4415 };
export const RC_VAT_OUT = 2614, RC_VAT_IN = 2647;
export const isRcCost = (n: number) => (n >= 4415 && n <= 4417) || (n >= 4425 && n <= 4427);

/** Konteringen: kostnaden på underlagskontot och beräknad moms (25 %) både som utgående och ingående – nettoeffekt noll vid full avdragsrätt */
export function rcCostLines<T extends { account: number; amount: number }>(costs: T[], kind: PurchaseRc, rate = 25) {
  const net = costs.reduce((s, c) => s + c.amount, 0);
  const vat = Math.round((net * rate) / 100);
  return { vat, lines: [...costs.map((c) => ({ ...c, account: isRcCost(c.account) ? c.account : COST_ACCOUNT[kind] })), { account: RC_VAT_IN, amount: vat } as T, { account: RC_VAT_OUT, amount: -vat } as T] };
}
