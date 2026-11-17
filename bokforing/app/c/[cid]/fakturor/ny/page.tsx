import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { InvoiceForm } from '@/components/InvoiceForm';
import { saveDraft } from '../actions';
import { today } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function NewInvoice({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const customers = await sql<{ id: number; name: string; reverse_charge: boolean }[]>`SELECT id, name, reverse_charge FROM customers WHERE company_id = ${company.id} ORDER BY name`;
  const accounts = await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${company.id} AND active ORDER BY number`;
  if (customers.length === 0) return <><h1>Ny kundfaktura</h1><p>Lägg först upp en <Link href={`/c/${company.id}/kunder`}>kund</Link>.</p></>;
  return (
    <>
      <h1>Ny kundfaktura</h1>
      <InvoiceForm action={saveDraft.bind(null, company.id, null)} customers={[...customers]} accounts={[...accounts]} initial={{ invoice_date: today() }} />
    </>
  );
}
