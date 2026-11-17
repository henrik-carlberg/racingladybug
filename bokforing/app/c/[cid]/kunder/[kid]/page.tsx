import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { CustomerFields, type CustomerRow } from '@/components/CustomerFields';
import { saveCustomer } from '../actions';

export const dynamic = 'force-dynamic';

export default async function Customer({ params, searchParams }: { params: Promise<{ cid: string; kid: string }>; searchParams: SP }) {
  const { cid, kid } = await params;
  const { company } = await requireCompany(cid);
  const [c] = await sql<CustomerRow[]>`SELECT * FROM customers WHERE id = ${Number(kid)} AND company_id = ${company.id}`;
  if (!c) notFound();
  return (
    <>
      <h1>{c.name}</h1>
      <Flash searchParams={searchParams} />
      <form action={saveCustomer.bind(null, company.id, c.id)} className="card stack">
        <CustomerFields c={c} />
        <div><button>Spara</button></div>
      </form>
    </>
  );
}
