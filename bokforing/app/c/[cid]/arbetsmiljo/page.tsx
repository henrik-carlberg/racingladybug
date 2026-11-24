import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { today } from '@/lib/format';
import { CHECKLIST, INCIDENTS } from '@/lib/work-environment';
import { overview } from '@/lib/services/work-environment';
import { incidentAction, reportedAction, reviewAction, riskAction, riskDoneAction } from './actions';

export const dynamic = 'force-dynamic';
const LEVEL: Record<string, string> = { high: 'Hög', medium: 'Medel', low: 'Låg' };

export default async function WorkEnvironment({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const id = company.id;
  const o = await overview(id);
  const t = today();
  const pending = o.incidents.filter((i) => i.missing.av || i.missing.fk);
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Arbetsmiljö</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Systematiskt arbetsmiljöarbete: undersök risker, åtgärda dem och följ upp. Allvarliga olyckor och allvarliga tillbud ska anmälas till Arbetsmiljöverket utan dröjsmål, och arbetsskador till Försäkringskassan.
        Arbetsmiljöarbetet följs upp en gång om året.</p>
      {pending.map((i) => <div key={i.id} className="card small we-alert" data-id={i.id}>{i.date}: {i.description.slice(0, 80)} –
        {i.missing.av && <span className={i.missing.avLate ? 'we-late' : ''}> anmäl till Arbetsmiljöverket{i.missing.avLate ? ' (försenad)' : ''}</span>}
        {i.missing.fk && <span className={i.missing.fkLate ? 'we-late' : ''}> anmäl arbetsskadan till Försäkringskassan{i.missing.fkLate ? ' (försenad)' : ''}</span>}</div>)}

      <h2>Riskbedömningar och handlingsplan</h2>
      <table className="we-risks"><thead><tr><th>Arbetsmoment</th><th>Risk</th><th className="num">Riskvärde</th><th>Åtgärd</th><th>Ansvarig</th><th>Senast</th><th></th></tr></thead>
        <tbody>{o.risks.map((r) => <tr key={r.id} className="we-risk" data-hazard={r.hazard} data-level={r.level}><td>{r.area}</td><td>{r.hazard}</td><td className="num">{r.score} ({LEVEL[r.level]})</td><td>{r.measure}</td><td>{r.owner}</td>
          <td className={r.overdue ? 'we-late' : ''}>{r.done_on ? `klar ${r.done_on}` : r.due_date ?? ''}</td><td>{!r.done_on && <form action={riskDoneAction.bind(null, id, r.id)}><button className="link">Genomförd</button></form>}</td></tr>)}
          {!o.risks.length && <tr><td colSpan={7} className="muted">Inga riskbedömningar.</td></tr>}</tbody></table>
      <form action={riskAction.bind(null, id)} className="card row we-add-risk">
        <label>Arbetsmoment<input name="area" required maxLength={150} /></label>
        <label>Risk<input name="hazard" required maxLength={500} /></label>
        <label>Sannolikhet 1–5<input name="probability" inputMode="numeric" required style={{ width: '4rem' }} /></label>
        <label>Konsekvens 1–5<input name="consequence" inputMode="numeric" required style={{ width: '4rem' }} /></label>
        <label>Åtgärd<input name="measure" maxLength={500} /></label>
        <label>Ansvarig<input name="owner" maxLength={100} /></label>
        <label>Senast<input type="date" name="due_date" /></label>
        <button>Spara risk</button>
      </form>

      <h2>Tillbud och arbetsskador</h2>
      <p className="small we-stats">I år: {Object.entries(INCIDENTS).map(([k, v]) => `${v.split(' (')[0].toLowerCase()} ${o.stats[k as keyof typeof INCIDENTS]}`).join(' · ')} · sjukdagar {o.absentDays}</p>
      <table className="we-incidents"><thead><tr><th>Datum</th><th>Händelse</th><th>Anställd</th><th>Åtgärd</th><th>Anmält</th></tr></thead>
        <tbody>{o.incidents.map((i) => <tr key={i.id} className="we-incident" data-kind={i.kind}><td>{i.date}</td><td>{INCIDENTS[i.kind]}<div className="small">{i.description}</div></td><td>{i.employee ?? ''}{i.days_absent > 0 && <div className="small">{i.days_absent} sjukdagar</div>}</td><td className="small">{i.measure}</td>
          <td className="small">{i.reported_av_on && <div>Arbetsmiljöverket {i.reported_av_on}</div>}{i.reported_fk_on && <div>Försäkringskassan {i.reported_fk_on}</div>}
            {i.missing.av && <form action={reportedAction.bind(null, id, i.id, 'av')}><button className="link">Anmäld till Arbetsmiljöverket</button></form>}
            {i.missing.fk && <form action={reportedAction.bind(null, id, i.id, 'fk')}><button className="link">Anmäld till Försäkringskassan</button></form>}</td></tr>)}
          {!o.incidents.length && <tr><td colSpan={5} className="muted">Inga händelser.</td></tr>}</tbody></table>
      <form action={incidentAction.bind(null, id)} className="card row we-add-incident">
        <label>Datum<input type="date" name="date" defaultValue={t} required /></label>
        <label>Typ<select name="kind">{Object.entries(INCIDENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Vad hände<input name="description" required maxLength={2000} style={{ width: '20rem' }} /></label>
        <label>Anställd<select name="employee_id"><option value="">–</option>{o.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label>Sjukdagar<input name="days_absent" inputMode="numeric" style={{ width: '4rem' }} /></label>
        <label>Åtgärd<input name="measure" maxLength={1000} /></label>
        <button>Registrera händelse</button>
      </form>

      <h2>Årlig uppföljning {o.year}</h2>
      <form action={reviewAction.bind(null, id)} className="card stack we-review" data-done={o.review.done}>
        {Object.entries(CHECKLIST).map(([k, v]) => <label key={k} className="small"><input type="checkbox" name={`c_${k}`} defaultChecked={o.review.checked.includes(k)} /> {v}</label>)}
        <label>Anteckningar<textarea name="note" defaultValue={o.review.note} rows={2} maxLength={2000} /></label>
        <div className="small we-progress">{o.review.done} av {o.review.total} punkter{o.review.done_on && ` · klar ${o.review.done_on}`}</div>
        <div><button>Spara uppföljning</button></div>
      </form>
    </div>
  );
}
