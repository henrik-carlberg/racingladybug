import Link from 'next/link';
import { sql } from '@/lib/db';
import type { ModuleDefinition, ModulePageProps } from '@/lib/modules/types';
import { page as pageParams } from '@/lib/services/input';
import { getCustomer } from '@/lib/services/customers';
import { kr, today } from '@/lib/format';
import { KINDS, createActivity, createContact, listActivities, listContacts, logSystemActivity, updateActivity } from './service';
import { addActivity, addContact, completeTask } from './actions';
import { CustomerDeals, Deal, Forecast, Nav, Pipeline, Stages } from './pipeline-pages';
import * as pl from './pipeline';
import { onQuoteSigned } from './pipeline';

// ---------- Sidor ----------

async function Overview({ companyId, basePath }: ModulePageProps) {
  const customers = await sql<{ id: number; name: string; open: number; last: string | null; tasks: number }[]>`
    SELECT c.id, c.name,
      COALESCE((SELECT SUM(total) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'booked'), 0)::bigint AS open,
      (SELECT to_char(max(created_at) AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD') FROM crm_activities a WHERE a.customer_id = c.id) AS last,
      (SELECT count(*) FROM crm_activities a WHERE a.customer_id = c.id AND a.kind = 'task' AND NOT a.done)::int AS tasks
    FROM customers c WHERE c.company_id = ${companyId} ORDER BY c.name`;
  const tasks = (await listActivities(companyId, { limit: 50, startingAfter: null }, { open_tasks: true })).data;
  return (
    <>
      <h1>CRM</h1>
      <Nav basePath={basePath} />
      {tasks.length > 0 && (
        <>
          <h2>Öppna uppgifter</h2>
          <table><tbody>{tasks.map((t) => (
            <tr key={t.id}><td>{t.due_date ?? ''}</td><td><Link href={`${basePath}/kund/${t.customer_id}`}>{t.subject}</Link></td>
              <td className="num"><form action={completeTask.bind(null, companyId, basePath, t.id)}><button className="link">Klar</button></form></td></tr>
          ))}</tbody></table>
        </>
      )}
      <h2>Kunder</h2>
      <table>
        <thead><tr><th>Kund</th><th className="num">Obetalt</th><th>Senaste aktivitet</th><th className="num">Öppna uppgifter</th></tr></thead>
        <tbody>{customers.map((c) => (
          <tr key={c.id}><td><Link href={`${basePath}/kund/${c.id}`}>{c.name}</Link></td><td className="num">{c.open ? kr(c.open) : ''}</td>
            <td>{c.last ?? ''}</td><td className="num">{c.tasks || ''}</td></tr>
        ))}</tbody>
      </table>
    </>
  );
}

