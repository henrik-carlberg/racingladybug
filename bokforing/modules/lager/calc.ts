// Lager: beräkningar utan databas. Antal med tre decimaler, belopp i öre.

export const q3 = (n: number) => Math.round(n * 1000) / 1000;

/** Nytt vägt genomsnittspris efter inleverans (öre per enhet, två decimaler) */
export function weightedAverage(onHand: number, avgCost: number, inQty: number, inPrice: number): number {
  const before = Math.max(0, onHand);
  const total = before + inQty;
  if (total <= 0) return inPrice;
  return Math.round(((before * avgCost + inQty * inPrice) / total) * 100) / 100;
}

/** Radbelopp i öre */
export const lineAmount = (qty: number, unitPrice: number) => Math.round(qty * unitPrice);

/** Netto och moms per momssats för orderrader */
export function orderTotals(lines: { qty: number; unit_price: number; vat_rate: number }[]) {
  const byRate = new Map<number, number>();
  for (const l of lines) byRate.set(l.vat_rate, (byRate.get(l.vat_rate) ?? 0) + lineAmount(l.qty, l.unit_price));
  const net = [...byRate.values()].reduce((s, v) => s + v, 0);
  const vat = [...byRate.entries()].reduce((s, [r, v]) => s + Math.round((v * r) / 100), 0);
  return { net, vat, total: net + vat };
}

export interface ReorderInput { id: number; sku: string; name: string; supplier_id: number | null; on_hand: number; on_order: number; reserved: number; reorder_point: number; reorder_qty: number }
/** Beställningsförslag: tillgängligt (i lager + beställt − reserverat) under beställningspunkten */
export function reorderSuggestions(products: ReorderInput[]) {
  return products
    .map((p) => ({ ...p, available: q3(p.on_hand + p.on_order - p.reserved) }))
    .filter((p) => p.reorder_point > 0 && p.available < p.reorder_point)
    .map((p) => ({ ...p, suggested: q3(Math.max(p.reorder_qty, p.reorder_point - p.available)) }));
}

/**
 * Lagervärde. Inkomstskattelagen 17 kap. 4 §: lagret får tas upp till lägst 97 % av anskaffningsvärdet
 * (schablonmetoden) om lagret värderas enligt lägsta värdets princip och inkurans inte beaktas separat.
 */
export function inventoryValue(items: { qty: number; avg_cost: number }[], use97 = false) {
  const cost = Math.round(items.reduce((s, i) => s + Math.max(0, i.qty) * i.avg_cost, 0));
  return { cost, book: use97 ? Math.round(cost * 0.97) : cost };
}

/** Status för en inköpsorder utifrån mottagna antal */
export function receiptStatus(lines: { qty: number; received: number }[]): 'sent' | 'partial' | 'received' {
  if (lines.every((l) => l.received >= l.qty)) return 'received';
  return lines.some((l) => l.received > 0) ? 'partial' : 'sent';
}

/** Tolkar antal "1,5" / "2" → tal med tre decimaler, null om ogiltigt */
export function parseQty(s: unknown): number | null {
  if (s == null || s === '') return null;
  const n = Number(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? q3(n) : null;
}
