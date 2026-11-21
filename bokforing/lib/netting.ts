// Kvittning av kund- och leverantörsfakturor mot samma motpart (ren logik). Belopp i öre.
export interface Open { id: number; remaining: number; due: string }

/** Parar ihop öppna fordringar och skulder, äldst först, upp till det mindre av de två beloppen */
export function pairs(receivables: Open[], payables: Open[]) {
  const r = [...receivables].sort((a, b) => a.due.localeCompare(b.due)).map((x) => ({ ...x }));
  const p = [...payables].sort((a, b) => a.due.localeCompare(b.due)).map((x) => ({ ...x }));
  const out: { invoiceId: number; supplierInvoiceId: number; amount: number }[] = [];
  let i = 0, j = 0;
  while (i < r.length && j < p.length) {
    const a = Math.min(r[i].remaining, p[j].remaining);
    if (a > 0) out.push({ invoiceId: r[i].id, supplierInvoiceId: p[j].id, amount: a });
    r[i].remaining -= a; p[j].remaining -= a;
    if (!r[i].remaining) i++;
    if (!p[j].remaining) j++;
  }
  return { pairs: out, total: out.reduce((s, x) => s + x.amount, 0) };
}

/** Kvittningen: leverantörsskulden minskar mot kundfordran */
export const offsetLines = (amount: number) => [{ account: 2440, amount }, { account: 1510, amount: -amount }];
