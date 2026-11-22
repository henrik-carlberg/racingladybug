// Ackord vid företagsrekonstruktion: nedsättning av bolagets skulder (ren logik). Belopp i öre.
/** Ackordsvinsten bokas på ett eget konto: den är inte skattepliktig men minskar tidigare års underskott */
export const SETTLEMENT_ACCOUNT = 3996;
export const SUPPLIER_DEBTS = 2440;

/** Nedsättning per faktura: ackordet anger hur stor del av fordringarna som ska betalas (dividend i procent) */
export function writedowns(invoices: { id: number; remaining: number }[], dividendPct: number) {
  const rows = invoices.map((i) => { const pay = Math.round((i.remaining * dividendPct) / 100); return { id: i.id, remaining: i.remaining, pay, writedown: i.remaining - pay }; });
  const total = rows.reduce((s, r) => s + r.writedown, 0);
  return { rows, total, toPay: rows.reduce((s, r) => s + r.pay, 0), lines: total ? [{ account: SUPPLIER_DEBTS, amount: total }, { account: SETTLEMENT_ACCOUNT, amount: -total }] : [] };
}
