import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { CustomerFields, type CustomerRow } from '@/components/CustomerFields';
import { kr } from '@/lib/format';
import { saveCustomer } from './actions';

export const dynamic = 'force-dynamic';

export default async function Customers({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const rows = await sql<(CustomerRow & { open: number })[]>`
    SELECT c.*, COALESCE((SELECT SUM(total) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'booked'), 0)::bigint AS open
    FROM customers c WHERE c.company_id = ${company.id} ORDER BY c.name`;
  return (
    <>
      <h1>Kunder</h1>
      <Flash searchParams={searchParams} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Namn</th><th>Org.nr</th><th>E-post</th><th className="num">Obetalt</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}><td><Link href={`/c/${company.id}/kunder/${c.id}`}>{c.name}</Link></td><td>{c.orgnr}</td><td>{c.email}</td><td className="num">{c.open ? kr(c.open) : ''}</td></tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="muted">Inga kunder ännu.</td></tr>}
          </tbody>
        </table>
      </div>
      <h2>Ny kund</h2>
      <form action={saveCustomer.bind(null, company.id, null)} className="card stack">
        <CustomerFields />
        <div><button>Spara kund</button></div>
      </form>
    </>
  );
}
