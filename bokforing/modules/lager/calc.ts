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

export type CostMethod = 'avg' | 'fifo';
export type ValuationRule = 'cost' | 'lvp' | '97';
export interface Movement { date: string; qty: number; unit_cost: number; type: string }

/**
 * FIFO (först in, först ut): det som finns kvar i lagret värderas till de senaste inleveranserna.
 * Uttag och negativa justeringar förbrukar de äldsta lagren först; flyttar mellan lagerställen påverkar inte artikelns värde.
 */
export function fifoValue(movements: Movement[]) {
  const layers: { qty: number; cost: number }[] = [];
  const sorted = [...movements].filter((m) => m.type !== 'transfer').sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const m of sorted) {
    if (m.qty > 0) { layers.push({ qty: m.qty, cost: m.unit_cost }); continue; }
    let out = -m.qty;
    while (out > 0.0005 && layers.length) {
      const l = layers[0];
      const take = Math.min(l.qty, out);
      l.qty = q3(l.qty - take); out = q3(out - take);
      if (l.qty <= 0.0005) layers.shift();
    }
  }
  const qty = q3(layers.reduce((s, l) => s + l.qty, 0));
  return { qty, value: Math.round(layers.reduce((s, l) => s + l.qty * l.cost, 0)), layers };
}

export interface ValuedItem { sku: string; name: string; qty: number; cost: number; salesPrice: number; obsoletePct: number }
/**
 * Lägsta värdets princip per artikel: det lägsta av anskaffningsvärdet och nettoförsäljningsvärdet
 * (försäljningspris minus beräknade försäljningskostnader), med individuell nedskrivning för inkurans.
 */
export function lowestValue<T extends ValuedItem>(items: T[], sellCostPct = 0) {
  const rows = items.map((i) => {
    const qty = Math.max(0, i.qty);
    const nrvUnit = i.salesPrice > 0 ? i.salesPrice * (1 - sellCostPct / 100) : null;
    const costValue = Math.round(i.cost);
    const unitCost = qty ? i.cost / qty : 0;
    const lvpUnit = nrvUnit != null ? Math.min(unitCost, nrvUnit) : unitCost;
    const lvp = Math.round(qty * lvpUnit * (1 - Math.min(100, Math.max(0, i.obsoletePct)) / 100));
    return { ...i, qty, costValue, nrvUnit, lvp, writedown: costValue - lvp, belowCost: nrvUnit != null && nrvUnit < unitCost };
  });
  const cost = rows.reduce((s, r) => s + r.costValue, 0);
  const lvp = rows.reduce((s, r) => s + r.lvp, 0);
  return { rows, cost, lvp, r97: Math.round(cost * 0.97) };
}

/** Värde att bokföra enligt vald regel, och vilken av de tillåtna reglerna som ger lägst värde (IL 17 kap. 3–4 §§) */
export function bookValue(v: { cost: number; lvp: number; r97: number }, rule: ValuationRule) {
  const book = rule === '97' ? v.r97 : rule === 'lvp' ? v.lvp : v.cost;
  const lowest: ValuationRule = v.lvp <= v.r97 ? 'lvp' : '97';
  return { book, lowest, lowestValue: Math.min(v.lvp, v.r97) };
}

/** Inventeringsdifferens: överskott ökar lagret (1460) mot lagerförändring (4960), svinn tvärtom */
export function countLines(value: number, inventory = 1460, change = 4960) {
  return [{ account: inventory, amount: value }, { account: change, amount: -value }];
}
