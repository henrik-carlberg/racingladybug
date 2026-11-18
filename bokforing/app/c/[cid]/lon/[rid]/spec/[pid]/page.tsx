import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { kr } from '@/lib/format';
import { PAY_ITEM_LABELS, type PayItem } from '@/lib/payroll';
import { PrintButton } from '@/components/PrintButton';

export const dynamic = 'force-dynamic';

export default async function Spec({ params }: { params: Promise<{ cid: string; rid: string; pid: string }> }) {
  const { cid, rid, pid } = await params;
  const { company: co } = await requireCompany(cid, { perm: 'payroll' });
  const [p] = await sql<{ items: PayItem[]; gross_cash: number; benefits: number; tax: number; net_pay: number; employer_fee: number;
    name: string; personal_number: string; address: string; postal_code: string; city: string; bank: string; period: string; payment_date: string; status: string }[]>`
    SELECT p.items, p.gross_cash, p.benefits, p.tax, p.net_pay, p.employer_fee, e.first_name || ' ' || e.last_name AS name, e.personal_number,
      e.address, e.postal_code, e.city, e.bank_clearing || ' ' || e.bank_account AS bank, r.period, to_char(r.payment_date,'YYYY-MM-DD') AS payment_date, r.status
    FROM payslips p JOIN employees e ON e.id = p.employee_id JOIN payroll_runs r ON r.id = p.run_id
    WHERE p.id = ${Number(pid)} AND r.id = ${Number(rid)} AND r.company_id = ${co.id}`;
  if (!p) notFound();
  const ytd = await sql<{ gross: number; tax: number }[]>`
    SELECT COALESCE(SUM(p2.gross_cash + p2.benefits),0)::bigint AS gross, COALESCE(SUM(p2.tax),0)::bigint AS tax
    FROM payslips p2 JOIN payroll_runs r2 ON r2.id = p2.run_id JOIN payslips p ON p.employee_id = p2.employee_id
    WHERE p.id = ${Number(pid)} AND r2.company_id = ${co.id} AND r2.status = 'booked'
      AND left(r2.period, 4) = ${p.period.slice(0, 4)} AND r2.period <= ${p.period}`;
  return (
    <>
      <div className="actions no-print"><PrintButton />{p.status === 'draft' && <span className="badge">Utkast – inte bokförd</span>}</div>
      <div className="doc">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div><h2 style={{ marginTop: 0 }}>{co.name}</h2><div className="small">Org.nr {co.orgnr}<br />{co.address}, {co.postal_code} {co.city}</div></div>
          <div style={{ textAlign: 'right' }}><h2 style={{ marginTop: 0 }}>Lönespecifikation</h2><div className="small">Period {p.period}<br />Utbetalning {p.payment_date}</div></div>
        </div>
        <p style={{ margin: '1.5rem 0' }}><b>{p.name}</b><br />{p.personal_number.slice(0, 8)}-{p.personal_number.slice(8)}<br />{p.address}<br />{p.postal_code} {p.city}</p>
        <table>
          <thead><tr><th>Lönart</th><th>Beskrivning</th><th className="num">Belopp</th></tr></thead>
          <tbody>
            {p.items.map((it, i) => <tr key={i}><td>{PAY_ITEM_LABELS[it.type]}</td><td>{it.description}</td><td className="num">{kr(it.type === 'net_deduction' ? -it.amount : it.amount)}</td></tr>)}
            <tr><td colSpan={2}>Preliminär skatt</td><td className="num">{kr(-p.tax)}</td></tr>
            <tr className="sum"><td colSpan={2}>Att utbetala</td><td className="num">{kr(p.net_pay)}</td></tr>
          </tbody>
        </table>
        <div className="small" style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: '1rem' }}>
          <div>Skattepliktig bruttolön<br /><b>{kr(p.gross_cash + p.benefits)}</b></div>
          <div>Skatt<br /><b>{kr(p.tax)}</b></div>
          <div>Hittills i år, brutto<br /><b>{kr(ytd[0].gross)}</b></div>
          <div>Hittills i år, skatt<br /><b>{kr(ytd[0].tax)}</b></div>
          <div>Utbetalas till konto<br /><b>{p.bank.trim() || '–'}</b></div>
        </div>
      </div>
    </>
  );
}
