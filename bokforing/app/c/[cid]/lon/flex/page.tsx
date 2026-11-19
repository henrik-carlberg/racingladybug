import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { today } from '@/lib/format';
import { fmtMinutes } from '@/lib/flex';
import { flexFor, flexOverview } from '@/lib/services/payroll2';
import { adjust, enable, payout } from './actions';

export const dynamic = 'force-dynamic';

export default async function Flex({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const id = company.id, sp = await searchParams;
  const [list, emps, runs] = await Promise.all([flexOverview(id), sql<{ id: number; name: string }[]>`SELECT id, first_name || ' ' || last_name AS name FROM employees WHERE company_id = ${id} AND active ORDER BY last_name`,
    sql<{ id: number; period: string }[]>`SELECT id, period FROM payroll_runs WHERE company_id = ${id} AND status = 'draft' ORDER BY period DESC`]);
  const selected = Number(sp.e) || list[0]?.id;
  const f = selected ? await flexFor(id, selected) : null;
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Flextid och tidbank</h1>
      <p className="muted">Planerad tid enligt <a href={`/c/${id}/schema`}>schemat</a> jämförs med stämplad tid i personalliggaren. Över- och undertid sparas i tidbanken och kan tas ut som ledighet eller betalas ut med lönen.</p>
      <Flash searchParams={searchParams} />
      <div className="table-wrap"><table className="flex-list"><thead><tr><th>Anställd</th><th>Sedan</th><th className="num">Saldo</th></tr></thead>
        <tbody>{list.map((x) => <tr key={x.id} className="flex-row"><td><a href={`?e=${x.id}`}>{x.name}</a></td><td>{x.start}</td><td className="num"><b className="flex-balance">{fmtMinutes(x.balance)}</b></td></tr>)}
          {list.length === 0 && <tr><td colSpan={3} className="muted">Ingen har flextid ännu – slå på det i formuläret nedan.</td></tr>}</tbody></table></div>
      <form action={enable.bind(null, id)} className="card row" style={{ alignItems: 'end' }}>
        <label>Anställd<select name="employee_id">{emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label>Flextid från<input type="date" name="start" defaultValue={today().slice(0, 8) + '01'} /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Slå på flextid</button></div>
      </form>
      {f && f.start && (<>
        <h2>{f.name}: <span className="flex-detail-balance">{fmtMinutes(f.balance)}</span></h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
          <form action={adjust.bind(null, id, selected!)} className="card stack">
            <b>Kompledigt eller rättning</b>
            <div className="row"><label>Typ<select name="kind"><option value="leave">Kompledigt (drar från banken)</option><option value="adjust">Rättning (+/−)</option></select></label>
              <label>Timmar<input name="hours" inputMode="decimal" required /></label><label>Datum<input type="date" name="date" defaultValue={today()} /></label></div>
            <label>Kommentar<input name="note" required /></label>
            <div><button className="secondary">Spara</button></div>
          </form>
          {runs.length > 0 && f.balance > 0 && (
            <form action={payout.bind(null, id, selected!)} className="card stack">
              <b>Betala ut sparad tid</b>
              <div className="row"><label>Timmar<input name="hours" inputMode="decimal" required /></label>
                <label>Med lönekörning<select name="run_id">{runs.map((r) => <option key={r.id} value={r.id}>{r.period}</option>)}</select></label></div>
              <p className="small muted" style={{ margin: 0 }}>Timlön = månadslönen / 165.</p>
              <div><button className="secondary">Lägg på lönen</button></div>
            </form>
          )}
        </div>
        <div className="table-wrap"><table className="small flex-days"><thead><tr><th>Datum</th><th className="num">Planerat</th><th className="num">Stämplat</th><th className="num">Flex</th></tr></thead>
          <tbody>{[...f.days].reverse().slice(0, 60).map((d) => <tr key={d.date}><td>{d.date}</td><td className="num">{fmtMinutes(d.planned).replace('+', '')}</td><td className="num">{fmtMinutes(d.worked).replace('+', '')}</td><td className="num">{fmtMinutes(d.diff)}</td></tr>)}
            {f.adjustments.map((a) => <tr key={`a${a.id}`} className="flex-adj"><td>{a.date}</td><td colSpan={2}>{a.kind === 'payout' ? 'Utbetald' : a.kind === 'leave' ? 'Kompledigt' : 'Rättning'}: {a.note}</td><td className="num">{fmtMinutes(a.minutes)}</td></tr>)}</tbody></table></div>
      </>)}
    </div>
  );
}
