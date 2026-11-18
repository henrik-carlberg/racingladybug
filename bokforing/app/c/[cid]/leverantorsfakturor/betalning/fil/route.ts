import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { toDecimalString } from '@/lib/money';

export async function GET(_req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payments' });
  const rows = await sql<{ supplier: string; bankgiro: string; plusgiro: string; bank_account: string; invoice_number: string; due_date: string; reference: string; total: number }[]>`
    SELECT s.name AS supplier, s.bankgiro, s.plusgiro, s.bank_account, i.invoice_number, to_char(i.due_date,'YYYY-MM-DD') AS due_date,
      i.payment_reference AS reference, i.total
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.company_id = ${company.id} AND i.status = 'approved' ORDER BY i.due_date`;
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const csv = ['Förfallodatum;Leverantör;Bankgiro;Plusgiro;Bankkonto;OCR/meddelande;Belopp;Fakturanr',
    ...rows.map((r) => [r.due_date, q(r.supplier), r.bankgiro, r.plusgiro, r.bank_account, q(r.reference), toDecimalString(r.total).replace('.', ','), q(r.invoice_number)].join(';'))].join('\r\n');
  return new Response('﻿' + csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="betalningsforslag.csv"' },
  });
}
