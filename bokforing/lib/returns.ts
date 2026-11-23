// Returer och reklamationer. Belopp i öre.
export const REASONS: Record<string, string> = { defect: 'Fel på varan', damaged: 'Transportskada', wrong_item: 'Fel vara levererad', regret: 'Ångerrätt', other: 'Annat' };
export const isReason = (s: string) => Object.prototype.hasOwnProperty.call(REASONS, s);

/** Hur mycket av en fakturarad som fortfarande kan returneras */
export function returnable(invoiced: number, returned: number) {
  return Math.max(0, Math.round((invoiced - returned) * 1000) / 1000);
}

/** Artikeln på en fakturarad: kundorderfakturor börjar med artikelnumret ("SKU-1 Namn") */
export function skuOf(description: string, skus: string[]) {
  const first = description.trim().split(/\s+/)[0] ?? '';
  return skus.find((s) => s.toLowerCase() === first.toLowerCase()) ?? null;
}

export interface StatRow { reason: string; status: string; value: number; product: string | null; qty: number }
/** Reklamationsorsaker och artiklar: antal ärenden och returnerat värde exkl. moms (avslagna räknas för sig) */
export function reasonStats(rows: (StatRow & { case_id: number })[]) {
  const by = new Map<string, { reason: string; label: string; cases: Set<number>; value: number; rejected: number }>();
  const prod = new Map<string, { product: string; qty: number; cases: Set<number> }>();
  for (const r of rows) {
    const b = by.get(r.reason) ?? { reason: r.reason, label: REASONS[r.reason] ?? r.reason, cases: new Set<number>(), value: 0, rejected: 0 };
    b.cases.add(r.case_id);
    if (r.status === 'rejected') b.rejected += r.value; else b.value += r.value;
    by.set(r.reason, b);
    if (r.product) {
      const p = prod.get(r.product) ?? { product: r.product, qty: 0, cases: new Set<number>() };
      p.qty += r.qty; p.cases.add(r.case_id); prod.set(r.product, p);
    }
  }
  return {
    reasons: [...by.values()].map((b) => ({ reason: b.reason, label: b.label, cases: b.cases.size, value: b.value, rejected: b.rejected })).sort((a, b) => b.cases - a.cases || b.value - a.value),
    products: [...prod.values()].map((p) => ({ product: p.product, qty: Math.round(p.qty * 1000) / 1000, cases: p.cases.size })).sort((a, b) => b.cases - a.cases || b.qty - a.qty),
  };
}
