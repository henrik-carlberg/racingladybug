import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { type SP } from '@/components/ui';
import { PrintButton } from '@/components/PrintButton';
import { kr, today } from '@/lib/format';
import { addMonths, periodOf } from '@/lib/assets';
import { formatPnr } from '@/lib/rotrut';
import { KIND_LABEL, type AbsenceKind } from '@/lib/absence';

export const dynamic = 'force-dynamic';

const FORMS: Record<string, string> = { tillsvidare: 'Tillsvidareanställning', provanstallning: 'Provanställning', visstid: 'Visstidsanställning', timanstalld: 'Timanställning (vid behov)' };

/** Underlag för arbetsgivarintyg: anställning och lön per månad de senaste 13 månaderna */
export default async function Certificate({ params, searchParams }: { params: Promise<{ cid: string; eid: string }>; searchParams: SP }) {
  const { cid, eid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const sp = await searchParams;
  const [e] = await sql<{ id: number; name: string; pnr: string; start: string | null; end: string | null; form: string; title: string; hours: number; monthly: number }[]>`
    SELECT id, first_name || ' ' || last_name AS name, personal_number AS pnr, to_char(employment_start,'YYYY-MM-DD') AS start, to_char(employment_end,'YYYY-MM-DD') AS "end",
      employment_form AS form, title, hours_per_week::float8 AS hours, monthly_salary::bigint AS monthly FROM employees WHERE id = ${Number(eid)} AND company_id = ${company.id}`;
  if (!e) notFound();
  const last = e.end ? periodOf(e.end) : addMonths(periodOf(today()), -1);
  const first = addMonths(last, -12);
  const pay = new Map((await sql<{ period: string; gross: number; benefits: number }[]>`
    SELECT r.period, SUM(p.gross_cash)::bigint AS gross, SUM(p.benefits)::bigint AS benefits FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
    WHERE p.employee_id = ${e.id} AND r.status = 'booked' AND r.period BETWEEN ${first} AND ${last} GROUP BY r.period`).map((x) => [x.period, x]));
  const abs = await sql<{ kind: AbsenceKind; from: string; to: string; extent: number }[]>`
    SELECT kind, to_char(from_date,'YYYY-MM-DD') AS "from", to_char(to_date,'YYYY-MM-DD') AS "to", extent FROM absences
    WHERE employee_id = ${e.id} AND status = 'approved' AND to_date >= ${first + '-01'} ORDER BY from_date`;
  const months = Array.from({ length: 13 }, (_, i) => addMonths(first, i));
  const reason = String(sp.orsak ?? '');
  return (
    <div className="doc" style={{ maxWidth: 820 }}>
      <div className="header no-print"><span /><PrintButton /></div>
      <h1>Underlag för arbetsgivarintyg</h1>
      <p className="small muted no-print">Arbetsgivarintyget lämnas till arbetslöshetskassan, oftast digitalt via Arbetsgivarintyg.nu. Använd uppgifterna nedan och fyll i arbetad tid per månad där. <a href="?orsak=">Ange orsak</a> med <code>?orsak=…</code> i adressen.</p>
      <table className="small"><tbody>
        <tr><td>Arbetsgivare</td><td><b>{company.name}</b>, org.nr {company.orgnr}</td></tr>
        <tr><td>Arbetstagare</td><td><b>{e.name}</b>, {formatPnr(e.pnr)}</td></tr>
        <tr><td>Befattning</td><td>{e.title || '–'}</td></tr>
        <tr><td>Anställningsform</td><td>{FORMS[e.form] ?? e.form}</td></tr>
        <tr><td>Anställd</td><td>{e.start ?? '?'} – {e.end ?? 'pågår'}</td></tr>
        <tr><td>Arbetstid</td><td>{String(e.hours).replace('.', ',')} timmar per vecka ({Math.round((e.hours / 40) * 100)} % av heltid)</td></tr>
        <tr><td>Lön</td><td>{e.monthly ? `${kr(e.monthly)} kr per månad` : 'Timlön'}</td></tr>
        {reason && <tr><td>Orsak till att anställningen upphörde</td><td>{reason}</td></tr>}
      </tbody></table>
      <h2>Lön per månad</h2>
      <table>
        <thead><tr><th>Månad</th><th className="num">Kontant bruttolön</th><th className="num">Förmåner</th></tr></thead>
        <tbody>
          {months.map((m) => { const x = pay.get(m); return <tr key={m}><td>{m}</td><td className="num">{x ? kr(x.gross) : '–'}</td><td className="num">{x && Number(x.benefits) ? kr(x.benefits) : ''}</td></tr>; })}
        </tbody>
      </table>
      {abs.length > 0 && (
        <>
          <h2>Frånvaro</h2>
          <table><tbody>{abs.map((a, i) => <tr key={i}><td>{KIND_LABEL[a.kind]}</td><td>{a.from} – {a.to}</td><td className="num">{a.extent} %</td></tr>)}</tbody></table>
        </>
      )}
      <p className="small" style={{ marginTop: '2rem' }}>Utfärdat {today()} av {company.name}. Underskrift: ____________________________</p>
    </div>
  );
}
