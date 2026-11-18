import Link from 'next/link';
import { Pager, pageOf, pageSql, PAGE_SIZE } from '@/components/Pager';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { CustomerFields, type CustomerRow } from '@/components/CustomerFields';
import { kr } from '@/lib/format';
import { saveCustomer } from './actions';

export const dynamic = 'force-dynamic';

export default async function Customers({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const sp = await searchParams;
  const page = pageOf(sp);
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const all = await sql<(CustomerRow & { open: number })[]>`
    SELECT c.*, COALESCE((SELECT SUM(total) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'booked'), 0)::bigint AS open
    FROM customers c WHERE c.company_id = ${company.id} ${q ? sql`AND (c.name ILIKE ${'%' + q + '%'} OR c.orgnr ILIKE ${'%' + q + '%'} OR c.email ILIKE ${'%' + q + '%'})` : sql``}
    ORDER BY c.name LIMIT ${pageSql(page).limit} OFFSET ${pageSql(page).offset}`;
  const hasMore = all.length > PAGE_SIZE;
  const rows = all.slice(0, PAGE_SIZE);
  return (
    <>
      <h1>Kunder</h1>
      <form className="row" style={{ alignItems: 'end', maxWidth: 520 }}><label>Sök kund<input name="q" defaultValue={q} placeholder="Namn, org.nr eller e-post" /></label><div style={{ flex: '0 0 auto' }}><button className="secondary">Sök</button></div></form>
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
        <Pager base={`/c/${company.id}/kunder`} sp={sp} page={page} hasMore={hasMore} count={rows.length} />
      </div>
      <h2>Ny kund</h2>
      <form action={saveCustomer.bind(null, company.id, null)} className="card stack">
        <CustomerFields />
        <div><button>Spara kund</button></div>
      </form>
    </>
  );
}
