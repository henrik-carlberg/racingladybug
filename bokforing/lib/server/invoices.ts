import 'server-only';
import { sql, type Tx } from '@/lib/db';
import type { InvoiceLineInput } from '@/lib/invoice';

export async function loadLines(db: Tx | typeof sql, invoiceId: number): Promise<InvoiceLineInput[]> {
  const rows = await db<{ description: string; quantity: string; unit: string; unit_price: number; vat_rate: number; account_number: number }[]>`
    SELECT description, quantity, unit, unit_price, vat_rate, account_number FROM invoice_lines WHERE invoice_id = ${invoiceId} ORDER BY position`;
  return rows.map((r) => ({
    description: r.description, quantity: Number(r.quantity), unit: r.unit, unitPrice: r.unit_price,
    vatRate: r.vat_rate as InvoiceLineInput['vatRate'], account: r.account_number,
  }));
}
