// Punktskatter (t.ex. energiskatt, kemikalieskatt, skatt på nikotinprodukter). Belopp i öre.
export const LIABILITY = 2660; // Särskilda punktskatter
export const TAX_ACCOUNT = 1630; // Skattekonto

/** Skattesats i kronor per enhet ("0,439" eller "1 200") → öre per enhet */
export function parseRate(s: string): number | null {
  const v = Number(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 1e6) / 1e4 : null;
}

export interface TypeBasis { id: number; name: string; unit: string; rate: number; cost_account: number; delivered: number; manual: number }
/** Skatten per skatteslag: underlaget (levererat × faktor + egna uttag) gånger skattesatsen, avrundat till hela kronor (öre) per slag */
export function computeReturn(types: TypeBasis[]) {
  const lines = types.map((t) => {
    const quantity = Math.round((t.delivered + t.manual) * 1000) / 1000;
    return { type_id: t.id, name: t.name, unit: t.unit, rate: t.rate, account: t.cost_account, quantity, tax: Math.max(0, Math.round(quantity * t.rate / 100) * 100) };
  }).filter((l) => l.quantity);
  return { lines, total: lines.reduce((s, l) => s + l.tax, 0) };
}

export function bookingLines(lines: { account: number; tax: number }[]) {
  const by = new Map<number, number>();
  for (const l of lines) if (l.tax) by.set(l.account, (by.get(l.account) ?? 0) + l.tax);
  const total = [...by.values()].reduce((s, v) => s + v, 0);
  return [...[...by].map(([account, amount]) => ({ account, amount })), { account: LIABILITY, amount: -total }];
}
export const paymentLines = (total: number) => [{ account: LIABILITY, amount: total }, { account: TAX_ACCOUNT, amount: -total }];

/** Deklarationen för en månad ska normalt vara inne och betald den 26:e månaden efter */
export function dueDate(period: string) {
  const [y, m] = period.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-26`;
}
