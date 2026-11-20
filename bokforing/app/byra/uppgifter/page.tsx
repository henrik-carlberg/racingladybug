import Link from 'next/link';
import { allowedCompanies, requireUser } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { addDays, today } from '@/lib/format';
import { myFirms, firmClients } from '@/lib/services/firms';
import { firmBoard } from '@/lib/services/firm-tasks';
import { addTask, assignTask, completeTask } from './actions';

export const dynamic = 'force-dynamic';
const STATE: Record<string, string> = { overdue: 'Försenad', soon: 'Snart', upcoming: 'Kommande', done: 'Klar' };

/** Byråns uppgifter: kundernas deadlines och egna uppgifter med ansvarig kollega */
export default async function FirmTasks({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const firms = await myFirms(user.id);
  const firm = firms.find((f) => String(f.id) === sp.f) ?? firms[0];
  if (!firm) return <div className="center"><p>Du är inte med i någon byrå. <Link href="/byra">Skapa en byrå</Link></p></div>;
  const clients = await allowedCompanies((await firmClients(firm.id, user.id)).map((c) => ({ id: c.id, name: c.name })));
  const mine = sp.mine === '1', showDone = sp.done === '1';
  const companyId = clients.some((c) => String(c.id) === sp.k) ? Number(sp.k) : null;
  const b = await firmBoard(user.id, firm.id, clients, { mine, companyId, showDone });
  const q = (o: Record<string, string | null>) => { const p = new URLSearchParams({ f: String(firm.id), ...(mine ? { mine: '1' } : {}), ...(showDone ? { done: '1' } : {}), ...(companyId ? { k: String(companyId) } : {}) });
    for (const [k, v] of Object.entries(o)) v == null ? p.delete(k) : p.set(k, v); return `/byra/uppgifter?${p}`; };
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem 16px' }}>
      <div className="header">
        <h1>Uppgifter och deadlines</h1>
        <div className="actions" style={{ margin: 0 }}>
          <Link className="btn secondary" href={`/byra?f=${firm.id}`}>Klienter</Link>
          <Link className="btn secondary" href={`/byra/manad?f=${firm.id}`}>Månadsbokslut</Link>
        </div>
      </div>
      <Flash searchParams={searchParams} />
      <div className="grid">
        <div className="card stat"><div className="label">Försenade</div><div className="value task-overdue">{b.summary.overdue}</div></div>
        <div className="card stat"><div className="label">Inom två veckor</div><div className="value task-soon">{b.summary.soon}</div></div>
        <div className="card stat"><div className="label">Utan ansvarig</div><div className="value task-unassigned">{b.summary.unassigned}</div></div>
      </div>
      <p className="small">
        <Link href={q({ mine: mine ? null : '1' })} className="filter-mine">{mine ? 'Visa allas' : 'Bara mina'}</Link>{' · '}
        <Link href={q({ done: showDone ? null : '1' })}>{showDone ? 'Dölj klara' : 'Visa klara'}</Link>
        {companyId && <>{' · '}<Link href={q({ k: null })}>Alla kunder</Link></>}
      </p>
      <table className="firm-tasks">
        <thead><tr><th>Datum</th><th>Kund</th><th>Uppgift</th><th>Status</th><th>Ansvarig</th><th></th></tr></thead>
        <tbody>{b.rows.map((r) => (
          <tr key={`${r.companyId}:${r.deadlineKey ?? r.taskId}`} className={`task-row ${r.state}`} data-company={r.company}>
            <td>{r.due}</td>
            <td><Link href={q({ k: String(r.companyId) })}>{r.company}</Link></td>
            <td>{r.href ? <Link href={r.href}>{r.title}</Link> : r.title}</td>
            <td><span className={`badge ${r.state === 'overdue' ? 'danger' : r.state === 'soon' ? 'warn' : r.state === 'done' ? 'ok' : ''}`}>{STATE[r.state]}</span></td>
            <td>{r.state === 'done' ? r.assigneeName ?? '–' : (
              <form action={assignTask.bind(null, firm.id)} style={{ display: 'flex', gap: '.3rem' }}>
                <input type="hidden" name="company_id" value={r.companyId} />
                {r.taskId ? <input type="hidden" name="task_id" value={r.taskId} /> : <input type="hidden" name="deadline_key" value={r.deadlineKey ?? ''} />}
                <select name="assignee" defaultValue={r.assignee ?? ''} aria-label="Ansvarig"><option value="">Ingen</option>{b.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                <button className="secondary small">Spara</button>
              </form>)}</td>
            <td>{r.state !== 'done' && (
              <form action={completeTask.bind(null, firm.id)}>
                <input type="hidden" name="company_id" value={r.companyId} />
                {r.taskId ? <input type="hidden" name="task_id" value={r.taskId} /> : <input type="hidden" name="deadline_key" value={r.deadlineKey ?? ''} />}
                <button className="secondary small">Klar</button>
              </form>)}</td>
          </tr>))}
          {!b.rows.length && <tr><td colSpan={6} className="muted">Inga uppgifter.</td></tr>}
        </tbody>
      </table>
      {clients.length > 0 && (
        <form action={addTask.bind(null, firm.id)} className="card stack add-task" style={{ marginTop: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Ny uppgift</h2>
          <label>Kund<select name="company_id" defaultValue={companyId ?? clients[0].id}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Uppgift<input name="title" required maxLength={200} placeholder="T.ex. Hämta in underlag för bilförmån" /></label>
          <label>Datum<input type="date" name="due" required defaultValue={addDays(today(), 7)} /></label>
          <label>Ansvarig<select name="assignee" defaultValue={user.id}><option value="">Ingen</option>{b.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <button>Lägg till uppgiften</button>
        </form>
      )}
    </div>
  );
}
