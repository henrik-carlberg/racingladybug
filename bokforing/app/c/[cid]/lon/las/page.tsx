import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { FORMS, MAX_EXEMPT } from '@/lib/las';
import { overview } from '@/lib/services/las';
import { exemptAction, periodAction, removeAction } from './actions';

export const dynamic = 'force-dynamic';
const years = (d: number) => `${(Math.round(d / 365.25 * 10) / 10).toLocaleString('sv-SE')} år`;

export default async function Las({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const id = company.id;
  const o = await overview(id);
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Anställningsskydd (LAS)</h1>
      <p className="small"><Link href={`/c/${id}/lon`}>← Lön</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">En särskild visstidsanställning övergår till tillsvidareanställning när den anställda haft särskild visstid i sammanlagt mer än tolv månader under en femårsperiod, och ett vikariat efter mer än två år.
        Den som sägs upp på grund av arbetsbrist, eller vars visstid inte förlängs av det skälet, har företrädesrätt till återanställning om hen varit anställd mer än tolv månader de senaste tre åren – fram till nio månader efter att anställningen upphörde.
        Vid arbetsbrist bestäms turordningen inom varje krets efter anställningstid; arbetsgivaren får undanta högst {MAX_EXEMPT} arbetstagare. Kollektivavtal kan ge andra regler.</p>
      {o.alerts.map((p) => <div key={p.id} className="card small las-alert" data-name={p.name} data-converted={p.conversion!.converted ? '1' : '0'}>
        {p.name}: {FORMS[p.conversion!.form].toLowerCase()} {p.conversion!.converted ? `har övergått till tillsvidareanställning (${p.conversion!.used} dagar under fem år)` : `övergår till tillsvidareanställning ${p.conversion!.convertsOn} (${p.conversion!.left} dagar kvar)`}.</div>)}

      <h2>Företrädesrätt till återanställning</h2>
      <ul className="las-priority">{o.priorities.map((p) => <li key={p.id} data-name={p.name}>{p.name} – slutade {p.priority!.endedOn}, företrädesrätt till {p.priority!.until}</li>)}
        {!o.priorities.length && <li className="muted">Ingen har företrädesrätt just nu.</li>}</ul>

      <h2>Turordning</h2>
      {o.seniority.map((c) => <div key={c.circle}><h3>{c.circle}</h3>
        <table className="small las-seniority" data-circle={c.circle}><thead><tr><th>#</th><th>Anställd</th><th className="num">Anställningstid</th><th></th></tr></thead>
          <tbody>{c.list.map((p) => <tr key={p.id} className="las-rank" data-name={p.name} data-rank={p.rank}><td>{p.rank}</td><td>{p.name}{p.exempt && <span className="badge"> undantagen</span>}</td><td className="num">{years(p.days)}</td>
            <td><form action={exemptAction.bind(null, id, p.id, !p.exempt)}><button className="link">{p.exempt ? 'Ta bort undantag' : 'Undanta'}</button></form></td></tr>)}</tbody></table></div>)}
      <p className="small muted">Undantagna: {o.exemptCount} av {MAX_EXEMPT}. Den med kortast anställningstid står sist och sägs upp först; vid lika anställningstid går den äldre före.</p>

      <h2>Anställningsperioder</h2>
      <table className="small las-periods"><thead><tr><th>Anställd</th><th>Perioder</th></tr></thead>
        <tbody>{o.people.map((p) => <tr key={p.id} data-name={p.name}><td>{p.name}{!p.active && <div className="muted">slutat</div>}</td>
          <td>{p.derived ? <span className="muted">enligt personalregistret</span> : <ul>{p.periods.map((x) => <li key={x.id}>{FORMS[x.form]} {x.start} – {x.end ?? 'pågående'}{x.circle && ` · ${x.circle}`}{x.shortage && ' · arbetsbrist'}
            <form action={removeAction.bind(null, id, x.id)} style={{ display: 'inline' }}> <button className="link">Ta bort</button></form></li>)}</ul>}</td></tr>)}</tbody></table>
      <form action={periodAction.bind(null, id)} className="card row las-add">
        <label>Anställd<select name="employee_id">{o.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Form<select name="form">{Object.entries(FORMS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Från<input type="date" name="start_date" required /></label>
        <label>Till<input type="date" name="end_date" /></label>
        <label>Turordningskrets<input name="circle" maxLength={100} placeholder="t.ex. Lager, Göteborg" /></label>
        <label className="row"><input type="checkbox" name="shortage" /> Avslutad på grund av arbetsbrist</label>
        <button>Spara period</button>
      </form>
    </div>
  );
}
