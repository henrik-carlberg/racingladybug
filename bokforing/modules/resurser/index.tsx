import Link from 'next/link';
import { sql } from '@/lib/db';
import type { ModuleDefinition, ModulePageProps } from '@/lib/modules/types';
import { addDays, kr, today } from '@/lib/format';
import { isoWeek, monthName, previousMonth, weekStart } from '@/lib/time';
import * as svc from './service';
import * as a from './actions';
import { KINDS } from './calc';

const krIn = (ore: number) => (ore ? (ore / 100).toFixed(2).replace('.', ',').replace(/,00$/, '') : '');
const DAYS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];

function Nav({ basePath }: { basePath: string }) {
  return <p className="small"><Link href={basePath}>Kalender</Link> · <Link href={`${basePath}/ledigt`}>Hitta ledig resurs</Link> · <Link href={`${basePath}/resurser`}>Resurser</Link> · <Link href={`${basePath}/rapport`}>Beläggning och fakturering</Link></p>;
}

async function BookingForm({ companyId, back, resourceId, date, from, to }: { companyId: number; back: string; resourceId?: number; date?: string; from?: string; to?: string }) {
  const [resources, customers, projects] = await Promise.all([
    svc.listResources(companyId, { active: true }),
    sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name`,
    sql<{ id: number; name: string }[]>`SELECT id, name FROM projects WHERE company_id = ${companyId} AND active ORDER BY name`,
  ]);
  if (!resources.length) return null;
  return (
    <form action={a.book.bind(null, companyId, back)} className="card stack">
      <div className="row">
        <label style={{ flex: '2 1 220px' }}>Resurs<select name="resource_id" defaultValue={resourceId}>{resources.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.kind_label}{r.requires_approval ? ', kräver godkännande' : ''})</option>)}</select></label>
        <label>Datum<input type="date" name="date" defaultValue={date ?? today()} required /></label>
        <label>Från<input type="time" name="from" defaultValue={from ?? '09:00'} required /></label>
        <label>Till<input type="time" name="to" defaultValue={to ?? '10:00'} required /></label>
        <label>Slutdatum (flera dagar)<input type="date" name="end_date" /></label>
      </div>
      <div className="row">
        <label style={{ flex: '2 1 220px' }}>Vad gäller bokningen?<input name="title" placeholder="T.ex. Kundmöte, Kurs, Leverans" /></label>
        <label>Kund<select name="customer_id"><option value="">–</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Projekt/uppdrag<select name="project_id"><option value="">–</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Upprepa varje vecka (antal)<input name="repeat_weeks" type="number" min={1} max={52} defaultValue={1} /></label>
      </div>
      <div className="row">
        <label style={{ flex: '3 1 300px' }}>Anteckning<input name="notes" /></label>
        <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" name="billable" /> Faktureras kunden</label>
        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button>Boka</button></div>
      </div>
    </form>
  );
}

async function Calendar({ companyId, actor, basePath, searchParams }: ModulePageProps) {
  const week = weekStart(/^\d{4}-\d{2}-\d{2}$/.test(searchParams.vecka ?? '') ? searchParams.vecka! : today());
  const end = addDays(week, 6);
  const kind = searchParams.typ && KINDS[searchParams.typ] ? searchParams.typ : undefined;
  const [resources, bookings, pending] = await Promise.all([
    svc.listResources(companyId, { kind, active: true }), svc.listBookings(companyId, { from: week, to: end }), svc.listBookings(companyId, { status: 'pending', from: today() }),
  ]);
  const days = [...Array(7)].map((_, i) => addDays(week, i));
  const t = today();
  const back = `${basePath}?vecka=${week}${kind ? `&typ=${kind}` : ''}`;
  return (
    <>
      <div className="header">
        <h1>Resursbokning</h1>
        <div className="actions" style={{ margin: 0 }}>
          <Link className="btn secondary" href={`${basePath}?vecka=${addDays(week, -7)}${kind ? `&typ=${kind}` : ''}`}>← v. {isoWeek(addDays(week, -7))}</Link>
          <Link className="btn secondary" href={`${basePath}${kind ? `?typ=${kind}` : ''}`}>Denna vecka</Link>
          <Link className="btn secondary" href={`${basePath}?vecka=${addDays(week, 7)}${kind ? `&typ=${kind}` : ''}`}>v. {isoWeek(addDays(week, 7))} →</Link>
        </div>
      </div>
      <Nav basePath={basePath} />
      <p className="small">{[['', 'Alla'], ...Object.entries(KINDS)].map(([k, l], i) => (
        <span key={k}>{i > 0 && ' · '}{(kind ?? '') === k ? <b>{l}</b> : <Link href={`${basePath}?vecka=${week}${k ? `&typ=${k}` : ''}`}>{l}</Link>}</span>
      ))}</p>
      {pending.length > 0 && actor.role === 'owner' && (
        <div className="card">
          <b>{pending.length} bokningar väntar på godkännande</b>
          <table className="small"><tbody>{pending.map((b) => (
            <tr key={b.id}><td>{b.date} {b.from}–{b.to}</td><td>{b.resource}</td><td>{b.title}</td><td>{b.booked_by}</td>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>
                <form action={a.setStatus.bind(null, companyId, b.id, 'confirmed', !!b.series_id, back)} style={{ display: 'inline' }}><button className="link">Godkänn{b.series_id ? ' serien' : ''}</button></form>
                <form action={a.setStatus.bind(null, companyId, b.id, 'cancelled', !!b.series_id, back)} style={{ display: 'inline', marginLeft: '.6rem' }}><button className="link">Neka</button></form>
              </td></tr>
          ))}</tbody></table>
        </div>
      )}
      {resources.length === 0 ? (
        <div className="card"><p>Lägg först upp de resurser som ska kunna bokas – lokaler, utrustning, fordon eller personer.</p><Link className="btn" href={`${basePath}/resurser`}>Lägg upp resurs</Link></div>
      ) : (
        <div className="table-wrap"><table style={{ tableLayout: 'fixed', minWidth: 900 }}>
          <thead><tr><th style={{ width: 150 }}>Vecka {isoWeek(week)}</th>{days.map((d, i) => <th key={d} style={d === t ? { color: 'var(--ok)' } : undefined}>{DAYS[i]} {d.slice(8)}/{Number(d.slice(5, 7))}</th>)}</tr></thead>
          <tbody>{resources.map((r) => (
            <tr key={r.id}>
              <td><b>{r.name}</b><div className="small muted">{r.kind_label}{r.capacity ? ` · ${r.capacity} pers.` : ''}</div></td>
              {days.map((d) => {
                const list = bookings.filter((b) => b.resource_id === r.id && b.start.slice(0, 10) <= d && b.end.slice(0, 10) >= d && !(b.end.slice(0, 10) === d && b.end.slice(11) === '00:00' && b.start.slice(0, 10) < d));
                return (
                  <td key={d} style={{ verticalAlign: 'top', padding: '.3rem' }}>
                    {list.map((b) => (
                      <div key={b.id} className="small" title={`${b.title} – ${b.booked_by}${b.customer ? ` – ${b.customer}` : ''}`}
                        style={{ background: b.status === 'pending' ? 'var(--warn-bg, #fef3c7)' : 'var(--ok-bg, #dcfce7)', borderRadius: 4, padding: '.15rem .3rem', marginBottom: '.2rem', overflow: 'hidden' }}>
                        <Link href={`${basePath}/bokning/${b.id}`}>{b.start.slice(0, 10) === d ? b.from : '…'}–{b.end.slice(0, 10) === d ? b.end.slice(11) : '…'}</Link> {b.title}
                      </div>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <h2>Ny bokning</h2>
      <BookingForm companyId={companyId} back={back} date={week <= t && t <= end ? t : week} />
    </>
  );
}

async function Booking({ companyId, actor, basePath, params }: ModulePageProps) {
  const b = await svc.getBooking(companyId, Number(params.id));
  const back = `${basePath}/bokning/${b.id}`;
  const STATUS = { pending: ['Väntar på godkännande', 'warn'], confirmed: ['Bekräftad', 'ok'], cancelled: ['Avbokad', ''] } as const;
  return (
    <>
      <h1>{b.title} <span className={`badge ${STATUS[b.status][1]}`}>{STATUS[b.status][0]}</span></h1>
      <Nav basePath={basePath} />
      <div className="card">
        <p><b>{b.resource}</b> · {b.date} {b.from}–{b.to} ({String(b.hours).replace('.', ',')} h)</p>
        <p className="small">Bokad av {b.booked_by}{b.customer && <> · kund {b.customer}</>}{b.project && <> · projekt {b.project}</>}{b.series_id && ' · del av en återkommande serie'}</p>
        {b.notes && <p className="small">{b.notes}</p>}
        {b.billable && <p className="small">Faktureras: {kr(b.price)} kr exkl. moms{b.invoice_id && <> · <Link href={`/c/${companyId}/fakturor/${b.invoice_id}`}>fakturerad</Link></>}</p>}
      </div>
      {b.status !== 'cancelled' && !b.invoice_id && (
        <div className="actions">
          {b.status === 'pending' && actor.role === 'owner' && <form action={a.setStatus.bind(null, companyId, b.id, 'confirmed', !!b.series_id, back)}><button>Godkänn{b.series_id ? ' serien' : ''}</button></form>}
          <form action={a.setStatus.bind(null, companyId, b.id, 'cancelled', false, back)}><button className="secondary">Avboka</button></form>
          {b.series_id && <form action={a.setStatus.bind(null, companyId, b.id, 'cancelled', true, back)}><button className="link">Avboka denna och kommande i serien</button></form>}
        </div>
      )}
      <p><Link href={`${basePath}?vecka=${weekStart(b.date)}`}>← Till veckan</Link></p>
    </>
  );
}

async function Find({ companyId, basePath, searchParams }: ModulePageProps) {
  const d = searchParams.datum ?? today(), from = searchParams.fran ?? '09:00', to = searchParams.till ?? '10:00';
  let list: Awaited<ReturnType<typeof svc.available>> = [];
  let error = '';
  try { list = await svc.available(companyId, { date: d, from, to, kind: searchParams.typ ?? '', capacity: searchParams.antal ?? '' }); } catch (e) { error = (e as Error).message; }
  const free = list.filter((r) => r.free);
  return (
    <>
      <h1>Hitta ledig resurs</h1>
      <Nav basePath={basePath} />
      <form className="card row">
        <label>Datum<input type="date" name="datum" defaultValue={d} /></label>
        <label>Från<input type="time" name="fran" defaultValue={from} /></label>
        <label>Till<input type="time" name="till" defaultValue={to} /></label>
        <label>Typ<select name="typ" defaultValue={searchParams.typ ?? ''}><option value="">Alla</option>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Antal personer<input name="antal" type="number" min={1} defaultValue={searchParams.antal ?? ''} /></label>
        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Sök</button></div>
      </form>
      {error && <div className="flash error">{error}</div>}
      <div className="table-wrap"><table>
        <thead><tr><th>Resurs</th><th>Typ</th><th>Plats</th><th className="num">Kapacitet</th><th>Status</th></tr></thead>
        <tbody>{list.map((r) => (
          <tr key={r.id} style={r.free ? undefined : { opacity: 0.55 }}>
            <td><b>{r.name}</b></td><td>{r.kind_label}</td><td className="small">{r.location}</td><td className="num">{r.capacity ?? ''}</td>
            <td>{r.free ? <span className="badge ok">Ledig</span> : <span className="small">Upptagen: {r.busy.join(', ')}</span>}</td>
          </tr>
        ))}{list.length === 0 && !error && <tr><td colSpan={5} className="muted">Inga resurser matchar.</td></tr>}</tbody>
      </table></div>
      {free.length > 0 && (<>
        <h2>Boka</h2>
        <BookingForm companyId={companyId} back={`${basePath}?vecka=${weekStart(d)}`} resourceId={free[0].id} date={d} from={from} to={to} />
      </>)}
    </>
  );
}

async function Resources({ companyId, basePath }: ModulePageProps) {
  const resources = await svc.listResources(companyId);
  const Form = ({ r }: { r?: svc.ResourceOut }) => (
    <form action={a.saveResource.bind(null, companyId, r?.id ?? null)} className="card stack">
      <div className="row">
        <label style={{ flex: '2 1 220px' }}>Namn<input name="name" defaultValue={r?.name} required placeholder="T.ex. Konferensrum Ek" /></label>
        <label>Typ<select name="kind" defaultValue={r?.kind ?? 'room'}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Plats<input name="location" defaultValue={r?.location} /></label>
        <label>Kapacitet (pers.)<input name="capacity" type="number" min={0} defaultValue={r?.capacity ?? ''} /></label>
      </div>
      <div className="row">
        <label>Timpris (kr)<input name="price_hour" defaultValue={krIn(r?.price_hour ?? 0)} inputMode="decimal" /></label>
        <label>Dagpris (kr)<input name="price_day" defaultValue={krIn(r?.price_day ?? 0)} inputMode="decimal" /></label>
        <label>Moms<select name="vat_rate" defaultValue={String(r?.vat_rate ?? 25)}><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option><option value="0">0 %</option></select></label>
        <label>Bokningsbar från<input type="time" name="open_from" defaultValue={r?.open_from ?? '07:00'} /></label>
        <label>till<input type="time" name="open_to" defaultValue={r?.open_to ?? '18:00'} /></label>
      </div>
      <label>Beskrivning<input name="description" defaultValue={r?.description} /></label>
      <div className="row">
        <label className="check"><input type="checkbox" name="requires_approval" defaultChecked={r?.requires_approval} /> Bokningar kräver ägarens godkännande</label>
        {r && <label className="check"><input type="checkbox" name="active" defaultChecked={r.active} /> Aktiv</label>}
        <div style={{ flex: '0 0 auto' }}><button className={r ? 'secondary' : ''}>{r ? 'Spara' : 'Lägg upp resurs'}</button></div>
      </div>
    </form>
  );
  return (
    <>
      <h1>Resurser</h1>
      <Nav basePath={basePath} />
      {resources.map((r) => <details key={r.id} className="card" style={{ padding: '.6rem 1rem' }}>
        <summary><b>{r.name}</b> <span className="small muted">{r.kind_label}{r.location ? ` · ${r.location}` : ''}{r.capacity ? ` · ${r.capacity} pers.` : ''}
          {r.price_hour ? ` · ${kr(r.price_hour)} kr/h` : ''}{r.price_day ? ` · ${kr(r.price_day)} kr/dag` : ''}{!r.active ? ' · inaktiv' : ''}</span></summary>
        <Form r={r} />
      </details>)}
      <h2>Ny resurs</h2>
      <Form />
    </>
  );
}

async function Report({ companyId, basePath, searchParams }: ModulePageProps) {
  const period = /^\d{4}-\d{2}$/.test(searchParams.manad ?? '') ? searchParams.manad! : today().slice(0, 7);
  const [rows, uninvoiced] = await Promise.all([svc.utilizationReport(companyId, period), svc.listBookings(companyId, { uninvoiced: true, status: 'confirmed', to: today() })]);
  const byCustomer = new Map<number, { name: string; n: number; amount: number }>();
  for (const b of uninvoiced.filter((x) => x.customer_id && x.end.slice(0, 10) <= today())) {
    const c = byCustomer.get(b.customer_id!) ?? { name: b.customer!, n: 0, amount: 0 };
    c.n++; c.amount += b.price; byCustomer.set(b.customer_id!, c);
  }
  return (
    <>
      <h1>Beläggning och fakturering</h1>
      <Nav basePath={basePath} />
      <p className="small"><Link href={`${basePath}/rapport?manad=${previousMonth(period + '-01')}`}>← {monthName(previousMonth(period + '-01'))}</Link> · <b>{monthName(period)}</b></p>
      <div className="table-wrap"><table>
        <thead><tr><th>Resurs</th><th className="num">Bokningar</th><th className="num">Bokade timmar</th><th>Beläggning</th><th className="num">Att fakturera</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}><td>{r.name}</td><td className="num">{r.bookings}</td><td className="num">{String(r.hours).replace('.', ',')} h</td>
            <td><span style={{ display: 'inline-block', width: 90, height: 8, background: 'var(--border)', borderRadius: 4, verticalAlign: 'middle', marginRight: 6 }}>
              <span style={{ display: 'block', width: `${Math.min(100, r.utilization)}%`, height: 8, background: 'var(--ok)', borderRadius: 4 }} /></span>{String(r.utilization).replace('.', ',')} %</td>
            <td className="num">{r.revenue ? kr(r.revenue) : ''}</td></tr>
        ))}</tbody>
      </table></div>
      <p className="small muted">Beläggning = bokade timmar av bokningsbar tid (öppettid × vardagar i månaden).</p>
      <h2>Ofakturerade bokningar</h2>
      {byCustomer.size === 0 ? <p className="muted">Inga genomförda bokningar att fakturera.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Kund</th><th className="num">Bokningar</th><th className="num">Belopp exkl. moms</th><th></th></tr></thead>
          <tbody>{[...byCustomer.entries()].map(([id, c]) => (
            <tr key={id}><td>{c.name}</td><td className="num">{c.n}</td><td className="num">{kr(c.amount)}</td>
              <td className="num"><form action={a.invoice.bind(null, companyId)}><input type="hidden" name="customer_id" value={id} /><input type="hidden" name="to" value={today()} /><button className="link">Skapa faktura</button></form></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

export const resurser: ModuleDefinition = {
  id: 'resurser',
  name: 'Resursbokning',
  version: '0.1.0',
  description: 'Boka lokaler, utrustning, fordon och personer med veckokalender, krockkontroll, återkommande bokningar, godkännande, sökning efter lediga resurser, beläggning och fakturering.',
  nav: [{ label: 'Kalender', path: '' }, { label: 'Hitta ledig resurs', path: 'ledigt' }, { label: 'Resurser', path: 'resurser' }, { label: 'Beläggning', path: 'rapport' }],
  pages: { '': Calendar, ledigt: Find, resurser: Resources, 'bokning/:id': Booking, rapport: Report },
  scopes: [
    { scope: 'resurser:read', description: 'Läsa resurser, bokningar och lediga tider' },
    { scope: 'resurser:write', description: 'Boka och avboka resurser' },
  ],
  events: [{ type: 'resurser.booking.created', description: 'En eller flera bokningar har gjorts' }],
  api: [
    { method: 'GET', path: '/resources', scope: 'resurser:read', tag: 'Resursbokning', summary: 'Lista resurser',
      handler: async ({ actor }) => ({ object: 'list', has_more: false, data: await svc.listResources(actor.companyId, { active: true }) }) },
    { method: 'GET', path: '/bookings', scope: 'resurser:read', tag: 'Resursbokning', summary: 'Lista bokningar',
      query: [{ name: 'from', description: 'Datum från' }, { name: 'to', description: 'Datum till' }, { name: 'resource_id', description: 'Resurs' }],
      handler: async ({ actor, query }) => ({ object: 'list', has_more: false, data: await svc.listBookings(actor.companyId, {
        from: query.get('from') ?? undefined, to: query.get('to') ?? undefined, resource_id: query.get('resource_id') ? Number(query.get('resource_id')) : undefined }) }) },
    { method: 'GET', path: '/availability', scope: 'resurser:read', tag: 'Resursbokning', summary: 'Lediga resurser för en tid',
      query: [{ name: 'date', description: 'Datum' }, { name: 'from', description: 'TT:MM' }, { name: 'to', description: 'TT:MM' }, { name: 'kind', description: 'room, equipment, vehicle, person, other' }],
      handler: async ({ actor, query }) => ({ object: 'list', has_more: false, data: await svc.available(actor.companyId, Object.fromEntries(query.entries())) }) },
    { method: 'POST', path: '/bookings', scope: 'resurser:write', tag: 'Resursbokning', status: 201, summary: 'Boka (krock ger 409)',
      body: { type: 'object', required: ['resource_id', 'date', 'from', 'to'], properties: { resource_id: { type: 'integer' }, date: { type: 'string', format: 'date' }, end_date: { type: 'string', format: 'date' },
        from: { type: 'string', description: 'TT:MM' }, to: { type: 'string', description: 'TT:MM' }, title: { type: 'string' }, customer_id: { type: 'integer' }, project_id: { type: 'integer' },
        billable: { type: 'boolean' }, repeat_weeks: { type: 'integer' }, notes: { type: 'string' } } },
      handler: async ({ actor, body }) => ({ object: 'list', has_more: false, data: await svc.createBooking(actor, body) }) },
    { method: 'POST', path: '/bookings/:id/cancel', scope: 'resurser:write', tag: 'Resursbokning', summary: 'Avboka', body: { type: 'object' },
      handler: async ({ actor, params }) => { await svc.setStatus(actor, Number(params.id), 'cancelled'); return svc.getBooking(actor.companyId, Number(params.id)); } },
  ],
  on: {
    'invoice.credited': async (e, tx) => {
      const c = e.data as { credit_of_id: number | null };
      if (c.credit_of_id) await svc.onInvoiceCredited(tx, e.companyId, c.credit_of_id);
    },
  },
};
