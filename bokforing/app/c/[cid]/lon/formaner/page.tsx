import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { BENEFITS, type BenefitKind } from '@/lib/benefits';
import { benefitUsage } from '@/lib/services/payroll2';
import { register } from './actions';

export const dynamic = 'force-dynamic';

export default async function Benefits({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const year = Number(today().slice(0, 4));
  const [u, runs] = await Promise.all([benefitUsage(company.id, year),
    sql<{ id: number; period: string }[]>`SELECT id, period FROM payroll_runs WHERE company_id = ${company.id} AND status = 'draft' ORDER BY period DESC`]);
  const kinds = Object.keys(BENEFITS) as BenefitKind[];
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Skattefria förmåner {year}</h1>
      <p className="muted">Friskvårdsbidrag och gåvor till anställda är skattefria upp till Skatteverkets belopp per år. Appen håller koll på taket per anställd och betalar ut med lönen. Kontrollera beloppen på skatteverket.se inför varje år.</p>
      <Flash searchParams={searchParams} />
      <div className="table-wrap"><table className="benefits">
        <thead><tr><th>Anställd</th>{kinds.map((k) => <th key={k} className="num">{BENEFITS[k].label}<div className="small muted">tak {kr(BENEFITS[k].cap)}</div></th>)}</tr></thead>
        <tbody>{u.emps.map((e) => (
          <tr key={e.id} className="benefit-row"><td>{e.name}</td>{kinds.map((k) => { const used = e.used[k] ?? 0; return (
            <td key={k} className="num">{used ? kr(used) : '–'}{used > 0 && <div className="small muted">kvar {kr(Math.max(0, BENEFITS[k].cap - used))}</div>}</td>); })}</tr>
        ))}{u.emps.length === 0 && <tr><td colSpan={5} className="muted">Lägg först upp anställda under <Link href={`/c/${company.id}/lon/anstallda`}>Anställda</Link>.</td></tr>}</tbody>
      </table></div>
      <h2>Betala ut förmån</h2>
      {runs.length === 0 ? <p className="muted">Skapa en lönekörning först – förmånen betalas ut med lönen.</p> : (
        <form action={register.bind(null, company.id)} className="card stack">
          <div className="row">
            <label>Anställd<select name="employee_id">{u.emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
            <label>Förmån<select name="kind">{kinds.map((k) => <option key={k} value={k}>{BENEFITS[k].label}</option>)}</select></label>
            <label>Belopp inkl. moms (kr)<input name="amount" inputMode="decimal" required /></label>
          </div>
          <div className="row">
            <label>Datum på kvittot<input type="date" name="date" defaultValue={today()} /></label>
            <label style={{ flex: '2 1 240px' }}>Vad gäller det?<input name="description" placeholder="T.ex. gymkort, simhall" /></label>
            <label>Med lönekörning<select name="run_id">{runs.map((r) => <option key={r.id} value={r.id}>{r.period}</option>)}</select></label>
          </div>
          <div><button>Lägg på lönen</button></div>
          <ul className="small muted" style={{ margin: 0 }}>{kinds.map((k) => <li key={k}><b>{BENEFITS[k].label}:</b> {BENEFITS[k].help}</li>)}</ul>
        </form>
      )}
      {u.history.length > 0 && (<>
        <h2>Utbetalda {year}</h2>
        <table className="small"><tbody>{u.history.map((h) => <tr key={h.id}><td>{h.date}</td><td>{h.employee}</td><td>{BENEFITS[h.kind as BenefitKind]?.label}</td><td>{h.description}</td><td className="num">{kr(h.amount)}</td><td>{h.run ? `lön ${h.run}` : ''}</td></tr>)}</tbody></table>
      </>)}
    </div>
  );
}
