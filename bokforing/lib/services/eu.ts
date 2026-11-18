import 'server-only';
import { sql } from '@/lib/db';
import type { EuLine } from '@/lib/eu';

/** Fakturerade rader till utländska kunder i perioden (kronor, efter fakturans kurs). Kreditfakturor ger negativa belopp. */
export async function euLines(companyId: number, from: string, to: string): Promise<EuLine[]> {
  const rows = await sql<{ vat: string; country: string; customer: string; account: number; sek: string; consumer: boolean }[]>`
    SELECT c.vat_number AS vat, c.country, c.name AS customer, l.account_number AS account,
      round(l.quantity * l.unit_price * i.exchange_rate)::bigint AS sek, (c.vat_number = '' AND NOT i.reverse_charge) AS consumer
    FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN customers c ON c.id = i.customer_id
    WHERE i.company_id = ${companyId} AND i.status <> 'draft' AND NOT i.imported AND i.invoice_date BETWEEN ${from} AND ${to} AND c.country <> 'SE'`;
  return rows.map((r) => ({ vatNumber: r.vat, country: r.country, customer: r.customer, account: r.account, amountSek: Number(r.sek), consumer: r.consumer }));
}
