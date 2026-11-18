import Link from 'next/link';
import { Pager, pageOf, pageSql, PAGE_SIZE } from '@/components/Pager';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, Header, Status, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Invoices({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const sp = await searchParams;
  const status = String(sp.status ?? '');
  const page = pageOf(sp);
  const all = await sql<{ id: number; invoice_number: number | null; invoice_date: string; due_date: string; customer: string; total: number; status: string }[]>`
    SELECT i.id, i.invoice_number, to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date, to_char(i.due_date,'YYYY-MM-DD') AS due_date,
      c.name AS customer, i.total, i.status
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.company_id = ${company.id}
    ${status ? sql`AND i.status = ${status}` : sql``}
    ORDER BY i.status = 'draft' DESC, i.invoice_number DESC NULLS FIRST, i.id DESC LIMIT ${pageSql(page).limit} OFFSET ${pageSql(page).offset}`;
  const hasMore = all.length > PAGE_SIZE;
  const rows = all.slice(0, PAGE_SIZE);
  const t = today();
  const b = `/c/${company.id}`;
  return (
    <>
      <Header title="Kundfakturor"><Link className="btn" href={`${b}/fakturor/ny`}>Ny faktura</Link></Header>
      <Flash searchParams={searchParams} />
      <div className="actions">
        {[['', 'Alla'], ['draft', 'Utkast'], ['booked', 'Obetalda'], ['paid', 'Betalda'], ['credited', 'Krediterade']].map(([s, l]) => (
          <Link key={s} href={`${b}/fakturor${s ? `?status=${s}` : ''}`} className={`btn ${status === s ? '' : 'secondary'}`}>{l}</Link>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nr</th><th>Kund</th><th>Datum</th><th>Förfaller</th><th className="num">Belopp</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td><Link href={`${b}/fakturor/${i.id}`}>{i.invoice_number ?? 'Utkast'}</Link></td>
                <td>{i.customer}</td><td>{i.invoice_date}</td><td>{i.due_date}</td>
                <td className="num">{kr(i.total)}</td><td><Status s={i.status} overdue={i.due_date < t} /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">Inga fakturor.</td></tr>}
          </tbody>
        </table>
        <Pager base={`${b}/fakturor`} sp={sp} page={page} hasMore={hasMore} count={rows.length} />
      </div>
    </>
  );
}
