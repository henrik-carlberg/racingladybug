import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { SupplierFields, type SupplierRow } from '@/components/SupplierFields';
import { listCostCenters } from '@/lib/services/dimensions';
import { kr } from '@/lib/format';
import { saveSupplier } from './actions';

export const dynamic = 'force-dynamic';

export default async function Suppliers({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const rows = await sql<(SupplierRow & { open: number })[]>`
    SELECT s.*, COALESCE((SELECT SUM(total) FROM supplier_invoices i WHERE i.supplier_id = s.id AND i.status <> 'paid'), 0)::bigint AS open
    FROM suppliers s WHERE s.company_id = ${company.id} ORDER BY s.name`;
  return (
    <>
      <h1>Leverantörer</h1>
      <Flash searchParams={searchParams} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Namn</th><th>Bankgiro/Plusgiro</th><th>Konto</th><th className="num">Obetalt</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}><td><Link href={`/c/${company.id}/leverantorer/${s.id}`}>{s.name}</Link></td>
                <td>{s.bankgiro ? `BG ${s.bankgiro}` : s.plusgiro ? `PG ${s.plusgiro}` : s.bank_account}</td>
                <td>{s.default_account}</td><td className="num">{s.open ? kr(s.open) : ''}</td></tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="muted">Inga leverantörer ännu.</td></tr>}
          </tbody>
        </table>
      </div>
      <h2>Ny leverantör</h2>
      <form action={saveSupplier.bind(null, company.id, null)} className="card stack">
        <SupplierFields costCenters={await listCostCenters(company.id, true)} />
        <div><button>Spara leverantör</button></div>
      </form>
    </>
  );
}
