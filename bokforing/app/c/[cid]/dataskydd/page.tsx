import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { LEGAL_BASES, RISKS } from '@/lib/data-protection';
import { overview } from '@/lib/services/data-protection';
import { activityAction, closeAction, incidentAction, updateAction } from './actions';

export const dynamic = 'force-dynamic';
const dt = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') : '');

export default async function DataProtection({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const id = company.id;
  const o = await overview(id);
  const open = o.incidents.filter((i) => !i.closed_on);
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Behandlingar och personuppgiftsincidenter</h1>
      <p className="small"><Link href={`/c/${id}/installningar/gdpr`}>← Dataskydd (GDPR)</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">Komplettera registret över behandlingar (art. 30) med det ni gör utanför tjänsten, till exempel kameraövervakning, rekrytering eller nyhetsbrev.
        En personuppgiftsincident ska anmälas till Integritetsskyddsmyndigheten (IMY) inom 72 timmar från att ni fick kännedom om den, om den inte är osannolik att leda till risk. Vid hög risk ska de registrerade informeras.
        Alla incidenter ska dokumenteras, även de som inte anmäls.</p>

      {open.filter((i) => i.duties.imy && !i.reported_imy_at).map((i) => <div key={i.id} className="card small dp-alert" data-late={i.deadline.late ? '1' : '0'}>
        Incident upptäckt {dt(i.discovered_at)}: {i.deadline.late ? `72-timmarsfristen gick ut ${dt(i.deadline.due)} – anmäl till IMY och ange skälen till förseningen.` : `anmäl till IMY senast ${dt(i.deadline.due)} (${i.deadline.hoursLeft} timmar kvar).`}</div>)}

      <h2>Personuppgiftsincidenter</h2>
      {o.incidents.map((i) => (
        <div key={i.id} className="card stack small dp-incident" data-risk={i.risk} data-closed={i.closed_on ? '1' : '0'}>
          <div><strong>{dt(i.discovered_at)}</strong> · {RISKS[i.risk]}{i.subjects_count > 0 && ` · ${i.subjects_count} registrerade`}{i.closed_on && ` · avslutad ${i.closed_on}`}</div>
          <div>{i.description}{i.categories && ` (${i.categories})`}</div>
          {i.consequences && <div>Konsekvenser: {i.consequences}</div>}
          <div className="dp-status">{i.measures && `Åtgärder: ${i.measures}. `}{i.duties.imy ? (i.reported_imy_at ? `Anmäld till IMY ${dt(i.reported_imy_at)}${i.imy_ref ? ` (${i.imy_ref})` : ''}. ` : 'Ej anmäld till IMY. ') : 'Behöver inte anmälas. '}
            {i.duties.subjects && (i.subjects_informed_at ? `De registrerade informerade ${dt(i.subjects_informed_at)}.` : 'De registrerade är inte informerade.')}</div>
          {!i.closed_on && <>
            <form action={updateAction.bind(null, id, i.id)} className="row dp-update" style={{ gap: '.25rem' }}>
              <input name="measures" placeholder="Åtgärder" defaultValue={i.measures} style={{ width: '16rem' }} />
              {i.duties.imy && !i.reported_imy_at && <><label><input type="checkbox" name="reported_imy" /> Anmäld till IMY</label><input name="imy_ref" placeholder="IMY:s diarienummer" /></>}
              {i.duties.imy && (i.deadline.late || i.late_reason) && <input name="late_reason" placeholder="Skäl till försenad anmälan" defaultValue={i.late_reason} />}
              {i.duties.subjects && !i.subjects_informed_at && <label><input type="checkbox" name="informed" /> De registrerade är informerade</label>}
              <button className="link">Spara</button></form>
            {i.blockers.length ? <div className="muted dp-blockers">Saknas för att avsluta: {i.blockers.join(', ')}</div> : <form action={closeAction.bind(null, id, i.id)}><button className="link">Avsluta incidenten</button></form>}</>}
        </div>))}
      {!o.incidents.length && <p className="muted">Inga incidenter.</p>}
      <form action={incidentAction.bind(null, id)} className="card stack dp-add-incident">
        <div className="row">
          <label>Upptäckt<input type="datetime-local" name="discovered_at" /></label>
          <label>Vad hände<input name="description" required maxLength={2000} style={{ width: '22rem' }} /></label>
          <label>Uppgifter som berörs<input name="categories" maxLength={500} /></label>
          <label>Antal registrerade<input name="subjects_count" inputMode="numeric" style={{ width: '5rem' }} /></label>
        </div>
        <div className="row">
          <label>Riskbedömning<select name="risk">{Object.entries(RISKS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Konsekvenser<input name="consequences" maxLength={1000} /></label>
          <label>Åtgärder<input name="measures" maxLength={1000} /></label>
        </div>
        <div><button>Registrera incident</button></div>
      </form>

      <h2>Egna behandlingar</h2>
      <table className="small dp-activities"><thead><tr><th>Behandling</th><th>Registrerade</th><th>Uppgifter</th><th>Ändamål</th><th>Rättslig grund</th><th>Mottagare</th><th>Lagringstid</th></tr></thead>
        <tbody>{o.activities.map((a) => <tr key={a.id} data-name={a.name}><td>{a.name}{a.sensitive && <div className="badge warn">känsliga uppgifter</div>}{a.third_country && <div className="badge warn">tredje land</div>}</td><td>{a.subjects}</td><td>{a.categories}</td><td>{a.purpose}</td><td>{LEGAL_BASES[a.legal_basis]}</td><td>{a.recipients}</td><td>{a.retention}</td></tr>)}
          {!o.activities.length && <tr><td colSpan={7} className="muted">Inga egna behandlingar.</td></tr>}</tbody></table>
      <form action={activityAction.bind(null, id)} className="card stack dp-add-activity">
        <div className="row">
          <label>Behandling<input name="name" required maxLength={150} /></label>
          <label>Registrerade<input name="subjects" required maxLength={300} /></label>
          <label>Personuppgifter<input name="categories" required maxLength={500} /></label>
          <label>Ändamål<input name="purpose" maxLength={500} /></label>
        </div>
        <div className="row">
          <label>Rättslig grund<select name="legal_basis">{Object.entries(LEGAL_BASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Mottagare<input name="recipients" maxLength={300} /></label>
          <label>Lagringstid<input name="retention" maxLength={200} /></label>
          <label className="row"><input type="checkbox" name="sensitive" /> Känsliga uppgifter (art. 9)</label>
          <label className="row"><input type="checkbox" name="third_country" /> Överföring till tredje land</label>
        </div>
        <div><button>Lägg till behandling</button></div>
      </form>
    </div>
  );
}
