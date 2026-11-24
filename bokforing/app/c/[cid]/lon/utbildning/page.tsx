import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { COMMON } from '@/lib/trainings';
import { overview } from '@/lib/services/trainings';
import { addAction } from './actions';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = { valid: 'Giltig', expiring: 'Går snart ut', expired: 'Utgången', permanent: 'Utan slutdatum' };

export default async function Trainings({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const id = company.id;
  const o = await overview(id);
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Utbildning och behörigheter</h1>
      <p className="small"><Link href={`/c/${id}/lon`}>← Lön</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">Kurser och certifikat per anställd med giltighetstid, till exempel truckkort, heta arbeten och ID06. Du får en påminnelse 60 dagar innan en behörighet går ut.
        Utbildning som behövs i arbetet är skattefri och bokförs på 7610. Utbildning som inte gäller arbetet är en skattepliktig förmån för den anställda (utom omställningsutbildning vid uppsägning).</p>
      {o.alerts.map((a) => <div key={a.id} className="card small tr-alert" data-name={a.name} data-status={a.status}>{a.name}: {a.title} {a.status === 'expired' ? `gick ut ${a.valid_until}` : `går ut ${a.valid_until} (om ${a.days} dagar)`} – boka förnyelse.</div>)}
      <h2>Behörigheter</h2>
      <table className="tr-certs"><thead><tr><th>Anställd</th><th>Behörighet</th><th>Genomförd</th><th>Giltig till</th><th>Status</th></tr></thead>
        <tbody>{o.certificates.map((c) => <tr key={c.id} className="tr-cert" data-name={c.name} data-title={c.title} data-status={c.status}><td>{c.name}</td><td>{c.title}{c.provider && <div className="small muted">{c.provider}</div>}</td><td>{c.completed_on}</td><td>{c.valid_until ?? '–'}</td><td>{STATUS[c.status]}</td></tr>)}
          {!o.certificates.length && <tr><td colSpan={5} className="muted">Inga behörigheter registrerade.</td></tr>}</tbody></table>
      <h2>Utbildningskostnad {o.year}</h2>
      <table className="tr-costs"><thead><tr><th>Anställd</th><th className="num">Utbildningar</th><th className="num">Kostnad</th><th className="num">Skattepliktig förmån</th></tr></thead>
        <tbody>{o.perEmployee.map((p) => <tr key={p.id} data-name={p.name}><td>{p.name}</td><td className="num">{p.count}</td><td className="num tr-cost">{kr(p.cost)}</td><td className="num tr-benefit">{kr(p.benefit)}</td></tr>)}
          {!o.perEmployee.length && <tr><td colSpan={4} className="muted">Inga utbildningar i år.</td></tr>}</tbody></table>

      <h2>Registrera utbildning</h2>
      {o.employees.length ? <form action={addAction.bind(null, id)} className="card stack tr-add">
        <div className="row">
          <label>Anställd<select name="employee_id">{o.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label>Typ<select name="kind"><option value="certificate">Behörighet eller certifikat</option><option value="course">Kurs</option></select></label>
          <label>Utbildning<input name="title" list="tr-common" required maxLength={150} /></label>
          <datalist id="tr-common">{COMMON.map((c) => <option key={c} value={c} />)}</datalist>
          <label>Anordnare<input name="provider" maxLength={150} /></label>
        </div>
        <div className="row">
          <label>Genomförd<input type="date" name="completed_on" defaultValue={today()} required /></label>
          <label>Giltig (månader)<input name="valid_months" inputMode="numeric" style={{ width: '5rem' }} /></label>
          <label>eller till<input type="date" name="valid_until" /></label>
          <label>Kostnad exkl. moms<input name="cost" inputMode="decimal" /></label>
          <label>Behövs i arbetet<select name="work_related"><option value="yes">Ja</option><option value="no">Nej (skattepliktig förmån)</option></select></label>
          <label className="row"><input type="checkbox" name="book" /> Bokför kostnaden (7610 mot 1930)</label>
        </div>
        <div><button>Spara utbildning</button></div>
      </form> : <p className="muted">Lägg upp anställda först.</p>}
    </div>
  );
}
