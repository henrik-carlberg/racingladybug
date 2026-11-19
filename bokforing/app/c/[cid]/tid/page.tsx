import Link from 'next/link';
import { UndoButton } from '@/components/Undo';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { Help } from '@/components/Help';
import { addDays, today } from '@/lib/format';
import { fmtHours, isoWeek, weekStart } from '@/lib/time';
import { listProjects, listTimeEntries } from '@/lib/services/time';
import { addTime, removeTimeNow } from './actions';

export const dynamic = 'force-dynamic';

const DAYS = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag'];

export default async function TimePage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company, user, role } = await requireCompany(cid, { employee: true });
  const sp = await searchParams;
  const t = today();
  const week = weekStart(/^\d{4}-\d{2}-\d{2}$/.test(String(sp.week ?? '')) ? String(sp.week) : t);
  const end = addDays(week, 6);
  const all = sp.all === '1' && role !== 'employee';
  const projects = (await listProjects(company.id, { active: true })).filter((p) => p.activities.some((a) => a.active));
  const entries = await listTimeEntries(company.id, { from: week, to: end, user_id: all ? undefined : user.id });
  const b = `/c/${company.id}`;
  const days = [...Array(7)].map((_, i) => addDays(week, i));
  const sum = (d?: string) => entries.filter((e) => !d || e.date === d).reduce((s, e) => s + e.minutes, 0);
  const billable = entries.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0);
  const defaultDate = t >= week && t <= end ? t : week;
  const q = all ? '&all=1' : '';

  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="header">
        <h1>Tidrapportering <Help term="tidrapportering" /></h1>
        <div className="actions" style={{ margin: 0 }}>
          <Link className="btn secondary" href={`${b}/tid?week=${addDays(week, -7)}${q}`}>← Vecka {isoWeek(addDays(week, -7))}</Link>
          <Link className="btn secondary" href={`${b}/tid${all ? '?all=1' : ''}`}>Denna vecka</Link>
          <Link className="btn secondary" href={`${b}/tid?week=${addDays(week, 7)}${q}`}>Vecka {isoWeek(addDays(week, 7))} →</Link>
        </div>
      </div>
      <Flash searchParams={searchParams} />

      {projects.length === 0 ? (
        <div className="card">
          <p>Lägg först upp ett <b>uppdrag</b> för en kund med de aktiviteter du arbetar med. Sedan rapporterar du tid här.</p>
          {role !== 'employee' && <Link className="btn" href={`${b}/uppdrag`}>Lägg upp uppdrag</Link>}
        </div>
      ) : (
        <form action={addTime.bind(null, company.id, week)} className="card stack">
          <div className="row">
            <label>Datum<input type="date" name="date" defaultValue={defaultDate} required /></label>
            <label style={{ flex: '2 1 260px' }}>Uppdrag och aktivitet
              <select name="activity_id" required>
                {projects.map((p) => (
                  <optgroup key={p.id} label={`${p.customer_name} – ${p.name}`}>
                    {p.activities.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{p.name} – {a.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>Tid<input name="hours" placeholder="1,5 eller 1:30" required inputMode="decimal" autoComplete="off" /></label>
          </div>
          <div className="row">
            <label style={{ flex: '3 1 260px' }}>Vad gjorde du? (syns på fakturans tidsspecifikation)<input name="description" /></label>
            <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" name="billable" defaultChecked /> Debiterbar</label>
            <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button>Spara tid</button></div>
          </div>
        </form>
      )}

      <div className="grid">
        <div className="card stat"><div className="label">Vecka {isoWeek(week)} ({week} – {end})</div><div className="value">{fmtHours(sum())}</div></div>
        <div className="card stat"><div className="label">Varav debiterbart</div><div className="value">{fmtHours(billable)}</div></div>
      </div>
      <p className="small">
        {role !== 'employee' && <>{all ? <Link href={`${b}/tid?week=${week}`}>Visa bara min tid</Link> : <Link href={`${b}/tid?week=${week}&all=1`}>Visa allas tid</Link>}
        {' · '}<Link href={`${b}/uppdrag`}>Uppdrag och fakturering</Link></>}
      </p>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Dag</th><th>Kund / uppdrag</th><th>Aktivitet</th><th>Beskrivning</th>{all && <th>Person</th>}<th className="num">Tid</th><th></th></tr></thead>
          <tbody>
            {days.map((d, i) => {
              const rows = entries.filter((e) => e.date === d);
              return [
                <tr key={d} style={{ background: 'var(--bg-soft, #f6f7f9)' }}>
                  <td colSpan={all ? 5 : 4}><b>{DAYS[i]}</b> <span className="muted small">{d}</span></td>
                  <td className="num"><b>{rows.length ? fmtHours(sum(d)) : ''}</b></td><td></td>
                </tr>,
                ...rows.map((e) => (
                  <tr key={e.id}>
                    <td></td>
                    <td>{e.customer_name} – {role === 'employee' ? e.project_name : <Link href={`${b}/uppdrag/${e.project_id}`}>{e.project_name}</Link>}</td>
                    <td>{e.activity_name}{!e.billable && <span className="badge" style={{ marginLeft: '.3rem' }}>Ej debiterbar</span>}</td>
                    <td className="small">{e.description}</td>
                    {all && <td className="small">{e.user_name}</td>}
                    <td className="num">{fmtHours(e.minutes)}</td>
                    <td className="num">{e.invoice_id
                      ? (role === 'employee' ? <span className="small muted">Fakturerad</span> : <Link className="small" href={`${b}/fakturor/${e.invoice_id}`}>Fakturerad</Link>)
                      : <UndoButton action={removeTimeNow.bind(null, company.id, e.id)} message="Tidraden tas bort">Ta bort</UndoButton>}</td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
