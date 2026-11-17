import { KIND_LABEL } from '@/lib/absence';
import { today } from '@/lib/format';
import { register } from '@/app/c/[cid]/lon/franvaro/actions';

export function AbsenceForm({ companyId, back, employees, self }: { companyId: number; back: string; employees?: { id: number; name: string }[]; self?: boolean }) {
  return (
    <form action={register.bind(null, companyId, back)} className="card stack">
      <div className="row">
        {employees && <label>Anställd<select name="employee_id">{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>}
        <label>Typ<select name="kind">{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Från<input type="date" name="from" defaultValue={today()} required /></label>
        <label>Till och med<input type="date" name="to" defaultValue={today()} /></label>
        <label>Omfattning (%)<input name="extent" type="number" min={1} max={100} defaultValue={100} /></label>
      </div>
      <label>Anteckning<input name="note" /></label>
      <div><button>{self ? 'Skicka' : 'Registrera frånvaro'}</button></div>
      {self && <p className="small muted" style={{ margin: 0 }}>Sjukdom och VAB registreras direkt (sjukanmälan). Semester, föräldraledighet och tjänstledighet skickas som ansökan för godkännande. Från dag 8 behövs läkarintyg och från dag 15 ansöker du om sjukpenning hos Försäkringskassan.</p>}
    </form>
  );
}
