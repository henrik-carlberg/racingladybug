import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { AREAS, DOC_THRESHOLD, GROUNDS, type Area } from '@/lib/active-measures';
import { overview } from '@/lib/services/active-measures';
import { addAction, completeAction, policyAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ActiveMeasures({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const id = company.id;
  const o = await overview(id);
  const p = o.progress;
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Aktiva åtgärder mot diskriminering {o.year}</h1>
      <p className="small"><Link href={`/c/${id}/lon`}>← Lön</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">Alla arbetsgivare ska arbeta förebyggande mot diskriminering på grund av {GROUNDS.join(', ')}: undersöka risker, analysera orsaker, vidta åtgärder och följa upp – inom de fem områdena nedan.
        Det ska också finnas riktlinjer och rutiner mot trakasserier, sexuella trakasserier och repressalier. Bolaget har {o.employees} anställda{o.documentation ? ` och ska dokumentera arbetet skriftligt (från ${DOC_THRESHOLD} anställda)` : ''}.
        Lönerna kartläggs i <Link href={`/c/${id}/m/lonerevision/kartlaggning`}>lönekartläggningen</Link>{o.payActions ? ` – ${o.payActions} lönejusteringar pågår` : ''}.</p>
      <div className={`card small am-progress`} data-complete={p.complete ? '1' : '0'}>
        {p.covered} av {p.total} områden undersökta{p.missing.length > 0 && ` – saknas: ${p.missing.map((a) => AREAS[a].toLowerCase()).join(', ')}`}
        {p.missingPlan > 0 && ` · ${p.missingPlan} åtgärder utan tidplan`}{p.overdue > 0 && ` · ${p.overdue} försenade`}{p.notFollowed > 0 && ` · ${p.notFollowed} inte uppföljda`}
        {!p.policy && ' · riktlinjer mot trakasserier saknas'}{p.complete && ' · årets arbete är klart'}</div>

      {(Object.keys(AREAS) as Area[]).map((a) => <div key={a} className="am-area" data-area={a}><h2>{AREAS[a]}</h2>
        {o.rows.filter((r) => r.area === a).map((r) => <div key={r.id} className="card small stack am-row" data-overdue={r.overdue ? '1' : '0'}>
          <div>{r.finding}</div>
          {r.measure && <div>Åtgärd: {r.measure}{r.owner && ` · ${r.owner}`}{r.due_date && <span className={r.overdue ? 'am-late' : ''}> · senast {r.due_date}</span>}{r.done_on && ` · genomförd ${r.done_on}`}</div>}
          {r.follow_up && <div>Uppföljning: {r.follow_up}</div>}
          {r.measure && !r.follow_up && <form action={completeAction.bind(null, id, r.id)} className="row" style={{ gap: '.25rem' }}><input name="follow_up" placeholder="Uppföljning – gav åtgärden effekt?" required style={{ width: '22rem' }} /><button className="link">Genomförd och uppföljd</button></form>}
        </div>)}
        {!o.rows.some((r) => r.area === a) && <p className="small muted">Inte undersökt i år.</p>}</div>)}

      <h2>Dokumentera undersökning</h2>
      <form action={addAction.bind(null, id)} className="card stack am-add">
        <label>Område<select name="area">{Object.entries(AREAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Undersökning och analys (risker och orsaker)<textarea name="finding" rows={3} required maxLength={4000} /></label>
        <div className="row">
          <label>Åtgärd (om det behövs)<input name="measure" maxLength={2000} style={{ width: '22rem' }} /></label>
          <label>Ansvarig<input name="owner" maxLength={100} /></label>
          <label>Klart senast<input type="date" name="due_date" /></label>
        </div>
        <div><button>Spara</button></div>
      </form>

      <h2>Riktlinjer och rutiner mot trakasserier och repressalier</h2>
      <form action={policyAction.bind(null, id)} className="card stack am-policy">
        <label>Riktlinjer<textarea name="guidelines" rows={3} required defaultValue={o.policy?.guidelines ?? ''} maxLength={8000} /></label>
        <label>Rutiner (vem man vänder sig till, hur anmälningar utreds)<textarea name="routines" rows={3} required defaultValue={o.policy?.routines ?? ''} maxLength={8000} /></label>
        <label>Antagna<input type="date" name="adopted_on" defaultValue={o.policy?.adopted_on ?? ''} /></label>
        <div><button>Spara riktlinjer</button></div>
      </form>
    </div>
  );
}
