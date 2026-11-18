import Link from 'next/link';
import { sql } from '@/lib/db';
import type { ModuleDefinition, ModulePageProps } from '@/lib/modules/types';
import { kr, today } from '@/lib/format';
import * as svc from './service';
import * as a from './actions';

const members = (companyId: number) => sql<{ id: number; name: string }[]>`SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ${companyId} ORDER BY u.name`;
const Badge = ({ s }: { s: string }) => <span className={`badge ${s === 'done' ? 'ok' : s === 'cancelled' ? 'danger' : s === 'in_progress' ? 'warn' : ''}`}>{svc.STATUS[s]}</span>;

async function List({ companyId, actor, basePath, searchParams }: ModulePageProps) {
  const status = searchParams.status ?? 'open';
  const mine = searchParams.mine === '1';
  const [orders, customers, users] = await Promise.all([
    svc.listOrders(companyId, { status: status === 'all' ? undefined : status, assignee: mine ? actor.userId ?? undefined : undefined }),
    sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name`, members(companyId),
  ]);
  return (
    <>
      <h1>Arbetsordrar</h1>
      <p className="small">{[['open', 'Öppna'], ['done', 'Klara att fakturera'], ['invoiced', 'Fakturerade'], ['all', 'Alla']].map(([k, l], i) => (
        <span key={k}>{i > 0 && ' · '}{status === k ? <b>{l}</b> : <Link href={`${basePath}?status=${k}${mine ? '&mine=1' : ''}`}>{l}</Link>}</span>
      ))} · {mine ? <Link href={`${basePath}?status=${status}`}>Alla ansvariga</Link> : <Link href={`${basePath}?status=${status}&mine=1`}>Mina</Link>}</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Nr</th><th>Rubrik</th><th>Kund</th><th>Datum</th><th>Ansvarig</th><th>Status</th><th className="num">Belopp exkl. moms</th></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}><td>{o.number}</td><td><Link href={`${basePath}/o/${o.id}`}>{o.title}</Link></td><td>{o.customer}</td><td>{o.scheduled_date ?? ''}</td>
              <td className="small">{o.assignee ?? ''}</td><td><Badge s={o.status} /></td><td className="num">{kr(o.net)}</td></tr>
          ))}
          {orders.length === 0 && <tr><td colSpan={7} className="muted">Inga arbetsordrar.</td></tr>}
        </tbody>
      </table></div>
      <h2>Ny arbetsorder</h2>
      <form action={a.create.bind(null, companyId)} className="card stack">
        <div className="row">
          <label style={{ flex: '2 1 260px' }}>Rubrik<input name="title" required placeholder="T.ex. Byte av blandare" /></label>
          <label>Kund<select name="customer_id" required><option value="">Välj kund…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        </div>
        <div className="row">
          <label style={{ flex: '2 1 260px' }}>Adress för jobbet<input name="address" /></label>
          <label>Datum<input type="date" name="scheduled_date" /></label>
          <label>Ansvarig<select name="assignee_user_id"><option value="">–</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        </div>
        <label>Beskrivning<textarea name="description" rows={2} /></label>
        <div><button>Skapa arbetsorder</button></div>
      </form>
    </>
  );
}

async function OrderPage({ companyId, basePath, params }: ModulePageProps) {
  const o = await svc.getOrder(companyId, Number(params.id));
  const users = await members(companyId);
  const locked = o.status === 'invoiced' && !!o.invoice_id || o.status === 'cancelled';
  const labour = o.items.filter((i) => i.kind === 'labor' || i.kind === 'ata').reduce((s, i) => s + svc.itemNet(i), 0);
  return (
    <>
      <div className="header">
        <h1>Arbetsorder {o.number}: {o.title} <Badge s={o.status} /></h1>
        <div className="actions" style={{ margin: 0 }}><Link className="btn secondary" href={basePath}>Tillbaka</Link></div>
      </div>
      <p>{o.customer}{o.address && <> · {o.address}</>}{o.scheduled_date && <> · {o.scheduled_date}</>}{o.assignee && <> · {o.assignee}</>}</p>
      {o.invoice_id && <div className="card small">Fakturerad: <Link href={`/c/${companyId}/fakturor/${o.invoice_id}`}>{o.invoice_number ? `faktura ${o.invoice_number}` : 'fakturautkast'}</Link></div>}

      <h2>Tid och material</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Typ</th><th>Datum</th><th>Beskrivning</th><th className="num">Antal</th><th className="num">À-pris</th><th className="num">Moms</th><th className="num">Belopp</th><th></th></tr></thead>
        <tbody>
          {o.items.map((i) => (
            <tr key={i.id}><td>{svc.KIND[i.kind]}</td><td className="small">{i.date}</td><td>{i.description}{i.user_name && <span className="small muted"> ({i.user_name})</span>}{i.kind === 'ata' && <div className="small muted">Godkänt av {i.approved_by}</div>}</td>
              <td className="num">{String(i.quantity).replace('.', ',')} {i.unit}</td><td className="num">{kr(i.unit_price)}</td><td className="num">{i.vat_rate} %</td><td className="num">{kr(svc.itemNet(i))}</td>
              <td>{!locked && <form action={a.removeItem.bind(null, companyId, o.id, i.id)}><button className="link">Ta bort</button></form>}</td></tr>
          ))}
          {o.items.length === 0 && <tr><td colSpan={8} className="muted">Inga rader än.</td></tr>}
          {o.items.length > 0 && <tr className="sum"><td colSpan={6}><b>Summa exkl. moms</b>{labour > 0 && <span className="small muted"> – varav arbete {kr(labour)}</span>}</td><td className="num"><b>{kr(o.net)}</b></td><td /></tr>}
        </tbody>
      </table></div>
      {!locked && (
        <form action={a.addItem.bind(null, companyId, o.id)} className="card row" style={{ alignItems: 'end' }}>
          <label style={{ flex: '0 0 120px' }}>Typ<select name="kind">{Object.entries(svc.KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label style={{ flex: '2 1 220px' }}>Beskrivning<input name="description" required /></label>
          <label style={{ flex: '0 0 90px' }}>Antal<input name="quantity" inputMode="decimal" required /></label>
          <label style={{ flex: '0 0 80px' }}>Enhet<input name="unit" placeholder="h / st" /></label>
          <label style={{ flex: '0 0 120px' }}>À-pris exkl. moms<input name="unit_price" inputMode="decimal" required /></label>
          <label style={{ flex: '0 0 90px' }}>Moms<select name="vat_rate" defaultValue="25"><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option><option value="0">0 %</option></select></label>
          <label style={{ flex: '0 0 150px' }}>Datum<input type="date" name="date" defaultValue={today()} /></label>
          <label style={{ flex: '0 0 180px' }}>Godkänt av (ÄTA)<input name="approved_by" placeholder="Beställarens namn" /></label>
          <div style={{ flex: '0 0 auto' }}><button className="secondary">Lägg till</button></div>
        </form>
      )}

      {!locked && (
        <>
          <h2>Arbetsorder</h2>
          <form action={a.save.bind(null, companyId, o.id)} className="card stack">
            <div className="row">
              <label style={{ flex: '2 1 260px' }}>Rubrik<input name="title" defaultValue={o.title} required /></label>
              <label>Status<select name="status" defaultValue={o.status}>{Object.entries(svc.STATUS).filter(([k]) => k !== 'invoiced').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            </div>
            <div className="row">
              <label style={{ flex: '2 1 260px' }}>Adress<input name="address" defaultValue={o.address} /></label>
              <label>Datum<input type="date" name="scheduled_date" defaultValue={o.scheduled_date ?? ''} /></label>
              <label>Ansvarig<select name="assignee_user_id" defaultValue={o.assignee_user_id ?? ''}><option value="">–</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
            </div>
            <label>Beskrivning<textarea name="description" rows={2} defaultValue={o.description} /></label>
            <label>Arbetsrapport (vad som gjordes – kommer med på fakturan)<textarea name="report" rows={3} defaultValue={o.report} /></label>
            <div><button className="secondary">Spara</button></div>
          </form>
          {!o.signed_at && o.items.length > 0 && (
            <form action={a.sign.bind(null, companyId, o.id)} className="card row" style={{ alignItems: 'end' }}>
              <label style={{ flex: '2 1 260px' }}>Kundens namn (godkänner utfört arbete på plats)<input name="signed_by" required /></label>
              <div style={{ flex: '0 0 auto' }}><button className="secondary">Godkänn och markera klar</button></div>
            </form>
          )}
        </>
      )}
      {o.signed_at && <p className="small">Godkänd av {o.signed_by} {o.signed_at}.</p>}
      {!o.invoice_id && o.status !== 'cancelled' && o.items.length > 0 && (
        <form action={a.invoice.bind(null, companyId, o.id)} className="card actions">
          <button>Skapa faktura</button>
          <span className="small muted">Raderna blir ett fakturautkast till {o.customer}. Arbete markeras som arbetskostnad så att ROT/RUT kan läggas till.</span>
        </form>
      )}
    </>
  );
}

export const arbetsorder: ModuleDefinition = {
  id: 'arbetsorder',
  name: 'Arbetsordrar',
  version: '0.1.0',
  description: 'Jobb hos kund med planering, ansvarig, tid och material, arbetsrapport och kundens godkännande på plats – blir en faktura med ett klick (arbete markeras för ROT/RUT).',
  nav: [{ label: 'Arbetsordrar', path: '' }],
  pages: { '': List, 'o/:id': OrderPage },
  events: [
    { type: 'arbetsorder.created', description: 'En arbetsorder har skapats' },
    { type: 'arbetsorder.invoiced', description: 'En arbetsorder har fakturerats' },
  ],
};
