import Link from 'next/link';
import { sql } from '@/lib/db';
import type { ModuleDefinition, ModulePageProps } from '@/lib/modules/types';
import { kr, today } from '@/lib/format';
import { isModuleEnabled } from '@/lib/modules/enabled';
import * as svc from './service';
import * as a from './actions';
import { INTERVALS } from './calc';

const krIn = (ore: number) => (ore ? (ore / 100).toFixed(2).replace('.', ',').replace(/,00$/, '') : '');
const STATUS: Record<string, [string, string]> = { active: ['Aktivt', 'ok'], paused: ['Pausat', 'warn'], ended: ['Avslutat', ''] };

function Nav({ basePath }: { basePath: string }) {
  return <p className="small"><Link href={basePath}>Avtal</Link> · <Link href={`${basePath}/nytt`}>Nytt avtal</Link></p>;
}

async function ContractForm({ companyId, c }: { companyId: number; c?: svc.ContractOut }) {
  const customers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name`;
  const rows = [...(c?.lines ?? []), ...Array(8).fill(null)].slice(0, Math.max(4, (c?.lines.length ?? 0) + 2)) as (svc.ContractLine | null)[];
  return (
    <form action={c ? a.update.bind(null, companyId, c.id) : a.create.bind(null, companyId)} className="card stack">
      <div className="row">
        <label>Kund<select name="customer_id" defaultValue={c?.customer_id} disabled={!!c}>{customers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        {c && <input type="hidden" name="customer_id" value={c.customer_id} />}
        <label style={{ flex: '2 1 240px' }}>Avtal<input name="name" defaultValue={c?.name} required placeholder="T.ex. Supportavtal, Hosting, Licens" /></label>
        <label>Er referens<input name="your_reference" defaultValue={c?.your_reference} /></label>
      </div>
      <div className="row">
        <label>Startdatum<input type="date" name="start_date" defaultValue={c?.start_date ?? today()} required disabled={!!c?.invoices.length} /></label>
        {c?.invoices.length ? <input type="hidden" name="start_date" value={c.start_date} /> : null}
        <label>Fakturering<select name="interval_months" defaultValue={String(c?.interval_months ?? 1)}>{Object.entries(INTERVALS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Faktureras<select name="timing" defaultValue={c?.in_advance === false ? 'arrears' : 'advance'}><option value="advance">I förskott (periodens början)</option><option value="arrears">I efterskott (efter perioden)</option></select></label>
        <label>Slutdatum (bindningstid)<input type="date" name="end_date" defaultValue={c?.end_date ?? ''} /></label>
      </div>
      <div className="row">
        <label>Uppsägningstid (månader)<input name="notice_months" type="number" min={0} defaultValue={c?.notice_months ?? 3} /></label>
        <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" name="auto_renew" defaultChecked={c?.auto_renew ?? true} /> Förlängs automatiskt</label>
        <label>med (månader)<input name="renewal_months" type="number" min={1} defaultValue={c?.renewal_months ?? 12} /></label>
        <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" name="auto_book" defaultChecked={c?.auto_book} /> Bokför fakturorna direkt</label>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Beskrivning</th><th className="num">Antal</th><th>Enhet</th><th className="num">Pris per period (kr)</th><th>Moms</th></tr></thead>
        <tbody>{rows.map((l, i) => (
          <tr key={i}>
            <td><input name={`d_${i}`} defaultValue={l?.description} aria-label={`Rad ${i + 1}`} /></td>
            <td className="num"><input name={`q_${i}`} defaultValue={l ? String(l.quantity).replace('.', ',') : ''} inputMode="decimal" style={{ maxWidth: '5rem', textAlign: 'right' }} aria-label="Antal" /></td>
            <td><input name={`u_${i}`} defaultValue={l?.unit ?? 'st'} style={{ maxWidth: '5rem' }} aria-label="Enhet" /></td>
            <td className="num"><input name={`p_${i}`} defaultValue={l ? krIn(l.unit_price) : ''} inputMode="decimal" style={{ maxWidth: '8rem', textAlign: 'right' }} aria-label="Pris" /></td>
            <td><select name={`v_${i}`} defaultValue={String(l?.vat_rate ?? 25)} aria-label="Moms"><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option><option value="0">0 %</option></select></td>
          </tr>
        ))}</tbody>
      </table></div>
      <label>Anteckningar<input name="notes" defaultValue={c?.notes} /></label>
      <div><button>{c ? 'Spara avtal' : 'Skapa avtal'}</button></div>
    </form>
  );
}

async function Overview({ companyId, basePath, searchParams }: ModulePageProps) {
  const [list, st, renewals] = await Promise.all([svc.listContracts(companyId, { status: searchParams.status }), svc.stats(companyId), svc.upcomingRenewals(companyId)]);
  return (
    <>
      <div className="header">
        <h1>Avtal och abonnemang</h1>
        <div className="actions" style={{ margin: 0 }}>
          <Link className="btn" href={`${basePath}/nytt`}>Nytt avtal</Link>
          <form action={a.generate.bind(null, companyId, null)}><button className="secondary">Fakturera förfallna perioder</button></form>
        </div>
      </div>
      <div className="grid">
        <div className="card stat"><div className="label">Aktiva avtal</div><div className="value">{st.active}</div></div>
        <div className="card stat"><div className="label">Återkommande intäkt per månad (MRR)</div><div className="value">{kr(st.mrr)}</div></div>
        <div className="card stat"><div className="label">Per år (ARR)</div><div className="value">{kr(st.arr)}</div></div>
        <div className="card stat"><div className="label">Att fakturera idag</div><div className="value">{st.due}</div><div className="small muted">körs också automatiskt varje natt</div></div>
      </div>
      {renewals.length > 0 && (
        <div className="card">
          <b>Uppsägning/förnyelse inom 90 dagar</b>
          <ul className="small">{renewals.map((c) => <li key={c.id}><Link href={`${basePath}/a/${c.id}`}>{c.customer_name} – {c.name}</Link>: sista uppsägningsdag {c.notice_deadline}, löper till {c.end_date}{c.auto_renew ? ' (förlängs automatiskt)' : ''}</li>)}</ul>
        </div>
      )}
      <p className="small">{[['', 'Alla'], ['active', 'Aktiva'], ['paused', 'Pausade'], ['ended', 'Avslutade']].map(([k, l], i) => (
        <span key={k}>{i > 0 && ' · '}{(searchParams.status ?? '') === k ? <b>{l}</b> : <Link href={`${basePath}${k ? `?status=${k}` : ''}`}>{l}</Link>}</span>
      ))}</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Kund</th><th>Avtal</th><th>Fakturering</th><th>Nästa faktura</th><th>Löper till</th><th>Status</th><th className="num">Per period</th><th className="num">MRR</th></tr></thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.id}>
              <td>{c.customer_name}</td><td><Link href={`${basePath}/a/${c.id}`}>{c.name}</Link></td><td className="small">{c.interval_label}, {c.in_advance ? 'förskott' : 'efterskott'}</td>
              <td style={c.status === 'active' && c.next_invoice_date <= today() ? { color: 'var(--danger)' } : undefined}>{c.status === 'active' ? c.next_invoice_date : '–'}</td>
              <td className="small">{c.end_date ?? 'Tills vidare'}</td><td><span className={`badge ${STATUS[c.status][1]}`}>{STATUS[c.status][0]}</span></td>
              <td className="num">{kr(c.period_net)}</td><td className="num">{c.mrr ? kr(c.mrr) : ''}</td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={8} className="muted">Inga avtal.</td></tr>}
        </tbody>
      </table></div>
      <form action={a.adjust.bind(null, companyId)} className="card row" style={{ marginTop: '.75rem' }}>
        <label>Prisjustering för alla aktiva avtal (%)<input name="percent" inputMode="decimal" placeholder="T.ex. 3,5" required /></label>
        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Justera priser</button></div>
        <span className="small muted" style={{ alignSelf: 'end' }}>T.ex. årlig indexuppräkning. Gäller från nästa faktura – meddela kunderna enligt avtalet.</span>
      </form>
    </>
  );
}

async function NewContract({ companyId, basePath }: ModulePageProps) {
  return (<><h1>Nytt avtal</h1><Nav basePath={basePath} /><ContractForm companyId={companyId} /></>);
}

async function Contract({ companyId, basePath, params }: ModulePageProps) {
  const c = await svc.getContract(companyId, Number(params.id));
  const crm = await isModuleEnabled(companyId, 'crm');
  return (
    <>
      <div className="header">
        <h1>{c.name} <span className="muted" style={{ fontWeight: 400 }}>· {c.customer_name}</span> <span className={`badge ${STATUS[c.status][1]}`}>{STATUS[c.status][0]}</span></h1>
        <div className="actions" style={{ margin: 0 }}><Link className="btn secondary" href={basePath}>Alla avtal</Link></div>
      </div>
      <div className="grid">
        <div className="card stat"><div className="label">Per period ({c.interval_label.toLowerCase()})</div><div className="value">{kr(c.period_net)}</div><div className="small muted">MRR {kr(c.mrr)} kr</div></div>
        <div className="card stat"><div className="label">Nästa faktura</div><div className="value" style={{ fontSize: '1.2rem' }}>{c.status === 'active' ? c.next_invoice_date : '–'}</div><div className="small muted">period från {c.next_period_start}</div></div>
        <div className="card stat"><div className="label">Löper till</div><div className="value" style={{ fontSize: '1.2rem' }}>{c.end_date ?? 'Tills vidare'}</div>
          <div className="small muted">{c.notice_deadline ? `säg upp senast ${c.notice_deadline}` : `${c.notice_months} mån uppsägning`}{c.auto_renew ? ` · förlängs ${c.renewal_months} mån` : ''}</div></div>
      </div>
      <div className="actions">
        {c.status === 'active' && <form action={a.generate.bind(null, companyId, c.id)}><button>Fakturera förfallna perioder</button></form>}
        {c.status === 'active' && <form action={a.status.bind(null, companyId, c.id, 'paused')}><button className="secondary">Pausa</button></form>}
        {c.status === 'paused' && <form action={a.status.bind(null, companyId, c.id, 'active')}><button className="secondary">Återuppta</button></form>}
        {crm && c.status === 'active' && <form action={a.renewal.bind(null, companyId, c.id)}><button className="secondary">Skapa förnyelseaffär i CRM</button></form>}
      </div>
      {c.status !== 'ended' && (
        <form action={a.terminate.bind(null, companyId, c.id)} className="card row">
          <label>Uppsägning mottagen<input type="date" name="notice_date" defaultValue={today()} /></label>
          <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Registrera uppsägning</button></div>
          <span className="small muted" style={{ alignSelf: 'end' }}>Avtalet löper då ut efter {c.notice_months} månader{c.end_date ? `, men tidigast ${c.end_date}` : ''}, och förlängs inte.</span>
        </form>
      )}
      <h2>Fakturerade perioder</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Period</th><th>Faktura</th><th>Status</th><th className="num">Belopp</th></tr></thead>
        <tbody>{c.invoices.map((i) => (
          <tr key={i.period_start}><td>{i.period_start} – {i.period_end}</td>
            <td>{i.invoice_id ? <Link href={`/c/${companyId}/fakturor/${i.invoice_id}`}>{i.number ?? 'Utkast'}</Link> : 'Borttagen'}</td>
            <td className="small">{i.status ?? ''}</td><td className="num">{i.total != null ? kr(i.total) : ''}</td></tr>
        ))}{c.invoices.length === 0 && <tr><td colSpan={4} className="muted">Inga fakturor ännu.</td></tr>}</tbody>
      </table></div>
      <h2>Avtalsvillkor</h2>
      <ContractForm companyId={companyId} c={c} />
    </>
  );
}

export const avtal: ModuleDefinition = {
  id: 'avtal',
  name: 'Avtal och abonnemang',
  version: '0.1.0',
  description: 'Avtal och abonnemang som faktureras automatiskt per månad, kvartal, halvår eller år, i förskott eller efterskott. Bindningstid, uppsägning, automatisk förlängning, prisjustering och MRR/ARR.',
  nav: [{ label: 'Avtal', path: '' }, { label: 'Nytt avtal', path: 'nytt' }],
  pages: { '': Overview, nytt: NewContract, 'a/:id': Contract },
  scopes: [
    { scope: 'avtal:read', description: 'Läsa avtal och återkommande intäkter' },
    { scope: 'avtal:write', description: 'Skapa och ändra avtal och skapa fakturor från dem' },
  ],
  events: [{ type: 'avtal.contract.created', description: 'Ett avtal har skapats' }],
  api: [
    { method: 'GET', path: '/contracts', scope: 'avtal:read', tag: 'Avtal', summary: 'Lista avtal', query: [{ name: 'status', description: 'active, paused, ended' }],
      handler: async ({ actor, query }) => ({ object: 'list', has_more: false, data: await svc.listContracts(actor.companyId, { status: query.get('status') ?? undefined }) }) },
    { method: 'GET', path: '/contracts/:id', scope: 'avtal:read', tag: 'Avtal', summary: 'Hämta avtal', handler: ({ actor, params }) => svc.getContract(actor.companyId, Number(params.id)) },
    { method: 'POST', path: '/contracts', scope: 'avtal:write', tag: 'Avtal', status: 201, summary: 'Skapa avtal (priser i öre per period)',
      body: { type: 'object', required: ['customer_id', 'name', 'start_date', 'lines'], properties: {
        customer_id: { type: 'integer' }, name: { type: 'string' }, start_date: { type: 'string', format: 'date' }, end_date: { type: 'string', format: 'date' },
        interval_months: { type: 'integer', enum: [1, 3, 6, 12] }, in_advance: { type: 'boolean' }, notice_months: { type: 'integer' }, auto_renew: { type: 'boolean' },
        renewal_months: { type: 'integer' }, auto_book: { type: 'boolean' },
        lines: { type: 'array', items: { type: 'object', required: ['description', 'unit_price'], properties: { description: { type: 'string' }, quantity: { type: 'number' }, unit: { type: 'string' }, unit_price: { type: 'integer' }, vat_rate: { type: 'integer' } } } } } },
      handler: ({ actor, body }) => svc.createContract(actor, body) },
    { method: 'POST', path: '/contracts/generate', scope: 'avtal:write', tag: 'Avtal', summary: 'Skapa fakturor för förfallna perioder', body: { type: 'object', properties: { date: { type: 'string', format: 'date' } } },
      handler: async ({ actor, body }) => ({ invoice_ids: await svc.generateDue(actor, typeof body.date === 'string' ? body.date : undefined) }) },
  ],
};
