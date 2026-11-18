import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { createRun } from './actions';

export const dynamic = 'force-dynamic';

export default async function Payroll({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const runs = await sql<{ id: number; period: string; payment_date: string; status: string; n: number; gross: number; tax: number; fee: number; net: number }[]>`
    SELECT r.id, r.period, to_char(r.payment_date,'YYYY-MM-DD') AS payment_date, r.status, count(p.id)::int AS n,
      COALESCE(SUM(p.gross_cash),0)::bigint AS gross, COALESCE(SUM(p.tax),0)::bigint AS tax,
      COALESCE(SUM(p.employer_fee),0)::bigint AS fee, COALESCE(SUM(p.net_pay),0)::bigint AS net
    FROM payroll_runs r LEFT JOIN payslips p ON p.run_id = r.id WHERE r.company_id = ${company.id}
    GROUP BY r.id ORDER BY r.period DESC`;
  const t = today();
  const b = `/c/${company.id}`;
  return (
    <>
      <h1>Lönekörningar</h1>
      <Flash searchParams={searchParams} />
      <form action={createRun.bind(null, company.id)} className="card row">
        <label>Period (utbetalningsmånad)<input name="period" defaultValue={t.slice(0, 7)} pattern="\d{4}-\d{2}" required /></label>
        <label>Utbetalningsdag<input type="date" name="payment_date" defaultValue={`${t.slice(0, 7)}-25`} required /></label>
        <div style={{ flex: '0 0 auto' }}><button>Ny lönekörning</button></div>
      </form>
      <p className="small muted">Alla aktiva anställda läggs till med sin månadslön. Komplettera med tillägg, avdrag, förmåner och utlägg innan du bokför. Glöm inte att <Link href={`${b}/lon/skattetabeller`}>hämta årets skattetabeller</Link>.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Period</th><th>Utbetalning</th><th className="num">Anst.</th><th className="num">Bruttolön</th><th className="num">Skatt</th><th className="num">Arb.giv.avg.</th><th className="num">Netto</th><th>Status</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td><Link href={`${b}/lon/${r.id}`}>{r.period}</Link></td><td>{r.payment_date}</td><td className="num">{r.n}</td>
                <td className="num">{kr(r.gross)}</td><td className="num">{kr(r.tax)}</td><td className="num">{kr(r.fee)}</td><td className="num">{kr(r.net)}</td>
                <td>{r.status === 'booked' ? <span className="badge ok">Bokförd</span> : <span className="badge">Utkast</span>}</td>
              </tr>
            ))}
            {runs.length === 0 && <tr><td colSpan={8} className="muted">Inga lönekörningar ännu.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
