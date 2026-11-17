import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { kr, today } from '@/lib/format';
import { Flash, type SP } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function Dashboard({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const id = company.id;
  const t = today();
  const [bank] = await sql<{ v: number }[]>`
    SELECT COALESCE(SUM(l.debit - l.credit), 0)::bigint AS v FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${id} AND l.account_number BETWEEN 1910 AND 1949`;
  const [ar] = await sql<{ n: number; v: number; overdue: number }[]>`
    SELECT count(*)::int AS n, COALESCE(SUM(total), 0)::bigint AS v,
           COALESCE(SUM(total) FILTER (WHERE due_date < ${t}), 0)::bigint AS overdue
    FROM invoices WHERE company_id = ${id} AND status = 'booked'`;
  const [ap] = await sql<{ n: number; v: number; unapproved: number }[]>`
    SELECT count(*)::int AS n, COALESCE(SUM(total), 0)::bigint AS v, count(*) FILTER (WHERE status = 'booked')::int AS unapproved
    FROM supplier_invoices WHERE company_id = ${id} AND status IN ('booked','approved')`;
  const [res] = await sql<{ v: number }[]>`
    SELECT COALESCE(SUM(l.credit - l.debit), 0)::bigint AS v FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    JOIN fiscal_years f ON f.id = v.fiscal_year_id
    WHERE v.company_id = ${id} AND l.account_number >= 3000 AND l.account_number < 8999 AND ${t}::date BETWEEN f.start_date AND f.end_date`;
  const recent = await sql<{ id: number; series: string; number: number; date: string; description: string }[]>`
    SELECT id, series, number, to_char(date,'YYYY-MM-DD') AS date, description FROM vouchers
    WHERE company_id = ${id} ORDER BY created_at DESC LIMIT 8`;
  const b = `/c/${id}`;
  return (
    <>
      <h1>{company.name}</h1>
      <Flash searchParams={searchParams} />
      <div className="grid">
        <div className="card stat"><div className="label">Bank och kassa</div><div className="value">{kr(bank.v)}</div></div>
        <div className="card stat"><div className="label">Resultat i år</div><div className="value">{kr(res.v)}</div></div>
        <div className="card stat">
          <div className="label"><Link href={`${b}/fakturor`}>Obetalda kundfakturor ({ar.n})</Link></div>
          <div className="value">{kr(ar.v)}</div>
          {ar.overdue > 0 && <div className="small" style={{ color: 'var(--danger)' }}>varav förfallet {kr(ar.overdue)}</div>}
        </div>
        <div className="card stat">
          <div className="label"><Link href={`${b}/leverantorsfakturor`}>Leverantörsskulder ({ap.n})</Link></div>
          <div className="value">{kr(ap.v)}</div>
          {ap.unapproved > 0 && <div className="small muted">{ap.unapproved} väntar på attest</div>}
        </div>
      </div>
      <div className="actions">
        <Link className="btn" href={`${b}/fakturor/ny`}>Ny kundfaktura</Link>
        <Link className="btn secondary" href={`${b}/leverantorsfakturor/ny`}>Registrera leverantörsfaktura</Link>
        <Link className="btn secondary" href={`${b}/verifikationer/ny`}>Ny verifikation</Link>
        <Link className="btn secondary" href={`${b}/lon`}>Lönekörning</Link>
      </div>
      <h2>Senaste verifikationer</h2>
      {recent.length === 0 ? <p className="muted">Inga verifikationer ännu.</p> : (
        <table>
          <tbody>
            {recent.map((v) => (
              <tr key={v.id}><td><Link href={`${b}/verifikationer/${v.id}`}>{v.series}{v.number}</Link></td><td>{v.date}</td><td>{v.description}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
