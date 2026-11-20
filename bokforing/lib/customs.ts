// Import och tull (ren logik): momsunderlag enligt Tullverkets beslut, bokning, fördelning av tull och frakt på varorna. Belopp i öre.
export const IMPORT_BASE: Record<number, number> = { 25: 4545, 12: 4546, 6: 4547 };
export const IMPORT_BASE_OFFSET = 4549;   // Motkonto beskattningsunderlag import
export const IMPORT_VAT: Record<number, number> = { 25: 2615, 12: 2625, 6: 2635 };
export const IMPORT_INPUT_VAT = 2645;     // Beräknad ingående moms på förvärv från utlandet
export const DUTY_ACCOUNT = 5720;         // Tull- och speditionskostnader
export const CUSTOMS_DEBT = 2895;         // Skuld till Tullverket (tull och avgifter)

export interface Decision { customsValue: number; duty: number; fees: number; freightSweden: number; vatRate: 25 | 12 | 6 }

/** Beskattningsunderlag för importmoms (ML): tullvärdet + tull och andra avgifter + kostnader för transport till bestämmelseorten i Sverige */
export function importVat(d: Decision) {
  const base = d.customsValue + d.duty + d.fees + d.freightSweden;
  return { base, vat: Math.round((base * d.vatRate) / 100) };
}

/**
 * Verifikation för ett tullbeslut. Importmomsen redovisas i egen momsdeklaration (ruta 50 och 60–62) och dras av som ingående moms (ruta 48)
 * när bolaget har full avdragsrätt. Tull och avgifter är en skuld till Tullverket.
 */
export function decisionLines(d: Decision, deductible = true): { account: number; amount: number }[] {
  const { base, vat } = importVat(d);
  const l = [
    { account: IMPORT_BASE[d.vatRate], amount: base }, { account: IMPORT_BASE_OFFSET, amount: -base },
    { account: IMPORT_VAT[d.vatRate], amount: -vat },
  ];
  l.push(deductible ? { account: IMPORT_INPUT_VAT, amount: vat } : { account: DUTY_ACCOUNT, amount: vat });
  const due = d.duty + d.fees;
  if (due) l.push({ account: DUTY_ACCOUNT, amount: due }, { account: CUSTOMS_DEBT, amount: -due });
  return l.filter((x) => x.amount !== 0);
}

/** Fördelar tull, avgifter och frakt på orderraderna efter värde (största raden tar avrundningen) */
export function allocate(lines: { id: number; qty: number; value: number }[], extra: number) {
  const total = lines.reduce((s, l) => s + l.value, 0);
  if (!total || !lines.length) return lines.map((l) => ({ ...l, allocated: 0, unitExtra: 0 }));
  const out = lines.map((l) => ({ ...l, allocated: Math.round((extra * l.value) / total) }));
  const diff = extra - out.reduce((s, l) => s + l.allocated, 0);
  out.reduce((a, b) => (b.value > a.value ? b : a)).allocated += diff;
  return out.map((l) => ({ ...l, unitExtra: l.qty ? Math.round((l.allocated / l.qty) * 100) / 100 : 0 }));
}

/** Nytt genomsnittspris när påslaget gäller enheter som fortfarande finns i lager (sålda enheters del blir kostnad direkt) */
export function landedAverage(o: { onHand: number; avgCost: number; received: number; allocated: number }) {
  if (o.onHand <= 0 || o.received <= 0) return { avgCost: o.avgCost, toInventory: 0 };
  const share = Math.min(o.onHand, o.received) / o.received;
  const toInventory = Math.round(o.allocated * share);
  return { avgCost: Math.round((o.avgCost + toInventory / o.onHand) * 100) / 100, toInventory };
}

/** Avstämning mot Tullverkets besked för en månad */
export function reconcile(o: { decisions: number; booked: number; statement: number | null }) {
  const diffBooked = o.booked - o.decisions;
  const diffStatement = o.statement == null ? null : o.statement - o.decisions;
  return { diffBooked, diffStatement, ok: diffBooked === 0 && (diffStatement == null || diffStatement === 0) };
}
