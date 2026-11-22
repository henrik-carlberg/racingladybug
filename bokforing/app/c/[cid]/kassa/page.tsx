import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { requestOrigin } from '@/lib/server/origin';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { PAYMENT_LABEL, RATES, type PaymentMethod } from '@/lib/shop';
import { listCashReports, listConnections, listOrders } from '@/lib/services/shop';
import { listCostCenters } from '@/lib/services/dimensions';
import { cashReport, connect, toggle } from './actions';

export const dynamic = 'force-dynamic';

export default async function Sales({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const [reports, conns, orders, ccs, origin] = await Promise.all([listCashReports(company.id), listConnections(company.id), listOrders(company.id), listCostCenters(company.id, true), requestOrigin()]);
  const b = `/c/${company.id}`;
  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="header"><h1>Kassa och e-handel</h1><div className="row" style={{ flex: '0 0 auto' }}><Link className="btn secondary" href={`${b}/kassa/register`}>Kassaregister och kontrollenheter</Link><Link className="btn secondary" href={`${b}/kassa/betalningar`}>Kortterminaler och utbetalningar</Link></div></div>
      <Flash searchParams={searchParams} />

      <h2>Dagskassa</h2>
      <p className="small muted">Bokför dagens försäljning från kassaregistrets Z-rapport: försäljning inklusive moms per momssats och hur kunderna betalade. Kortbetalningar bokförs mot 1580 tills kortinlösaren betalar ut.</p>
      <form action={cashReport.bind(null, company.id)} className="card stack">
        <div className="row">
          <label style={{ flex: '0 0 170px' }}>Datum<input type="date" name="date" defaultValue={today()} required /></label>
          <label>Kassa<input name="register" defaultValue="Kassa 1" /></label>
          <label>Z-rapportnummer<input name="z_number" /></label>
          {ccs.length > 0 && <label>Kostnadsställe<select name="cost_center_id" defaultValue=""><option value="">–</option>{ccs.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>}
        </div>
        <div className="row">{RATES.map((r) => <label key={r}>Försäljning {r} % (inkl. moms)<input name={`sales_${r}`} inputMode="decimal" /></label>)}</div>
        <div className="row">{(Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((m) => <label key={m}>{PAYMENT_LABEL[m]}<input name={`pay_${m}`} inputMode="decimal" /></label>)}</div>
        <label className="check"><input type="checkbox" name="allow_diff" /> Kassadifferens (bokför skillnad upp till 100 kr på 3740)</label>
        <div><button>Bokför dagskassa</button></div>
      </form>
      {reports.length > 0 && (
        <table className="small"><thead><tr><th>Datum</th><th>Kassa</th><th>Z-nr</th><th className="num">Försäljning</th><th></th></tr></thead><tbody>{reports.map((r) => (
          <tr key={r.id}><td>{r.date}</td><td>{r.register}</td><td>{r.z_number}</td><td className="num">{kr(Object.values(r.data.gross).reduce((s, v) => s + Number(v), 0))}</td>
            <td><Link href={`${b}/verifikationer/${r.voucher_id}`}>verifikation</Link></td></tr>
        ))}</tbody></table>
      )}

      <h2 id="ehandel">E-handel</h2>
      <p className="small muted">Koppla webbutiken så att betalda order bokförs automatiskt: betalningen mot 1580 (eller kontot du väljer), försäljning och moms per momssats. Utbetalningen från betalväxeln (Shopify Payments, Klarna, Stripe m.fl.) stäms av mot 1580 i bankavstämningen.
        Returer och återbetalningar bokförs för hand.</p>
      {conns.map((c) => (
        <div key={c.id} className="card small">
          <b>{c.name}</b> <span className="badge">{c.platform === 'shopify' ? 'Shopify' : 'WooCommerce'}</span> {c.active ? <span className="badge ok">Aktiv</span> : <span className="badge">Pausad</span>}
          <div style={{ margin: '.4rem 0' }}>Webhook-adress: <code className="shop-url">{`${origin}/api/shop/${c.path_token}`}</code></div>
          <div className="muted">{c.platform === 'shopify' ? 'Shopify: Inställningar → Aviseringar → Webhooks → Skapa webhook, händelse "Orderbetalning" (orders/paid), format JSON.'
            : 'WooCommerce: Inställningar → Avancerat → Webhooks → Lägg till, ämne "Order uppdaterad", leveransadress ovan och hemligheten du fick.'} {c.orders} order bokförda{c.last_order ? `, senast ${c.last_order}` : ''}.</div>
          <form action={toggle.bind(null, company.id, c.id, !c.active)}><button className="link">{c.active ? 'Pausa' : 'Aktivera'}</button></form>
        </div>
      ))}
      <form action={connect.bind(null, company.id)} className="card stack">
        <div className="row">
          <label style={{ flex: '0 0 170px' }}>Plattform<select name="platform"><option value="shopify">Shopify</option><option value="woocommerce">WooCommerce</option></select></label>
          <label>Namn<input name="name" placeholder="T.ex. Webbutiken" /></label>
          <label style={{ flex: '2 1 260px' }}>Signeringshemlighet (Shopify: från Shopify. WooCommerce: lämna tomt så skapas en)<input name="secret" autoComplete="off" /></label>
          {ccs.length > 0 && <label>Kostnadsställe<select name="cost_center_id" defaultValue=""><option value="">–</option>{ccs.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>}
        </div>
        <div><button className="secondary">Koppla butik</button></div>
      </form>
      {orders.length > 0 && (
        <>
          <h3>Senaste order</h3>
          <table className="small"><thead><tr><th>Butik</th><th>Order</th><th>Datum</th><th className="num">Belopp</th><th className="num">Moms</th><th>Status</th></tr></thead><tbody>{orders.map((o) => (
            <tr key={o.id}><td>{o.shop}</td><td>{o.number}</td><td>{o.order_date}</td><td className="num">{kr(o.total)} {o.currency !== 'SEK' ? o.currency : ''}</td><td className="num">{kr(o.vat)}</td>
              <td>{o.status === 'booked' ? <Link href={`${b}/verifikationer/${o.voucher_id}`}>Bokförd</Link> : <span className="badge warn" title={o.message}>{o.status === 'skipped' ? 'Ej bokförd' : 'Fel'}</span>} <span className="muted">{o.message}</span></td></tr>
          ))}</tbody></table>
        </>
      )}
    </div>
  );
}