async function CustomerView({ companyId, params, basePath }: ModulePageProps) {
  const id = Number(params.id);
  const c = await getCustomer(companyId, id);
  const acts = (await listActivities(companyId, { limit: 200, startingAfter: null }, { customer_id: id })).data;
  const contacts = (await listContacts(companyId, { limit: 100, startingAfter: null }, id)).data;
  return (
    <>
      <h1>{c.name}</h1>
      <p className="muted">{[c.orgnr, c.email, c.city].filter(Boolean).join(' · ')} · <Link href={`/c/${companyId}/kunder/${id}`}>Kunduppgifter</Link></p>
      <CustomerDeals companyId={companyId} customerId={id} basePath={basePath} />
      <h2>Kontaktpersoner</h2>
      {contacts.length > 0 && <table><tbody>{contacts.map((p) => (
        <tr key={p.id}><td>{p.name}</td><td>{p.title}</td><td>{p.email}</td><td>{p.phone}</td></tr>
      ))}</tbody></table>}
      <form action={addContact.bind(null, companyId, id)} className="card row" style={{ marginTop: '.75rem' }}>
        <label>Namn<input name="name" required /></label><label>Titel<input name="title" /></label>
        <label>E-post<input name="email" type="email" /></label><label>Telefon<input name="phone" /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Lägg till</button></div>
      </form>
      <h2>Ny aktivitet</h2>
      <form action={addActivity.bind(null, companyId, id)} className="card stack">
        <div className="row">
          <label style={{ flex: '0 0 160px' }}>Typ<select name="kind">{Object.entries(KINDS).filter(([k]) => k !== 'system').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label style={{ flex: '3 1 300px' }}>Rubrik<input name="subject" required /></label>
          <label style={{ flex: '0 0 180px' }}>Datum (uppgift)<input type="date" name="due_date" /></label>
        </div>
        <label>Anteckning<textarea name="body" rows={3} /></label>
        <div><button>Spara</button></div>
      </form>
      <h2>Tidslinje</h2>
      <table>
        <tbody>{acts.map((a) => (
          <tr key={a.id}>
            <td className="small" style={{ whiteSpace: 'nowrap' }}>{new Date(a.created_at).toLocaleDateString('sv-SE')}</td>
            <td><span className={`badge ${a.kind === 'system' ? '' : 'ok'}`}>{KINDS[a.kind]}</span></td>
            <td><b>{a.subject}</b>{a.body && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div>}
              {a.kind === 'task' && <div className="small">{a.due_date && `Senast ${a.due_date}. `}{a.done ? 'Klar' : (
                <form action={completeTask.bind(null, companyId, `${basePath}/kund/${id}`, a.id)} style={{ display: 'inline' }}><button className="link">Markera som klar</button></form>)}</div>}
            </td>
            <td className="small muted">{a.created_by ?? 'Automatiskt'}</td>
          </tr>
        ))}
        {acts.length === 0 && <tr><td className="muted">Inga aktiviteter ännu. Fakturahändelser loggas automatiskt.</td></tr>}</tbody>
      </table>
      <p className="small muted">Uppdaterad {today()}</p>
    </>
  );
}

// ---------- Moduldefinition ----------

export const crm: ModuleDefinition = {
  id: 'crm',
  name: 'CRM',
  version: '0.1.0',
  description: 'Säljpipeline med affärer, offerter som e-signeras, prognos och analys – plus kontaktpersoner, anteckningar, uppgifter och tidslinje per kund. Fakturor loggas automatiskt.',
  nav: [{ label: 'Säljpipeline', path: 'pipeline' }, { label: 'Prognos och analys', path: 'prognos' }, { label: 'Kunder', path: '' }],
  pages: { '': Overview, 'kund/:id': CustomerView, pipeline: Pipeline, 'affar/:id': Deal, prognos: Forecast, steg: Stages },
  scopes: [
    { scope: 'crm:read', description: 'Läsa CRM-aktiviteter och kontakter' },
    { scope: 'crm:write', description: 'Skapa och ändra CRM-aktiviteter och kontakter' },
  ],
  events: [
    { type: 'crm.activity.created', description: 'En CRM-aktivitet har skapats manuellt eller via API' },
    { type: 'crm.deal.created', description: 'En affär har lagts upp i säljpipelinen' },
    { type: 'crm.deal.won', description: 'En affär har vunnits (t.ex. när kunden signerat offerten)' },
    { type: 'crm.deal.lost', description: 'En affär har förlorats' },
  ],
  api: [
    { method: 'GET', path: '/deals', scope: 'crm:read', tag: 'CRM', summary: 'Lista affärer', query: [{ name: 'kind', description: 'open, won eller lost' }],
      handler: async ({ actor, query }) => ({ object: 'list', has_more: false, data: await pl.listDeals(actor.companyId, { kind: query.get('kind') ?? undefined }) }) },
    { method: 'GET', path: '/deals/:id', scope: 'crm:read', tag: 'CRM', summary: 'Hämta affär med offertrader', handler: ({ actor, params }) => pl.getDeal(actor.companyId, Number(params.id)) },
    { method: 'POST', path: '/deals', scope: 'crm:write', tag: 'CRM', status: 201, summary: 'Skapa affär',
      body: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, customer_id: { type: 'integer' }, prospect_name: { type: 'string' }, contact_name: { type: 'string' },
        contact_email: { type: 'string' }, value: { type: 'integer', description: 'öre exkl. moms' }, expected_close: { type: 'string', format: 'date' }, stage_id: { type: 'integer' },
        owner_user_id: { type: 'integer' }, source: { type: 'string' }, next_step: { type: 'string' } } },
      handler: ({ actor, body }) => pl.createDeal(actor, body) },
    { method: 'POST', path: '/deals/:id/stage', scope: 'crm:write', tag: 'CRM', summary: 'Flytta affär till steg (lost_reason krävs för förlorad)',
      body: { type: 'object', required: ['stage_id'], properties: { stage_id: { type: 'integer' }, lost_reason: { type: 'string' } } },
      handler: ({ actor, params, body }) => pl.moveDeal(actor, Number(params.id), body) },
    { method: 'GET', path: '/pipeline/report', scope: 'crm:read', tag: 'CRM', summary: 'Prognos per månad, vinstandel och förlustorsaker', handler: ({ actor }) => pl.report(actor.companyId) },
    {
      method: 'GET', path: '/activities', scope: 'crm:read', tag: 'CRM', summary: 'Lista aktiviteter',
      query: [{ name: 'customer_id', description: 'Filtrera på kund' }, { name: 'open_tasks', description: 'true = endast öppna uppgifter' }],
      handler: ({ actor, query }) => listActivities(actor.companyId, pageParams(query), {
        customer_id: query.get('customer_id') ? Number(query.get('customer_id')) : null, open_tasks: query.get('open_tasks') === 'true',
      }),
    },
    {
      method: 'POST', path: '/activities', scope: 'crm:write', tag: 'CRM', summary: 'Skapa aktivitet', status: 201,
      body: { type: 'object', required: ['subject'], properties: {
        customer_id: { type: 'integer' }, kind: { type: 'string', enum: ['note', 'call', 'meeting', 'email', 'task'] },
        subject: { type: 'string' }, body: { type: 'string' }, due_date: { type: 'string', format: 'date' } } },
      handler: ({ actor, body }) => createActivity(actor, body),
    },
    {
      method: 'PATCH', path: '/activities/:id', scope: 'crm:write', tag: 'CRM', summary: 'Uppdatera aktivitet (t.ex. markera uppgift klar)',
      body: { type: 'object', properties: { done: { type: 'boolean' }, subject: { type: 'string' }, body: { type: 'string' } } },
      handler: ({ actor, params, body }) => updateActivity(actor, Number(params.id), body),
    },
    {
      method: 'GET', path: '/contacts', scope: 'crm:read', tag: 'CRM', summary: 'Lista kontaktpersoner',
      query: [{ name: 'customer_id', description: 'Filtrera på kund' }],
      handler: ({ actor, query }) => listContacts(actor.companyId, pageParams(query), query.get('customer_id') ? Number(query.get('customer_id')) : null),
    },
    {
      method: 'POST', path: '/contacts', scope: 'crm:write', tag: 'CRM', summary: 'Skapa kontaktperson', status: 201,
      body: { type: 'object', required: ['customer_id', 'name'], properties: {
        customer_id: { type: 'integer' }, name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, title: { type: 'string' } } },
      handler: ({ actor, body }) => createContact(actor, body),
    },
  ],
  on: {
    'document.completed': async (e, tx) => {
      const d = e.data as { source_module: string | null; source_id: number | null };
      if (d.source_module === 'crm' && d.source_id) await onQuoteSigned(tx, e.companyId, d.source_id);
    },
    'customer.created': async (e, tx) => {
      const c = e.data as { id: number };
      await logSystemActivity(tx, e.companyId, c.id, 'Kunden skapades', e.id);
    },
    'invoice.booked': async (e, tx) => {
      const i = e.data as { customer_id: number; number: number; total: number; due_date: string };
      await logSystemActivity(tx, e.companyId, i.customer_id, `Faktura ${i.number} bokförd, ${kr(i.total)} kr, förfaller ${i.due_date}`, e.id);
    },
    'invoice.paid': async (e, tx) => {
      const i = e.data as { customer_id: number; number: number; total: number; paid_date: string };
      await logSystemActivity(tx, e.companyId, i.customer_id, `Faktura ${i.number} betald ${i.paid_date}, ${kr(i.total)} kr`, e.id);
    },
    'invoice.credited': async (e, tx) => {
      const i = e.data as { customer_id: number; number: number; total: number };
      await logSystemActivity(tx, e.companyId, i.customer_id, `Kreditfaktura ${i.number} utfärdad, ${kr(i.total)} kr`, e.id);
    },
  },
};
