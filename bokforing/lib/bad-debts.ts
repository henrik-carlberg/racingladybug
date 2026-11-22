// Kundförluster (ren logik). Belopp i öre; rader med positivt belopp = debet.
export interface SignedLine { account: number; amount: number }

export const CONFIRMED_LOSS = 6351;
export const DOUBTFUL_LOSS = 6352;
export const DOUBTFUL_RESERVE = 1519;
export const RECEIVABLE = 1510;
export const OVERDUE_DAYS = 90;

/** Utgående moms på fakturans verifikation (2610–2639 utom omvänd skattskyldighet och import) */
export const isOutputVat = (n: number) => n >= 2610 && n <= 2639 && ![4, 5].includes(n % 10);

/** Fordrans momsdel fördelad på momskontona, i proportion till den del av fordran som återstår */
export function vatShare(invoiceLines: { account: number; amount: number }[], remaining: number) {
  const receivable = invoiceLines.filter((l) => l.account === RECEIVABLE).reduce((s, l) => s + l.amount, 0);
  if (receivable <= 0 || remaining <= 0) return { vat: [] as { account: number; amount: number }[], total: 0, net: Math.max(remaining, 0) };
  const share = Math.min(1, remaining / receivable);
  const vat = invoiceLines.filter((l) => isOutputVat(l.account) && l.amount < 0).map((l) => ({ account: l.account, amount: Math.round(-l.amount * share) })).filter((v) => v.amount);
  const total = vat.reduce((s, v) => s + v.amount, 0);
  return { vat, total, net: remaining - total };
}

/** Konstaterad kundförlust: fordran skrivs bort och momsen sätts ned */
export function confirmedLossLines(invoiceLines: { account: number; amount: number }[], remaining: number): SignedLine[] {
  const s = vatShare(invoiceLines, remaining);
  return [{ account: CONFIRMED_LOSS, amount: s.net }, ...s.vat.map((v) => ({ account: v.account, amount: v.amount })), { account: RECEIVABLE, amount: -remaining }].filter((l) => l.amount);
}

/** Återvunnen kundförlust: inbetalningen minskar förlusten och momsen redovisas igen */
export function recoveryLines(invoiceLines: { account: number; amount: number }[], amount: number, bank: number): SignedLine[] {
  const s = vatShare(invoiceLines, amount);
  return [{ account: bank, amount }, { account: CONFIRMED_LOSS, amount: -s.net }, ...s.vat.map((v) => ({ account: v.account, amount: -v.amount }))].filter((l) => l.amount);
}

export interface ReserveCandidate { id: number; number: number | null; customer: string; due: string; remaining: number; net: number; collection: boolean; disputed?: boolean; assessed?: { pct: number; note: string } | null }
/** Befarade kundförluster: förfallna mer än 90 dagar eller hos inkasso. Reserven räknas exklusive moms (momsen sätts ned först när förlusten är konstaterad). */
export function reserveProposal(candidates: ReserveCandidate[], end: string, currentReserve: number) {
  const limit = new Date(Date.parse(end) - OVERDUE_DAYS * 864e5).toISOString().slice(0, 10);
  // Individuell bedömning går före schablonen (förfallen mer än 90 dagar eller hos inkasso = 100 %)
  const rows = candidates.map((c) => {
    const pct = c.assessed ? c.assessed.pct : c.collection || c.due < limit ? 100 : 0;
    return { ...c, pct, reserve: Math.round((c.net * pct) / 100) };
  });
  const doubtful = rows.filter((r) => r.pct > 0);
  const others = rows.filter((r) => r.pct === 0 && (r.due < end || r.disputed));
  const target = doubtful.reduce((s, c) => s + c.reserve, 0);
  const change = target - currentReserve;
  const lines: SignedLine[] = change ? [{ account: DOUBTFUL_LOSS, amount: change }, { account: DOUBTFUL_RESERVE, amount: -change }] : [];
  return { doubtful, others, target, current: currentReserve, change, lines, limit };
}
