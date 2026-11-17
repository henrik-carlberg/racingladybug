import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { PrintButton } from '@/components/PrintButton';
import { kr } from '@/lib/format';
import type { SP } from '@/components/ui';

export const dynamic = 'force-dynamic';

interface Slip { id: number; period: string; payment_date: string; items: { type: string; description: string; amount: number }[]; gross_cash: number; benefits: number; tax: number; net_deductions: number; reimbursements: number; net_pay: number }

export default async function MyPayslips({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company, employeeId } = await requireCompany(cid, { employee: true });
  const sp = await searchParams;
  const slips = employeeId ? await sql<Slip[]>`SELECT p.id, r.period, to_char(r.payment_date,'YYYY-MM-DD') AS payment_date, p.items, p.gross_cash::bigint AS gross_cash,
      p.benefits::bigint AS benefits, p.tax::bigint AS tax, p.net_deductions::bigint AS net_deductions, p.reimbursements::bigint AS reimbursements, p.net_pay::bigint AS net_pay
    FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.employee_id = ${employeeId} AND r.company_id = ${company.id} AND r.status = 'booked' ORDER BY r.period DESC` : [];
  const [e] = employeeId ? await sql<{ name: string; personal_number: string }[]>`SELECT first_name || ' ' || last_name AS name, personal_number FROM employees WHERE id = ${employeeId}` : [];
  const s = slips.find((x) => x.id === Number(sp.id)) ?? slips[0];
  const b = `/c/${company.id}`;
  return (
    <>
      <div className="no-print">
        <div className="header"><h1>Lönespecifikationer</h1>{s && <PrintButton />}</div>
        {slips.length === 0 && <p className="muted">Inga utbetalda löner ännu.</p>}
        <p className="small">{slips.map((x, i) => <span key={x.id}>{i > 0 && ' · '}{x.id === s?.id ? <b>{x.period}</b> : <Link href={`${b}/mitt/lon?id=${x.id}`}>{x.period}</Link>}</span>)}</p>
      </div>
      {s && e && (
        <div className="doc">
          <h2 style={{ marginTop: 0 }}>Lönespecifikation {s.period}</h2>
          <p className="small">{company.name}<br />{e.name} · {e.personal_number.slice(0, 8)}-XXXX<br />Utbetalning {s.payment_date}</p>
          <table>
            <thead><tr><th>Lönerad</th><th className="num">Belopp</th></tr></thead>
            <tbody>
              {s.items.map((i, n) => <tr key={n}><td>{i.description}</td><td className="num">{kr(i.amount)}</td></tr>)}
              <tr><td>Kontant bruttolön</td><td className="num">{kr(Number(s.gross_cash))}</td></tr>
              {Number(s.benefits) > 0 && <tr><td>Skattepliktiga förmåner</td><td className="num">{kr(Number(s.benefits))}</td></tr>}
              <tr><td>Skatteavdrag</td><td className="num">−{kr(Number(s.tax))}</td></tr>
              {Number(s.net_deductions) > 0 && <tr><td>Nettolöneavdrag</td><td className="num">−{kr(Number(s.net_deductions))}</td></tr>}
              {Number(s.reimbursements) > 0 && <tr><td>Skattefria ersättningar och utlägg</td><td className="num">{kr(Number(s.reimbursements))}</td></tr>}
              <tr className="sum"><td><b>Att få utbetalt</b></td><td className="num"><b>{kr(Number(s.net_pay))}</b></td></tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
