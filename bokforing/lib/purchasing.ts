// Inköp: trevägsmatchning (order, inleverans, faktura), leverantörsavtal och prisbevakning. Ren logik, belopp i öre.

export type MatchStatus = 'matched' | 'price_diff' | 'qty_diff' | 'no_receipt';
export const MATCH_LABEL: Record<MatchStatus, string> = { matched: 'Stämmer mot order och inleverans', price_diff: 'Beloppet avviker från ordern', qty_diff: 'Fakturerat mer än som har levererats', no_receipt: 'Inget är inlevererat' };

/**
 * Trevägsmatchning: fakturans belopp (exkl. moms) mot inlevererat värde enligt orderns priser.
 * Tolerans: 1 % eller 50 kr (avrundningar, frakt i öresbelopp).
 */
export function threeWayMatch(o: { lines: { qty: number; received: number; unit_price: number }[]; invoiceNet: number; tolerancePct?: number; toleranceOre?: number }) {
  const ordered = Math.round(o.lines.reduce((s, l) => s + l.qty * l.unit_price, 0));
  const received = Math.round(o.lines.reduce((s, l) => s + l.received * l.unit_price, 0));
  const tol = Math.max(o.toleranceOre ?? 5000, Math.round(received * (o.tolerancePct ?? 1) / 100));
  const diff = o.invoiceNet - received;
  let status: MatchStatus;
  if (received === 0) status = 'no_receipt';
  else if (Math.abs(diff) <= tol) status = 'matched';
  else if (o.invoiceNet > received && o.invoiceNet <= ordered + tol) status = 'qty_diff';
  else status = 'price_diff';
  return { status, ordered, received, diff, tolerance: tol };
}

const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};

/** Avtalets aktuella slutdatum (förlängs automatiskt med förlängningsperioden) och sista dag att säga upp */
export function contractDates(c: { end: string | null; noticeMonths: number; autoRenew: boolean; renewMonths: number }, today: string) {
  if (!c.end) return { end: null, noticeBy: null, renewed: 0 };
  let end = c.end, renewed = 0;
  while (c.autoRenew && c.renewMonths > 0 && addMonths(end, -c.noticeMonths) < today && renewed < 100) { end = addMonths(end, c.renewMonths); renewed++; }
  return { end, noticeBy: addMonths(end, -c.noticeMonths), renewed };
}

export type ContractState = 'expired' | 'notice_soon' | 'active' | 'open_ended';
export function contractState(dates: { end: string | null; noticeBy: string | null }, today: string, warnDays = 45): ContractState {
  if (!dates.end || !dates.noticeBy) return 'open_ended';
  if (dates.end < today) return 'expired';
  const warnFrom = new Date(Date.parse(dates.noticeBy) - warnDays * 864e5).toISOString().slice(0, 10);
  return today >= warnFrom ? 'notice_soon' : 'active';
}

/** Prishöjning: senaste belopp mot medianen av de tre föregående (återkommande fakturor eller artikelpriser) */
export function priceIncrease(history: number[], latest: number, thresholdPct = 5) {
  const prev = history.slice(-3);
  if (prev.length < 2 || latest <= 0) return null;
  const s = [...prev].sort((a, b) => a - b), med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  if (med <= 0) return null;
  const pct = ((latest - med) / med) * 100;
  return pct > thresholdPct ? { pct: Math.round(pct * 10) / 10, from: Math.round(med), to: latest } : null;
}
