import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { AbsenceForm } from '@/components/AbsenceForm';
import { today } from '@/lib/format';
import { listAbsences, vacationBalances } from '@/lib/services/absence';
import { decide, remove } from './actions';

export const dynamic = 'force-dynamic';
const STATUS: Record<string, [string, string]> = { requested: ['Ansökan', 'warn'], approved: ['Godkänd', 'ok'], rejected: ['Avslagen', ''] };

export default async function Absence({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const sp = await searchParams;
  const year = Number(sp.ar) || Number(today().slice(0, 4));
  const [list, pending, balances, emps] = await Promise.all([
    listAbsences(company.id, { year }), listAbsences(company.id, { status: 'requested' }), vacationBalances(company.id, year),
    sql<{ id: number; name: string }[]>`SELECT id, first_name || ' ' || last_name AS name FROM employees WHERE company_id = ${company.id} AND active ORDER BY last_name`,
  ]);
  const b = `/c/${company.id}`;
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Frånvaro och semester</h1>
      <Flash searchParams={searchParams} />
      {pending.length > 0 && (
        <div className="card">
          <b>{pending.length} ansökningar väntar</b>
          <table className="small"><tbody>{pending.map((a) => (
            <tr key={a.id}><td>{a.employee}</td><td>{a.kind_label}</td><td>{a.from} – {a.to}{a.extent < 100 ? ` (${a.extent} %)` : ''}</td><td>{a.note}</td>
              <td className="num" style={{ whiteSpace: 'nowrap' }}><form action={decide.bind(null, company.id, a.id, true)} style={{ display: 'inline' }}><button className="link">Godkänn</button></form>
                <form action={decide.bind(null, company.id, a.id, false)} style={{ display: 'inline', marginLeft: '.6rem' }}><button className="link">Avslå</button></form></td></tr>
          ))}</tbody></table>
        </div>
      )}
      <h2>Semestersaldo {year}</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Anställd</th><th className="num">Rätt till</th><th className="num">Uttaget/planerat</th><th className="num">varav planerat</th><th className="num">Kvar</th></tr></thead>
        <tbody>{balances.map((e) => <tr key={e.id}><td>{e.name}</td><td className="num">{e.vacation_days}</td><td className="num">{e.taken}</td><td className="num">{e.planned}</td>
          <td className="num" style={e.left < 0 ? { color: 'var(--danger)' } : undefined}><b>{e.left}</b></td></tr>)}
          {balances.length === 0 && <tr><td colSpan={5} className="muted">Inga anställda.</td></tr>}</tbody>
      </table></div>
      <h2>Registrera frånvaro</h2>
      {emps.length ? <AbsenceForm companyId={company.id} back={`${b}/lon/franvaro`} employees={emps} /> : <p>Lägg först upp <Link href={`${b}/lon/anstallda`}>anställda</Link>.</p>}
      <h2>Frånvaro {year}</h2>
      <p className="small"><Link href={`${b}/lon/franvaro?ar=${year - 1}`}>← {year - 1}</Link> · <Link href={`${b}/lon/franvaro?ar=${year + 1}`}>{year + 1} →</Link></p>
      <div className="table-wrap"><table>
        <thead><tr><th>Anställd</th><th>Typ</th><th>Period</th><th>Status</th><th>Lön</th><th></th></tr></thead>
        <tbody>{list.map((a) => (
          <tr key={a.id}><td>{a.employee}</td><td>{a.kind_label}</td><td>{a.from} – {a.to}{a.extent < 100 ? ` (${a.extent} %)` : ''}<div className="small muted">{a.note}</div></td>
            <td><span className={`badge ${STATUS[a.status][1]}`}>{STATUS[a.status][0]}</span></td>
            <td className="small">{a.payroll_run_id ? <Link href={`${b}/lon/${a.payroll_run_id}`}>{a.period}</Link> : a.status === 'approved' ? 'Räknas in nästa lön' : ''}</td>
            <td className="num">{!a.payroll_run_id && <form action={remove.bind(null, company.id, a.id, `${b}/lon/franvaro`)}><button className="link">Ta bort</button></form>}</td></tr>
        ))}{list.length === 0 && <tr><td colSpan={6} className="muted">Ingen frånvaro registrerad.</td></tr>}</tbody>
      </table></div>
      <p className="small muted">Frånvaro räknas in i lönekörningen för månaden efter (”Räkna in frånvaro” i lönekörningen): sjukavdrag och sjuklön 80 % dag 1–14 med karensavdrag 20 % av veckosjuklönen,
        semestertillägg 0,43 % per dag (sammalöneregeln) och löneavdrag per timme för VAB, föräldraledighet och tjänstledighet. Kollektivavtal kan ha andra regler.</p>
    </div>
  );
}
