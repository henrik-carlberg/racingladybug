import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { MAX_TOTAL_VALUE } from '@/lib/kpo';
import { overview } from '@/lib/services/kpo';
import { listEmployees } from '@/lib/services/payroll';
import { addProgram, exerciseAction, grant } from './actions';

export const dynamic = 'force-dynamic';

/** Kvalificerade personaloptioner: villkor, tilldelning, intjänande och utnyttjande */
export default async function Options({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const o = await overview(company.id);
  const emps = (await listEmployees(company.id, { limit: 200, startingAfter: null })).data;
  const t = today();
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Kvalificerade personaloptioner</h1>
      <p className="small"><Link href={`/c/${company.id}/lon`}>← Lön</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">Optioner som uppfyller villkoren förmånsbeskattas inte när de utnyttjas – vinsten beskattas i stället som kapitalvinst när aktierna säljs. Bolaget ska ha färre än 250 anställda,
        högst 280 miljoner kronor i omsättning eller balansomslutning och ha funnits i mindre än tio år. Den anställda ska arbeta minst 30 timmar i veckan, och det ska gå minst tre år mellan tilldelning och utnyttjande.
        Lämna uppgift om tilldelade optioner i arbetsgivardeklarationen för tilldelningsmånaden.</p>
      <div className="grid">
        <div className="card stat"><div className="label">Anställda</div><div className="value">{o.figures.employees}</div></div>
        <div className="card stat"><div className="label">Värde av aktier under optionerna</div><div className="value kpo-total">{kr(o.total)}</div><div className="small muted">av högst {kr(MAX_TOTAL_VALUE)} kr</div></div>
      </div>
      {o.programs.map((p) => (
        <section key={p.id} className="card stack kpo-program" data-name={p.name}>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{p.name} <span className="small muted">beslutat {p.decided_on}</span></h2>
          <ul className="small" style={{ margin: 0 }}>{p.checks.map((c) => <li key={c.text} className={`kpo-check ${c.ok ? 'ok' : 'fail'}`}>{c.ok ? '✅' : '⚠️'} {c.text}</li>)}</ul>
          <table className="small"><thead><tr><th>Anställd</th><th>Tilldelad</th><th className="num">Optioner</th><th className="num">Lösenpris</th><th>Intjänad</th><th>Status</th></tr></thead>
            <tbody>{p.grants.map((g) => (
              <tr key={g.id} className="kpo-grant" data-employee={g.employee}><td>{g.employee}</td><td>{g.granted_on}</td><td className="num">{g.options}</td><td className="num">{kr(g.strike)}</td><td>{g.vested}</td>
                <td>{g.exercised_on ? <span className="kpo-status">{g.qualified ? 'Utnyttjad – kvalificerad' : `Utnyttjad – förmån ${kr(g.benefit ?? 0)} kr`} {g.exercised_on}</span>
                  : <>{g.warning && <div className="kpo-warning">⚠️ {g.warning}</div>}
                    <form action={exerciseAction.bind(null, company.id, g.id)} className="row"><input type="date" name="date" defaultValue={t} aria-label="Datum" /><input name="count" defaultValue={g.options} aria-label="Antal" style={{ width: '5rem' }} />
                      <input name="market_price" placeholder="Marknadsvärde/aktie" aria-label="Marknadsvärde per aktie" style={{ width: '9rem' }} /><button className="secondary small">Utnyttja</button></form></>}</td></tr>))}</tbody></table>
          <form action={grant.bind(null, company.id, p.id)} className="row kpo-grant-form">
            <label>Anställd<select name="employee_id">{emps.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}</select></label>
            <label>Tilldelad<input type="date" name="granted_on" defaultValue={t} /></label>
            <label>Optioner<input name="options" style={{ width: '6rem' }} /></label>
            <label>Lösenpris (kr)<input name="strike" style={{ width: '7rem' }} /></label>
            <label>Aktiens värde (kr)<input name="share_value" style={{ width: '7rem' }} /></label>
            <label>Timmar/vecka<input name="hours_per_week" defaultValue="40" style={{ width: '5rem' }} /></label>
            <div style={{ flex: '0 0 auto' }}><button>Tilldela</button></div>
          </form>
        </section>
      ))}
      <form action={addProgram.bind(null, company.id)} className="card row" style={{ marginTop: '1rem' }}>
        <label>Nytt program<input name="name" required placeholder="T.ex. KPO 2026" /></label>
        <label>Beslutat<input type="date" name="decided_on" defaultValue={t} required /></label>
        <label>Verksamheten startade år<input name="started_year" required style={{ width: '6rem' }} /></label>
        <label className="row" style={{ alignItems: 'center' }}><input type="checkbox" name="excluded_business" /> Bank, finans, försäkring, fastighet eller juridik/redovisning</label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Lägg upp</button></div>
      </form>
    </div>
  );
}
