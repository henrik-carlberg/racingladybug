import { sql } from '@/lib/db';
import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { addDays, today } from '@/lib/format';
import { fmtHours, isoWeek, weekStart } from '@/lib/time';
import { listShifts, listSites } from '@/lib/services/staff';
import { addShift, copyWeek, removeShift } from './actions';

export const dynamic = 'force-dynamic';
const DAYS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];

export default async function Schedule({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const sp = await searchParams;
  const week = weekStart(typeof sp.vecka === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.vecka) ? sp.vecka : today());
  const days = [...Array(7)].map((_, i) => addDays(week, i));
  const [shifts, sites, emps] = await Promise.all([
    listShifts(company.id, week, days[6]), listSites(company.id, true),
    sql<{ id: number; name: string }[]>`SELECT id, first_name || ' ' || last_name AS name FROM employees WHERE company_id = ${company.id} AND active ORDER BY first_name`,
  ]);
  const b = `/c/${company.id}/schema`;
  const hm = (s: string) => s.slice(11, 16);
  return (
    <div>
      <div className="header">
        <h1>Schema vecka {isoWeek(week)}</h1>
        <div className="actions" style={{ margin: 0 }}>
          <Link className="btn secondary" href={`${b}?vecka=${addDays(week, -7)}`}>← Föregående</Link>
          <Link className="btn secondary" href={b}>Denna vecka</Link>
          <Link className="btn secondary" href={`${b}?vecka=${addDays(week, 7)}`}>Nästa →</Link>
          <form action={copyWeek.bind(null, company.id, week)}><button className="secondary">Kopiera förra veckan</button></form>
        </div>
      </div>
      <Flash searchParams={searchParams} />
      <div className="table-wrap"><table className="small schedule">
        <thead><tr><th>Anställd</th>{days.map((d, i) => <th key={d}>{DAYS[i]} {d.slice(5)}</th>)}<th className="num">Timmar</th></tr></thead>
        <tbody>
          {emps.map((e) => {
            const mine = shifts.filter((s) => s.employee_id === e.id);
            return (
              <tr key={e.id}>
                <td><b>{e.name}</b></td>
                {days.map((d) => (
                  <td key={d}>{mine.filter((s) => s.starts_at.startsWith(d)).map((s) => (
                    <div key={s.id} className="shift" style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '.2rem .35rem', marginBottom: '.2rem' }}>
                      {hm(s.starts_at)}–{hm(s.ends_at)}{s.role && <div className="muted">{s.role}</div>}{s.site && <div className="muted">{s.site}</div>}
                      <form action={removeShift.bind(null, company.id, week, s.id)}><button className="link" aria-label="Ta bort pass">✕</button></form>
                    </div>
                  ))}</td>
                ))}
                <td className="num">{fmtHours(mine.reduce((x, s) => x + s.minutes, 0))}</td>
              </tr>
            );
          })}
          {emps.length === 0 && <tr><td colSpan={9} className="muted">Lägg först upp anställda under Lön → Anställda.</td></tr>}
        </tbody>
      </table></div>
      {emps.length > 0 && (
        <form action={addShift.bind(null, company.id, week)} className="card row" style={{ alignItems: 'end' }}>
          <label>Anställd<select name="employee_id">{emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label style={{ flex: '0 0 160px' }}>Datum<input type="date" name="date" defaultValue={days[0]} required /></label>
          <label style={{ flex: '0 0 110px' }}>Start<input type="time" name="start" defaultValue="08:00" required /></label>
          <label style={{ flex: '0 0 110px' }}>Slut<input type="time" name="end" defaultValue="17:00" required /></label>
          {sites.length > 0 && <label>Arbetsplats<select name="site_id" defaultValue=""><option value="">–</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
          <label>Roll/uppgift<input name="role" placeholder="T.ex. Kassa" /></label>
          <div style={{ flex: '0 0 auto' }}><button>Lägg till pass</button></div>
        </form>
      )}
      <p className="small muted">De anställda ser sitt schema på Min sida. Pass som slutar före starttiden går över midnatt.</p>
    </div>
  );
}
