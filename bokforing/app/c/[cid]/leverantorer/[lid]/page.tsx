import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { SupplierFields, type SupplierRow } from '@/components/SupplierFields';
import { saveSupplier } from '../actions';

export const dynamic = 'force-dynamic';

export default async function Supplier({ params, searchParams }: { params: Promise<{ cid: string; lid: string }>; searchParams: SP }) {
  const { cid, lid } = await params;
  const { company } = await requireCompany(cid);
  const [s] = await sql<SupplierRow[]>`SELECT * FROM suppliers WHERE id = ${Number(lid)} AND company_id = ${company.id}`;
  if (!s) notFound();
  return (
    <>
      <h1>{s.name}</h1>
      <Flash searchParams={searchParams} />
      <form action={saveSupplier.bind(null, company.id, s.id)} className="card stack">
        <SupplierFields s={s} />
        <div><button>Spara</button></div>
      </form>
    </>
  );
}
