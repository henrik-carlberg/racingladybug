import Link from 'next/link';
import { sql } from '@/lib/db';
import type { ModuleDefinition, ModulePageProps } from '@/lib/modules/types';
import { today } from '@/lib/format';
import * as hr from './service';
import { OFFBOARDING_REASONS, PROCESS_LABEL } from './templates';
import { cancel, complete, move, offboarding, onboarding, saveProfile, toggleTask } from './actions';

// ---------- Hjälpkomponenter ----------

async function employeesOf(companyId: number) {
  return sql<{ id: number; name: string; active: boolean; title: string; department: string; manager: string | null; start: string | null; end: string | null; email: string }[]>`
    SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.active, COALESCE(h.title,'') AS title, COALESCE(h.department,'') AS department,
      m.first_name || ' ' || m.last_name AS manager, to_char(e.employment_start,'YYYY-MM-DD') AS start, to_char(e.employment_end,'YYYY-MM-DD') AS end, e.email
    FROM employees e LEFT JOIN hr_profiles h ON h.employee_id = e.id LEFT JOIN employees m ON m.id = h.manager_employee_id
    WHERE e.company_id = ${companyId} ORDER BY e.last_name, e.first_name`;
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <span className="small" title={`${done}/${total}`}>
      <span style={{ display: 'inline-block', width: 80, height: 8, background: 'var(--border)', borderRadius: 4, verticalAlign: 'middle', marginRight: 6 }}>
        <span style={{ display: 'block', width: `${pct}%`, height: 8, background: 'var(--ok)', borderRadius: 4 }} />
      </span>{done}/{total}
    </span>
  );
}

const DOC_STATUS: Record<string, string> = { draft: 'Utkast', pending: 'Väntar på signering', completed: 'Signerat', declined: 'Avböjt', cancelled: 'Återkallat' };

// ---------- Sidor ----------

async function Overview({ companyId, basePath }: ModulePageProps) {
  const open = await hr.listProcesses(companyId, { status: 'open' });
  const people = await employeesOf(companyId);
  const t = today();
  return (
    <>
      <div className="header">
        <h1>HR</h1>
        <div className="actions" style={{ margin: 0 }}>
          <Link className="btn" href={`${basePath}/ny/onboarding`}>Ny medarbetare</Link>
          <Link className="btn secondary" href={`${basePath}/ny/forflyttning`}>Förflyttning</Link>
          <Link className="btn secondary" href={`${basePath}/ny/offboarding`}>Offboarding</Link>
        </div>
      </div>
      <h2>Pågående processer</h2>
      <table>
        <thead><tr><th>Medarbetare</th><th>Process</th><th>Datum</th><th>Avtal</th><th>Checklista</th></tr></thead>
        <tbody>
          {open.map((p) => (
            <tr key={p.id}>
              <td><Link href={`${basePath}/process/${p.id}`}>{p.employee_name}</Link></td>
              <td>{p.type_label}</td><td>{p.effective_date}</td>
              <td className="small">{p.document_status ? DOC_STATUS[p.document_status] : '–'}</td>
              <td><Progress {...p.progress} /> {p.tasks.some((x) => !x.done && x.due_date && x.due_date < t) && <span className="badge danger">Försenad</span>}</td>
            </tr>
          ))}
          {open.length === 0 && <tr><td colSpan={5} className="muted">Inga pågående processer.</td></tr>}
        </tbody>
      </table>
      <h2>Medarbetare</h2>
      <table>
        <thead><tr><th>Namn</th><th>Befattning</th><th>Avdelning</th><th>Chef</th><th>Anställd</th></tr></thead>
        <tbody>{people.map((e) => (
          <tr key={e.id} style={e.active ? undefined : { opacity: 0.6 }}>
            <td><Link href={`${basePath}/medarbetare/${e.id}`}>{e.name}</Link></td><td>{e.title}</td><td>{e.department}</td><td>{e.manager ?? ''}</td>
            <td className="small">{e.start ?? ''}{e.end ? ` – ${e.end}` : ''}{!e.active && <> <span className="badge">Ej aktiv i lön</span></>}</td>
          </tr>
        ))}</tbody>
      </table>
    </>
  );
}

