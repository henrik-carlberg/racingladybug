// Service- och garantiärenden. Belopp i öre exkl. moms.
export const CAUSES: Record<string, string> = { material: 'Materialfel', manufacturing: 'Tillverkningsfel', wear: 'Slitage', handling: 'Felaktig hantering', other: 'Annat' };

const addMonths = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
/** Garantin gäller från fakturadatum i det antal månader som avtalats */
export function warrantyUntil(soldOn: string | null, months: number) { return soldOn ? addMonths(soldOn, months) : null; }
export const inWarranty = (soldOn: string | null, months: number, at: string) => { const u = warrantyUntil(soldOn, months); return !!u && at <= u; };

export const lineTotal = (l: { quantity: number; unit_price: number }) => Math.round(l.quantity * l.unit_price);

/** Garantikostnaden tas i anspråk ur avsättningen, men aldrig mer än det som finns kvar */
export const fromProvision = (cost: number, balance: number) => Math.max(0, Math.min(cost, balance));
export const provisionUseLines = (amount: number, provisionAccount: number, costAccount: number) => (amount ? [{ account: provisionAccount, amount }, { account: costAccount, amount: -amount }] : []);

/** Förslag till garantiavsättning: årets garantikostnad i procent av försäljningen */
export const warrantyRate = (costs: number, sales: number) => (sales > 0 ? Math.round(costs / sales * 10000) / 100 : null);
