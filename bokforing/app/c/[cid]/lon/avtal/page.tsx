import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { listAgreements, type Agreement } from '@/lib/services/agreements';
import { save } from './actions';

export const dynamic = 'force-dynamic';
const k = (o: number) => (o ? (o / 100).toFixed(2).replace('.', ',') : '');
const n = (v: number) => String(v).replace('.', ',');

function Fields({ a }: { a?: Agreement }) {
  return (
    <>
      <div className="row"><label style={{ flex: '2 1 260px' }}>Namn<input name="name" defaultValue={a?.name} placeholder="T.ex. Handels butiksavtal" required /></label></div>
      <fieldset className="row"><legend>OB-tillägg kr per timme</legend>
        <label>Kväll<input name="ob_evening" inputMode="decimal" defaultValue={k(a?.ob_evening ?? 0)} /></label>
        <label>Natt<input name="ob_night" inputMode="decimal" defaultValue={k(a?.ob_night ?? 0)} /></label>
        <label>Helg<input name="ob_weekend" inputMode="decimal" defaultValue={k(a?.ob_weekend ?? 0)} /></label>
        <label>Storhelg<input name="ob_holiday" inputMode="decimal" defaultValue={k(a?.ob_holiday ?? 0)} /></label>
      </fieldset>
      <fieldset className="row"><legend>Övertid: timersättning = månadslön / delare</legend>
        <label>Enkel övertid<input name="overtime_simple_divisor" inputMode="numeric" defaultValue={a?.overtime_simple_divisor ?? 94} /></label>
        <label>Kvalificerad övertid<input name="overtime_qualified_divisor" inputMode="numeric" defaultValue={a?.overtime_qualified_divisor ?? 72} /></label>
        <label>Restid (månadslön / delare)<input name="travel_divisor" inputMode="numeric" defaultValue={a?.travel_divisor ?? 240} /></label>
      </fieldset>
      <fieldset className="row"><legend>Beredskap kr per timme</legend>
        <label>Vardag<input name="oncall_weekday" inputMode="decimal" defaultValue={k(a?.oncall_weekday ?? 0)} /></label>
        <label>Helg<input name="oncall_weekend" inputMode="decimal" defaultValue={k(a?.oncall_weekend ?? 0)} /></label>
      </fieldset>
      <div className="row">
        <label>Semestertillägg % av månadslönen per dag<input name="vacation_supplement" inputMode="decimal" defaultValue={n(a?.vacation_supplement ?? 0.43)} /></label>
        <label>Avtalsförsäkringar Fora % av lönen<input name="fora_insurance_percent" inputMode="decimal" defaultValue={n(a?.fora_insurance_percent ?? 0)} /></label>
      </div>
    </>
  );
}

export default async function Agreements({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const list = await listAgreements(company.id);
  return (
    <div style={{ maxWidth: 900 }}>
      <div className="header"><h1>Kollektivavtal</h1><Link className="btn secondary" href={`/c/${company.id}/lon`}>Tillbaka</Link></div>
      <Flash searchParams={searchParams} />
      <p className="muted">Lägg in reglerna från ert avtal en gång. Välj avtal och pensionsplan på varje anställd – då räknas OB, övertid och beredskap ut från timmarna på lönespecen, semestertillägget följer avtalet och pension och Fora-försäkringar bokförs med lönen. Kontrollera beloppen mot avtalet varje år.</p>
      {list.map((a) => (
        <details key={a.id} className="card agreement">
          <summary><b>{a.name}</b> <span className="muted small">OB kväll {k(a.ob_evening) || '0'} kr · övertid /{a.overtime_simple_divisor} och /{a.overtime_qualified_divisor} · semestertillägg {n(a.vacation_supplement)} %</span></summary>
          <form action={save.bind(null, company.id, a.id)} className="stack" style={{ marginTop: '.5rem' }}><Fields a={a} /><div><button>Spara</button></div></form>
        </details>
      ))}
      <h2>Nytt avtal</h2>
      <form action={save.bind(null, company.id, null)} className="card stack"><Fields /><div><button>Lägg till avtal</button></div></form>
    </div>
  );
}
