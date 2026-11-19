import 'server-only';
import { sql, type Tx } from '@/lib/db';
import type { InvoiceLineInput } from '@/lib/invoice';

export async function loadLines(db: Tx | typeof sql, invoiceId: number): Promise<InvoiceLineInput[]> {
  const rows = await db<{ description: string; quantity: string; unit: string; unit_price: number; vat_rate: number; account_number: number; labor: boolean; oss_rate: string | null }[]>`
    SELECT description, quantity, unit, unit_price, vat_rate, account_number, labor, oss_rate FROM invoice_lines WHERE invoice_id = ${invoiceId} ORDER BY position`;
  return rows.map((r) => ({
    description: r.description, quantity: Number(r.quantity), unit: r.unit, unitPrice: r.unit_price,
    vatRate: r.vat_rate as InvoiceLineInput['vatRate'], account: r.account_number, labor: r.labor, ...(r.oss_rate != null ? { ossRate: Number(r.oss_rate) } : {}),
  }));
}
