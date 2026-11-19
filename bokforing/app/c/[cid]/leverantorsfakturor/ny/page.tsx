import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { SupplierInvoiceForm } from '@/components/SupplierInvoiceForm';
import { registerSupplierInvoice } from '../actions';
import { today } from '@/lib/format';
import { listCostCenters, listProjectRefs } from '@/lib/services/dimensions';
import { learnedCodings } from '@/lib/services/coding-memory';
import { companyPeriod, supplierHistories } from '@/lib/services/period';
import type { SupplierCoding } from '@/lib/coding-memory';

export const dynamic = 'force-dynamic';

export default async function NewSupplierInvoice({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'purchasing' });
  const suppliers = await sql<{ id: number; name: string; default_account: number }[]>`SELECT id, name, default_account FROM suppliers WHERE company_id = ${company.id} ORDER BY name`;
  const accounts = await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${company.id} AND active AND number BETWEEN 1000 AND 8999 ORDER BY number`;
  return (
    <>
      <h1>Registrera leverantörsfaktura</h1>
      <Flash searchParams={searchParams} />
      {suppliers.length === 0 ? <p>Lägg först upp en <Link href={`/c/${company.id}/leverantorer`}>leverantör</Link>.</p> :
        <SupplierInvoiceForm action={registerSupplierInvoice.bind(null, company.id)} suppliers={[...suppliers]} accounts={[...accounts]} today={today()}
          costCenters={await listCostCenters(company.id, true)} projects={await listProjectRefs(company.id, true)} learned={await learnedCodings<SupplierCoding>(company.id, 'supplier')} initialSupplier={Number((await searchParams).leverantor) || undefined}
          period={await companyPeriod(company.id)} histories={await supplierHistories(company.id)} />}
    </>
  );
}
