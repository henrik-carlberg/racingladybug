import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { today } from '@/lib/format';
import { pain001Xml, paymentError, type Pain001Payment } from '@/lib/pain001';

export const dynamic = 'force-dynamic';

/** Betalfil (ISO 20022 pain.001) för attesterade leverantörsfakturor – laddas upp i internetbanken */
export async function GET(_req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const rows = await sql<{ id: number; supplier: string; bankgiro: string; plusgiro: string; bank_account: string; invoice_number: string; due: string; reference: string; total: number }[]>`
    SELECT i.id, s.name AS supplier, s.bankgiro, s.plusgiro, s.bank_account, i.invoice_number, to_char(i.due_date,'YYYY-MM-DD') AS due, i.payment_reference AS reference, i.total::bigint AS total
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.company_id = ${company.id} AND i.status = 'approved' ORDER BY i.due_date`;
  const t = today();
  const payments: Pain001Payment[] = rows.map((r) => ({
    id: `LF${r.id}`, name: r.supplier, bankgiro: r.bankgiro || undefined, plusgiro: r.plusgiro || undefined, bankAccount: r.bank_account || undefined,
    reference: r.reference, amount: Number(r.total), date: r.due < t ? t : r.due, invoiceNumber: r.invoice_number,
  }));
  const errors = [
    ...(!company.iban && !company.bankgiro ? ['Ange bolagets IBAN eller bankgiro under Inställningar'] : []),
    ...payments.map(paymentError).filter((e): e is string => !!e),
  ];
  if (!payments.length) errors.push('Det finns inga attesterade fakturor att betala');
  if (errors.length) return new Response(errors.join('\n'), { status: 422, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const [bic] = await sql<{ bic: string }[]>`SELECT bic FROM companies WHERE id = ${company.id}`;
  const xml = pain001Xml({
    messageId: `BF${Date.now()}${randomBytes(2).toString('hex')}`.slice(0, 35), created: new Date().toISOString().slice(0, 19),
    debtor: { name: company.name, orgnr: company.orgnr, iban: company.iban || undefined, bankgiro: company.bankgiro || undefined, bic: bic.bic || undefined }, payments,
  });
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="betalningar-${t}.xml"` } });
}
