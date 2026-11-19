// Inlärd kontering (rena funktioner)

export interface SupplierCoding { account: number; vatRate: number | null; costCenterId: number | null; projectId: number | null }
export interface ReceiptCoding { category: string; vatRate: number; paidWith: 'company' | 'private' }

/** Antal gånger i rad med samma kontering innan den föreslås */
export const LEARN_AFTER = 2;

/** Momssats från belopp inkl. moms och moms (öre); null om den inte är 25, 12, 6 eller 0 % */
export function vatRateOf(total: number, vat: number): number | null {
  const net = total - vat;
  if (net <= 0) return null;
  if (vat === 0) return 0;
  for (const r of [25, 12, 6]) if (Math.abs(Math.round((net * r) / 100) - vat) <= 1) return r;
  return null;
}

/** Nyckel för kvitton: butiken/beskrivningen före eventuellt kolon, gemener utan skiljetecken */
export function receiptKey(description: string): string {
  return description.split(':')[0].toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** Samma kontering? (nycklarnas ordning spelar ingen roll) */
export function sameCoding(a: object, b: object): boolean {
  const norm = (o: object) => JSON.stringify(Object.entries(o).filter(([, v]) => v !== undefined).sort(([x], [y]) => x.localeCompare(y)));
  return norm(a) === norm(b);
}

/** Belopp exkl. moms och moms från totalbelopp och momssats (öre) */
export function splitVat(total: number, rate: number): { net: number; vat: number } {
  const vat = Math.round((total * rate) / (100 + rate));
  return { net: total - vat, vat };
}