async function NewOnboarding({ companyId }: ModulePageProps) {
  const people = await employeesOf(companyId);
  return (
    <>
      <h1>Ny medarbetare – onboarding</h1>
      <form action={onboarding.bind(null, companyId)} className="stack">
        <div className="card stack">
          <b>Personuppgifter</b>
          <div className="row">
            <label>Förnamn<input name="first_name" required /></label><label>Efternamn<input name="last_name" required /></label>
            <label>Personnummer<input name="personal_number" required placeholder="ÅÅÅÅMMDD-NNNN" /></label>
          </div>
          <div className="row">
            <label>E-post (för avtal)<input name="email" type="email" required /></label><label>Telefon<input name="phone" /></label>
          </div>
          <div className="row">
            <label style={{ flex: '2 1 240px' }}>Adress<input name="address" /></label><label>Postnummer<input name="postal_code" /></label><label>Ort<input name="city" /></label>
          </div>
        </div>
        <div className="card stack">
          <b>Anställning</b>
          <div className="row">
            <label>Befattning<input name="title" required /></label><label>Avdelning<input name="department" /></label>
            <label>Närmaste chef<select name="manager_employee_id"><option value="">–</option>{people.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          </div>
          <div className="row">
            <label>Startdatum<input type="date" name="employment_start" required /></label>
            <label>Anställningsform<select name="employment_type"><option value="tillsvidare">Tillsvidare</option><option value="provanstallning">Provanställning</option><option value="visstid">Särskild visstid</option></select></label>
            <label>Slutdatum (visstid)<input type="date" name="employment_end" /></label>
          </div>
          <div className="row">
            <label>Månadslön (kr)<input name="monthly_salary" required inputMode="decimal" /></label>
            <label>Skattetabell<input name="tax_table" type="number" min={29} max={42} defaultValue={32} required /></label>
            <label>Kolumn<input name="tax_column" type="number" min={1} max={7} defaultValue={1} /></label>
            <label>Semesterdagar<input name="vacation_days" type="number" defaultValue={25} /></label>
          </div>
          <div className="row">
            <label>Clearingnr<input name="bank_clearing" /></label><label>Kontonummer<input name="bank_account" /></label>
          </div>
          <div className="row">
            <label>Arbetstid<input name="working_hours" placeholder="Heltid, 40 timmar per vecka" /></label>
            <label>Arbetsplats<input name="workplace" /></label>
            <label>Kollektivavtal<input name="collective_agreement" placeholder="T.ex. Tjänstemannaavtalet" /></label>
          </div>
          <label>Övriga villkor (valfritt)<textarea name="other" rows={2} /></label>
        </div>
        <label className="check"><input type="checkbox" name="send_contract" defaultChecked /> Skapa anställningsavtal och skicka för e-signering (du signerar för arbetsgivaren)</label>
        <div><button>Starta onboarding</button></div>
        <p className="small muted" style={{ margin: 0 }}>Medarbetaren läggs upp i lönen som inaktiv och aktiveras när onboardingen slutförs. Avtalsmallen innehåller uppgifterna som krävs enligt LAS 6 c § – kontrollera mot ert kollektivavtal.</p>
      </form>
    </>
  );
}

async function NewMove({ companyId }: ModulePageProps) {
  const people = (await employeesOf(companyId)).filter((p) => p.active);
  return (
    <>
      <h1>Förflyttning / ändrade villkor</h1>
      <form action={move.bind(null, companyId)} className="card stack">
        <div className="row">
          <label>Medarbetare<select name="employee_id" required>{people.map((p) => <option key={p.id} value={p.id}>{p.name} – {p.title || 'ingen befattning'}</option>)}</select></label>
          <label>Gäller från<input type="date" name="effective_date" required /></label>
        </div>
        <div className="row">
          <label>Ny befattning<input name="new_title" /></label><label>Ny avdelning<input name="new_department" /></label>
          <label>Ny chef<select name="new_manager_employee_id"><option value="">Oförändrat</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Ny månadslön (kr)<input name="new_monthly_salary" inputMode="decimal" placeholder="Oförändrad" /></label>
        </div>
        <label>Bakgrund (valfritt)<input name="reason" /></label>
        <label className="check"><input type="checkbox" name="send_document" defaultChecked /> Skicka ändring av anställningsvillkor för e-signering</label>
        <div><button>Starta förflyttning</button></div>
        <p className="small muted" style={{ margin: 0 }}>Ändringarna förs över till lönen och personaluppgifterna när processen slutförs.</p>
      </form>
    </>
  );
}

async function NewOffboarding({ companyId }: ModulePageProps) {
  const people = (await employeesOf(companyId)).filter((p) => p.active && !p.end);
  return (
    <>
      <h1>Offboarding</h1>
      <form action={offboarding.bind(null, companyId)} className="card stack">
        <div className="row">
          <label>Medarbetare<select name="employee_id" required>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Sista anställningsdag<input type="date" name="last_day" required /></label>
          <label>Besked lämnat<input type="date" name="notice_date" defaultValue={today()} /></label>
        </div>
        <label>Orsak<select name="reason" required>{Object.entries(OFFBOARDING_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Anteckningar (valfritt)<textarea name="notes" rows={2} /></label>
        <label className="check"><input type="checkbox" name="send_document" defaultChecked /> Skicka bekräftelse av anställningens upphörande för e-signering</label>
        <div><button>Starta offboarding</button></div>
        <p className="small muted" style={{ margin: 0 }}>Obs! Uppsägning från arbetsgivarens sida kräver ett skriftligt uppsägningsbesked enligt LAS 8 § (och i förekommande fall förhandling med facket) – bekräftelsen ersätter inte det.
          Sista anställningsdag förs över till lönen när processen slutförs; slutlönen körs i ordinarie lönekörning.</p>
      </form>
    </>
  );
}

async function ProcessView({ companyId, params, basePath }: ModulePageProps) {
  const p = await hr.getProcess(companyId, Number(params.id));
  const t = today();
  const d = p.data as Record<string, unknown>;
  return (
    <>
      <div className="header">
        <h1>{p.type_label}: {p.employee_name}</h1>
        <span className={`badge ${p.status === 'completed' ? 'ok' : p.status === 'cancelled' ? '' : 'warn'}`}>{p.status === 'open' ? 'Pågår' : p.status === 'completed' ? 'Slutförd' : 'Avbruten'}</span>
      </div>
      <div className="card grid">
        <div><div className="muted small">{p.type === 'offboarding' ? 'Sista dag' : p.type === 'onboarding' ? 'Startdatum' : 'Gäller från'}</div>{p.effective_date}</div>
        <div><div className="muted small">Startad av</div>{p.created_by}</div>
        <div><div className="muted small">Checklista</div><Progress {...p.progress} /></div>
        {p.document_id && <div><div className="muted small">Avtal</div><Link href={`/c/${companyId}/dokument/${p.document_id}`}>{DOC_STATUS[p.document_status ?? ''] ?? p.document_status}</Link></div>}
        {p.type === 'offboarding' && <div><div className="muted small">Orsak</div>{OFFBOARDING_REASONS[String(d.reason)] ?? String(d.reason)}</div>}
      </div>
      {p.type === 'move' && Array.isArray(d.changes) && (
        <table><thead><tr><th>Ändring</th><th>Tidigare</th><th>Nytt</th></tr></thead>
          <tbody>{(d.changes as { label: string; from: string; to: string }[]).map((c) => <tr key={c.label}><td>{c.label}</td><td>{c.from}</td><td><b>{c.to}</b></td></tr>)}</tbody></table>
      )}
      <h2>Checklista</h2>
      <table>
        <thead><tr><th></th><th>Uppgift</th><th>Ansvarig</th><th>Senast</th><th>Klar</th></tr></thead>
        <tbody>{p.tasks.map((x) => (
          <tr key={x.id} style={x.done ? { opacity: 0.6 } : undefined}>
            <td>{p.status === 'open' && !x.auto_key ? (
              <form action={toggleTask.bind(null, companyId, p.id, x.id, !x.done)}><button className="link" aria-label={x.done ? 'Ångra' : 'Markera som klar'}>{x.done ? '☑' : '☐'}</button></form>
            ) : x.done ? '☑' : '☐'}</td>
            <td>{x.title}{x.auto_key && <div className="small muted">Bockas av automatiskt när avtalet är signerat</div>}</td>
            <td><span className="badge">{x.responsible}</span></td>
            <td className="small" style={!x.done && x.due_date && x.due_date < t ? { color: 'var(--danger)' } : undefined}>{x.due_date}</td>
            <td className="small">{x.done ? `${x.done_by ?? 'Automatiskt'} ${x.done_at ?? ''}` : ''}</td>
          </tr>
        ))}</tbody>
      </table>
      {p.status === 'open' && (
        <div className="card actions">
          <form action={complete.bind(null, companyId, p.id)} className="row" style={{ alignItems: 'center' }}>
            <div style={{ flex: '0 0 auto' }}><button>Slutför {p.type_label.toLowerCase()}</button></div>
            {p.progress.done < p.progress.total && <label className="check" style={{ flex: '0 0 auto' }}><input type="checkbox" name="force" /> Slutför trots ofärdiga uppgifter</label>}
          </form>
          <form action={cancel.bind(null, companyId, p.id)}><button className="link">Avbryt processen</button></form>
        </div>
      )}
      <p><Link href={basePath}>← Till HR-översikten</Link></p>
    </>
  );
}

async function EmployeeView({ companyId, params, basePath }: ModulePageProps) {
  const id = Number(params.id);
  const prof = await hr.getProfile(companyId, id);
  const people = await employeesOf(companyId);
  const me = people.find((p) => p.id === id)!;
  const processes = await hr.listProcesses(companyId, { employee_id: id });
  const docs = await sql<{ id: number; title: string; status: string }[]>`
    SELECT d.id, d.title, d.status FROM documents d JOIN hr_processes p ON p.document_id = d.id WHERE p.employee_id = ${id} AND d.company_id = ${companyId} ORDER BY d.id DESC`;
  return (
    <>
      <h1>{me.name}</h1>
      <p className="muted">{[prof.title, prof.department, me.email].filter(Boolean).join(' · ')} · <Link href={`/c/${companyId}/lon/anstallda/${id}`}>Lön och skatt</Link></p>
      <form action={saveProfile.bind(null, companyId, id)} className="card stack">
        <div className="row">
          <label>Befattning<input name="title" defaultValue={prof.title} /></label><label>Avdelning<input name="department" defaultValue={prof.department} /></label>
          <label>Chef<select name="manager_employee_id" defaultValue={prof.manager_employee_id ?? ''}><option value="">–</option>{people.filter((p) => p.id !== id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        </div>
        <div className="row">
          <label>Anställningsform<select name="employment_type" defaultValue={prof.employment_type}><option value="tillsvidare">Tillsvidare</option><option value="provanstallning">Provanställning</option><option value="visstid">Särskild visstid</option></select></label>
          <label>Telefon<input name="phone" defaultValue={prof.phone} /></label><label>Anhörig vid nödfall<input name="emergency_contact" defaultValue={prof.emergency_contact} /></label>
        </div>
        <div><button className="secondary">Spara</button></div>
      </form>
      <h2>Historik</h2>
      <table><tbody>{processes.map((p) => (
        <tr key={p.id}><td><Link href={`${basePath}/process/${p.id}`}>{PROCESS_LABEL[p.type]}</Link></td><td>{p.effective_date}</td><td>{p.status === 'completed' ? 'Slutförd' : p.status === 'open' ? 'Pågår' : 'Avbruten'}</td></tr>
      ))}{processes.length === 0 && <tr><td className="muted">Inga processer.</td></tr>}</tbody></table>
      <h2>Avtal</h2>
      <ul>{docs.map((d) => <li key={d.id}><Link href={`/c/${companyId}/dokument/${d.id}`}>{d.title}</Link> – {DOC_STATUS[d.status] ?? d.status}</li>)}</ul>
    </>
  );
}

// ---------- Moduldefinition ----------

const P = { type: 'object' } as const;

export const hrModule: ModuleDefinition = {
  id: 'hr',
  name: 'HR',
  version: '0.1.0',
  description: 'Onboarding, förflyttningar och offboarding med checklistor och avtal som e-signeras. Ändringar förs automatiskt över till lönen.',
  nav: [
    { label: 'Översikt', path: '' },
    { label: 'Ny medarbetare', path: 'ny/onboarding' },
    { label: 'Förflyttning', path: 'ny/forflyttning' },
    { label: 'Offboarding', path: 'ny/offboarding' },
  ],
  pages: {
    '': Overview, 'ny/onboarding': NewOnboarding, 'ny/forflyttning': NewMove, 'ny/offboarding': NewOffboarding,
    'process/:id': ProcessView, 'medarbetare/:id': EmployeeView,
  },
  scopes: [
    { scope: 'hr:read', description: 'Läsa HR-processer och personaluppgifter' },
    { scope: 'hr:write', description: 'Starta och slutföra onboarding, förflyttning och offboarding' },
  ],
  events: [
    { type: 'hr.process.created', description: 'En onboarding, förflyttning eller offboarding har startats' },
    { type: 'hr.process.completed', description: 'En HR-process har slutförts och ändringarna förts över till lönen' },
  ],
  api: [
    { method: 'GET', path: '/processes', scope: 'hr:read', tag: 'HR', summary: 'Lista HR-processer',
      query: [{ name: 'status', description: 'open, completed eller cancelled' }, { name: 'employee_id', description: 'Anställd' }],
      handler: async ({ actor, query }) => ({ object: 'list', has_more: false, data: await hr.listProcesses(actor.companyId, {
        status: query.get('status') ?? undefined, employee_id: query.get('employee_id') ? Number(query.get('employee_id')) : undefined }) }) },
    { method: 'GET', path: '/processes/:id', scope: 'hr:read', tag: 'HR', summary: 'Hämta process med checklista',
      handler: ({ actor, params }) => hr.getProcess(actor.companyId, Number(params.id)) },
    { method: 'POST', path: '/onboarding', scope: 'hr:write', tag: 'HR', status: 201, summary: 'Starta onboarding (skapar anställd och skickar avtal)',
      description: 'Fält som för POST /employees (lön i öre) plus title, department, manager_employee_id, employment_type, employment_start, working_hours, workplace, collective_agreement, send_contract.',
      body: P, handler: ({ actor, body, origin }) => hr.startOnboarding(actor, body, origin) },
    { method: 'POST', path: '/moves', scope: 'hr:write', tag: 'HR', status: 201, summary: 'Starta förflyttning / ändrade villkor',
      body: { type: 'object', required: ['employee_id', 'effective_date'], properties: { employee_id: { type: 'integer' }, effective_date: { type: 'string', format: 'date' },
        new_title: { type: 'string' }, new_department: { type: 'string' }, new_manager_employee_id: { type: 'integer' }, new_monthly_salary: { type: 'integer', description: 'öre' }, reason: { type: 'string' }, send_document: { type: 'boolean' } } },
      handler: ({ actor, body, origin }) => hr.startMove(actor, body, origin) },
    { method: 'POST', path: '/offboarding', scope: 'hr:write', tag: 'HR', status: 201, summary: 'Starta offboarding',
      body: { type: 'object', required: ['employee_id', 'last_day', 'reason'], properties: { employee_id: { type: 'integer' }, last_day: { type: 'string', format: 'date' },
        reason: { type: 'string', enum: Object.keys(OFFBOARDING_REASONS) }, notice_date: { type: 'string', format: 'date' }, notes: { type: 'string' }, send_document: { type: 'boolean' } } },
      handler: ({ actor, body, origin }) => hr.startOffboarding(actor, body, origin) },
    { method: 'POST', path: '/processes/:id/tasks/:task', scope: 'hr:write', tag: 'HR', summary: 'Markera uppgift som klar/ej klar',
      body: { type: 'object', properties: { done: { type: 'boolean', default: true } } },
      handler: ({ actor, params, body }) => hr.setTaskDone(actor, Number(params.id), Number(params.task), body.done !== false) },
    { method: 'POST', path: '/processes/:id/complete', scope: 'hr:write', tag: 'HR', summary: 'Slutför process och för över ändringar till lönen',
      body: { type: 'object', properties: { force: { type: 'boolean', description: 'Slutför trots ofärdiga uppgifter' } } },
      handler: ({ actor, params, body }) => hr.completeProcess(actor, Number(params.id), body) },
    { method: 'POST', path: '/processes/:id/cancel', scope: 'hr:write', tag: 'HR', summary: 'Avbryt process',
      handler: ({ actor, params }) => hr.cancelProcess(actor, Number(params.id)) },
  ],
  on: {
    'document.completed': async (e, tx) => {
      const d = e.data as { id: number; source_module: string | null };
      if (d.source_module === 'hr') await hr.onDocumentCompleted(tx, e.companyId, d.id);
    },
  },
};
