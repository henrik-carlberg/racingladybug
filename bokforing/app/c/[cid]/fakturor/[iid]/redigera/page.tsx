import { notFound, redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { InvoiceForm } from '@/components/InvoiceForm';
import { saveDraft } from '../../actions';
import { loadLines } from '@/lib/server/invoices';

export const dynamic = 'force-dynamic';

export default async function EditInvoice({ params }: { params: Promise<{ cid: string; iid: string }> }) {
  const { cid, iid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const [inv] = await sql<{ id: number; status: string; customer_id: number; invoice_date: string; due_date: string; delivery_date: string; our_reference: string; your_reference: string; notes: string; advance: boolean; currency: string; exchange_rate: number; language: string }[]>`
    SELECT id, status, customer_id, to_char(invoice_date,'YYYY-MM-DD') AS invoice_date, to_char(due_date,'YYYY-MM-DD') AS due_date,
      delivery_date, our_reference, your_reference, notes, advance, currency, exchange_rate::float8 AS exchange_rate, language, reduction_type, buyer_pnr, property, brf_orgnr, apartment_no, work_type, reduction_max::int AS reduction_max FROM invoices WHERE id = ${Number(iid)} AND company_id = ${company.id}`;
  if (!inv) notFound();
  if (inv.status !== 'draft') redirect(`/c/${company.id}/fakturor/${inv.id}`);
  const customers = await sql<{ id: number; name: string; reverse_charge: boolean; currency: string; language: string }[]>`SELECT id, name, reverse_charge, currency, language FROM customers WHERE company_id = ${company.id} ORDER BY name`;
  const accounts = await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${company.id} AND active ORDER BY number`;
  const lines = (await loadLines(sql, inv.id)).map((l) => ({
    description: l.description, quantity: String(l.quantity).replace('.', ','), unit: l.unit,
    price: (l.unitPrice / 100).toFixed(2).replace('.', ','), vat: String(l.vatRate), account: String(l.account), labor: !!l.labor,
  }));
  return (
    <>
      <h1>Redigera utkast</h1>
      <InvoiceForm action={saveDraft.bind(null, company.id, inv.id)} customers={[...customers]} accounts={[...accounts]}
        initial={{ ...inv, lines }} />
    </>
  );
}
