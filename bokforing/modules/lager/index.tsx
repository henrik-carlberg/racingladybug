import Link from 'next/link';
import { sql } from '@/lib/db';
import type { ModuleDefinition, ModulePageProps } from '@/lib/modules/types';
import { PrintButton } from '@/components/PrintButton';
import { kr, today } from '@/lib/format';
import * as svc from './service';
import * as a from './actions';
import { Scanner } from '@/components/Scanner';

const qty = (n: number) => n.toLocaleString('sv-SE', { maximumFractionDigits: 3 });
const krIn = (ore: number) => (ore ? (ore / 100).toFixed(2).replace('.', ',').replace(/,00$/, '') : '');
const PO_STATUS: Record<string, [string, string]> = { draft: ['Utkast', ''], sent: ['Beställd', 'warn'], partial: ['Delvis inlevererad', 'warn'], received: ['Inlevererad', 'ok'], cancelled: ['Makulerad', ''] };
const SO_STATUS: Record<string, [string, string]> = { open: ['Att leverera', 'warn'], shipped: ['Levererad', 'ok'], invoiced: ['Fakturerad', 'ok'], cancelled: ['Makulerad', ''] };
const MOVE: Record<string, string> = { opening: 'Ingående', receipt: 'Inleverans', delivery: 'Leverans', adjustment: 'Inventering/justering', transfer: 'Flytt' };
const Badge = ({ s, map }: { s: string; map: Record<string, [string, string]> }) => <span className={`badge ${map[s]?.[1] ?? ''}`}>{map[s]?.[0] ?? s}</span>;

function Nav({ basePath }: { basePath: string }) {
  const items: [string, string][] = [['', 'Översikt'], ['artiklar', 'Artiklar'], ['inkop', 'Inköp'], ['order', 'Kundorder'], ['inventering', 'Inventering'], ['varde', 'Lagervärde']];
  return <p className="small">{items.map(([p, l], i) => <span key={p}>{i > 0 && ' · '}<Link href={`${basePath}${p ? '/' + p : ''}`}>{l}</Link></span>)}</p>;
}

async function OrderRows({ companyId, price }: { companyId: number; price: 'purchase' | 'sales' }) {
  const products = await svc.listProducts(companyId, { active: true });
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>Artikel</th><th className="num">Antal</th><th className="num">À-pris (kr, tomt = artikelns)</th></tr></thead>
      <tbody>{[...Array(8)].map((_, i) => (
        <tr key={i}>
          <td><select name={`product_${i}`} defaultValue="" aria-label={`Rad ${i + 1} artikel`}>
            <option value="">–</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.sku} {p.name} ({kr(price === 'purchase' ? p.purchase_price : p.sales_price)} kr · {qty(p.available)} {p.unit} tillg.)</option>)}
          </select></td>
          <td className="num"><input name={`qty_${i}`} inputMode="decimal" aria-label={`Rad ${i + 1} antal`} style={{ maxWidth: '6rem', textAlign: 'right' }} /></td>
          <td className="num"><input name={`price_${i}`} inputMode="decimal" aria-label={`Rad ${i + 1} pris`} style={{ maxWidth: '8rem', textAlign: 'right' }} /></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

// ---------- Översikt ----------

async function Overview({ companyId, basePath }: ModulePageProps) {
  const [products, whs, pos, sos, sugg] = await Promise.all([
    svc.listProducts(companyId, { active: true }), svc.warehouses(sql, companyId), svc.listPOs(companyId), svc.listSOs(companyId, { status: 'open' }), svc.suggestions(companyId),
  ]);
  const value = products.reduce((s, p) => s + p.value, 0);
  const openPO = pos.filter((p) => ['draft', 'sent', 'partial'].includes(p.status));
  return (
    <>
      <div className="header">
        <h1>Inköp, lager och logistik</h1>
        <div className="actions" style={{ margin: 0 }}>
          <Link className="btn" href={`${basePath}/order`}>Ny kundorder</Link>
          <Link className="btn secondary" href={`${basePath}/inkop`}>Ny inköpsorder</Link>
        </div>
      </div>
      <Nav basePath={basePath} />
      <div className="grid">
        <div className="card stat"><div className="label"><Link href={`${basePath}/artiklar`}>Artiklar</Link></div><div className="value">{products.length}</div></div>
        <div className="card stat"><div className="label"><Link href={`${basePath}/varde`}>Lagervärde</Link></div><div className="value">{kr(value)}</div></div>
        <div className="card stat"><div className="label"><Link href={`${basePath}/order`}>Order att leverera</Link></div><div className="value">{sos.length}</div></div>
        <div className="card stat"><div className="label"><Link href={`${basePath}/inkop`}>Öppna inköpsorder</Link></div><div className="value">{openPO.length}</div></div>
      </div>
      {sugg.length > 0 && (
        <div className="card">
          <b>{sugg.length} artiklar under beställningspunkten</b>
          <p className="small">{sugg.map((s) => `${s.sku} ${s.name} (tillgängligt ${qty(s.available)}, föreslås ${qty(s.suggested)})`).join(' · ')}</p>
          <Link className="btn secondary" href={`${basePath}/inkop`}>Till beställningsförslaget</Link>
        </div>
      )}
      <h2>Lagerställen</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Lagerställe</th><th>Adress</th><th className="num">Värde</th></tr></thead>
        <tbody>{whs.map((w) => (
          <tr key={w.id}><td><Link href={`${basePath}/inventering?lager=${w.id}`}>{w.name}</Link></td><td className="small">{w.address}</td>
            <td className="num">{kr(products.reduce((s, p) => s + Math.round(Math.max(0, p.stock.find((x) => x.warehouse_id === w.id)?.qty ?? 0) * p.avg_cost), 0))}</td></tr>
        ))}</tbody>
      </table></div>
      <form action={a.addWarehouse.bind(null, companyId)} className="card row" style={{ marginTop: '.5rem' }}>
        <label>Nytt lagerställe<input name="name" required placeholder="T.ex. Butik" /></label>
        <label style={{ flex: '2 1 240px' }}>Adress<input name="address" /></label>
        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Lägg till</button></div>
      </form>
    </>
  );
}

// ---------- Artiklar ----------

async function ProductForm({ companyId, p }: { companyId: number; p?: svc.ProductOut }) {
  const suppliers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM suppliers WHERE company_id = ${companyId} ORDER BY name`;
  const whs = p ? [] : await svc.warehouses(sql, companyId);
  return (
    <form action={a.saveProduct.bind(null, companyId, p?.id ?? null)} className="card stack">
      <div className="row">
        <label>Artikelnummer<input name="sku" defaultValue={p?.sku} required /></label>
        <label style={{ flex: '3 1 280px' }}>Benämning<input name="name" defaultValue={p?.name} required /></label>
        <label>Enhet<input name="unit" defaultValue={p?.unit ?? 'st'} /></label>
      </div>
      <div className="row">
        <label>Inköpspris (kr)<input name="purchase_price" defaultValue={krIn(p?.purchase_price ?? 0)} inputMode="decimal" /></label>
        <label>Försäljningspris exkl. moms (kr)<input name="sales_price" defaultValue={krIn(p?.sales_price ?? 0)} inputMode="decimal" /></label>
        <label>Moms<select name="vat_rate" defaultValue={String(p?.vat_rate ?? 25)}><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option><option value="0">0 %</option></select></label>
      </div>
      <div className="row">
        <label>Leverantör<select name="supplier_id" defaultValue={p?.supplier_id ?? ''}><option value="">–</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Leverantörens artikelnr<input name="supplier_sku" defaultValue={p?.supplier_sku} /></label>
        <label>Streckkod (EAN)<input name="barcode" defaultValue={p?.barcode} inputMode="numeric" /></label>
        <label>Beställningspunkt<input name="reorder_point" defaultValue={p?.reorder_point ? qty(p.reorder_point) : ''} inputMode="decimal" /></label>
        <label>Beställ antal<input name="reorder_qty" defaultValue={p?.reorder_qty ? qty(p.reorder_qty) : ''} inputMode="decimal" /></label>
      </div>
      {!p && (
        <div className="row">
          <label>Ingående lager (antal)<input name="opening_qty" inputMode="decimal" placeholder="0" /></label>
          <label>i lagerställe<select name="warehouse_id">{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        </div>
      )}
      {p && <label className="check"><input type="checkbox" name="active" defaultChecked={p.active} /> Aktiv</label>}
      <div><button>{p ? 'Spara' : 'Lägg upp artikel'}</button></div>
    </form>
  );
}

async function Products({ companyId, basePath, searchParams }: ModulePageProps) {
  const products = await svc.listProducts(companyId, { q: searchParams.q });
  return (
    <>
      <h1>Artiklar</h1>
      <Nav basePath={basePath} />
      <form className="row" style={{ marginBottom: '.5rem' }}><label>Sök<input name="q" defaultValue={searchParams.q ?? ''} placeholder="Artikelnummer eller benämning" /></label></form>
      <div className="table-wrap"><table>
        <thead><tr><th>Art.nr</th><th>Benämning</th><th className="num">I lager</th><th className="num">Reserverat</th><th className="num">Beställt</th><th className="num">Snittpris</th><th className="num">Pris</th><th className="num">Värde</th></tr></thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} style={p.active ? undefined : { opacity: 0.5 }}>
              <td><Link href={`${basePath}/artiklar/${p.id}`}>{p.sku}</Link></td><td>{p.name}</td>
              <td className="num" style={p.reorder_point && p.on_hand + p.on_order - p.reserved < p.reorder_point ? { color: 'var(--danger)' } : undefined}>{qty(p.on_hand)} {p.unit}</td>
              <td className="num">{p.reserved ? qty(p.reserved) : ''}</td><td className="num">{p.on_order ? qty(p.on_order) : ''}</td>
              <td className="num">{kr(Math.round(p.avg_cost))}</td><td className="num">{kr(p.sales_price)}</td><td className="num">{kr(p.value)}</td>
            </tr>
          ))}
          {products.length === 0 && <tr><td colSpan={8} className="muted">Inga artiklar ännu.</td></tr>}
        </tbody>
      </table></div>
      <h2>Ny artikel</h2>
      <ProductForm companyId={companyId} />
    </>
  );
}

async function Product({ companyId, basePath, params }: ModulePageProps) {
  const p = await svc.getProduct(companyId, Number(params.id));
  const [moves, whs] = await Promise.all([svc.productMovements(companyId, p.id), svc.warehouses(sql, companyId)]);
  return (
    <>
      <h1>{p.sku} {p.name}</h1>
      <Nav basePath={basePath} />
      <div className="grid">
        <div className="card stat"><div className="label">I lager</div><div className="value">{qty(p.on_hand)} {p.unit}</div>
          <div className="small muted">{p.stock.map((s) => `${s.warehouse}: ${qty(s.qty)}`).join(' · ')}</div></div>
        <div className="card stat"><div className="label">Tillgängligt</div><div className="value">{qty(p.available)}</div><div className="small muted">reserverat {qty(p.reserved)} · beställt {qty(p.on_order)}</div></div>
        <div className="card stat"><div className="label">Snittpris / värde</div><div className="value">{kr(Math.round(p.avg_cost))}</div><div className="small muted">lagervärde {kr(p.value)} kr</div></div>
      </div>
      <ProductForm companyId={companyId} p={p} />
      {whs.length > 1 && (
        <form action={a.transfer.bind(null, companyId, p.id)} className="card row">
          <label>Flytta från<select name="from">{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label>till<select name="to" defaultValue={whs[1].id}>{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label>Antal<input name="qty" inputMode="decimal" required /></label>
          <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Flytta</button></div>
        </form>
      )}
      <h2>Lagerrörelser</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Datum</th><th>Typ</th><th>Lager</th><th className="num">Antal</th><th className="num">À-värde</th><th>Notering</th><th>Av</th></tr></thead>
        <tbody>{moves.map((m) => (
          <tr key={m.id}><td>{m.date}</td><td>{MOVE[m.type]}</td><td>{m.warehouse}</td><td className="num">{m.qty > 0 ? '+' : ''}{qty(m.qty)}</td>
            <td className="num">{kr(Math.round(m.unit_cost))}</td>
            <td className="small">{m.ref_type === 'purchase_order' ? <Link href={`${basePath}/inkop/${m.ref_id}`}>{m.note}</Link> : m.ref_type === 'sales_order' ? <Link href={`${basePath}/order/${m.ref_id}`}>{m.note}</Link> : m.note}</td>
            <td className="small">{m.user}</td></tr>
        ))}</tbody>
      </table></div>
    </>
  );
}

// ---------- Inköp ----------

async function Purchases({ companyId, basePath }: ModulePageProps) {
  const [pos, sugg, suppliers, whs] = await Promise.all([
    svc.listPOs(companyId), svc.suggestions(companyId),
    sql<{ id: number; name: string }[]>`SELECT id, name FROM suppliers WHERE company_id = ${companyId} ORDER BY name`, svc.warehouses(sql, companyId),
  ]);
  return (
    <>
      <h1>Inköp</h1>
      <Nav basePath={basePath} />
      {sugg.length > 0 && (
        <div className="card stack">
          <b>Beställningsförslag</b>
          <div className="table-wrap"><table>
            <thead><tr><th>Artikel</th><th>Leverantör</th><th className="num">Tillgängligt</th><th className="num">Beställningspunkt</th><th className="num">Föreslås</th></tr></thead>
            <tbody>{sugg.map((s) => (
              <tr key={s.id}><td>{s.sku} {s.name}</td><td>{s.supplier_id ? '' : <span className="small muted">Ingen leverantör angiven</span>}</td>
                <td className="num">{qty(s.available)}</td><td className="num">{qty(s.reorder_point)}</td><td className="num"><b>{qty(s.suggested)}</b></td></tr>
            ))}</tbody>
          </table></div>
          <form action={a.suggestedPOs.bind(null, companyId)}><button>Skapa inköpsorder per leverantör</button></form>
        </div>
      )}
      <div className="table-wrap"><table>
        <thead><tr><th>Nr</th><th>Leverantör</th><th>Datum</th><th>Leverans</th><th>Status</th><th className="num">Belopp exkl. moms</th></tr></thead>
        <tbody>
          {pos.map((o) => (
            <tr key={o.id}><td><Link href={`${basePath}/inkop/${o.id}`}>{o.number}</Link></td><td>{o.supplier_name}</td><td>{o.order_date}</td><td>{o.expected_date ?? ''}</td>
              <td><Badge s={o.status} map={PO_STATUS} />{o.supplier_invoice_id && <span className="badge ok" style={{ marginLeft: '.3rem' }}>Fakturerad</span>}</td><td className="num">{kr(o.net)}</td></tr>
          ))}
          {pos.length === 0 && <tr><td colSpan={6} className="muted">Inga inköpsorder ännu.</td></tr>}
        </tbody>
      </table></div>
      <h2>Ny inköpsorder</h2>
      {suppliers.length === 0 ? <p>Lägg först upp en <Link href={`/c/${companyId}/leverantorer`}>leverantör</Link>.</p> : (
        <form action={a.createPO.bind(null, companyId)} className="card stack">
          <div className="row">
            <label>Leverantör<select name="supplier_id" required>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label>Levereras till<select name="warehouse_id">{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
            <label>Önskat leveransdatum<input type="date" name="expected_date" /></label>
          </div>
          <OrderRows companyId={companyId} price="purchase" />
          <label>Meddelande till leverantören<input name="notes" /></label>
          <div><button>Skapa inköpsorder</button></div>
        </form>
      )}
    </>
  );
}

async function Purchase({ companyId, basePath, params }: ModulePageProps) {
  const o = await svc.getPO(companyId, Number(params.id));
  const [co] = await sql<{ name: string; address: string; postal_code: string; city: string; orgnr: string }[]>`SELECT name, address, postal_code, city, orgnr FROM companies WHERE id = ${companyId}`;
  const open = ['sent', 'partial', 'draft'].includes(o.status);
  const received = o.lines.some((l) => l.received > 0);
  return (
    <>
      <div className="no-print">
        <div className="header">
          <h1>Inköpsorder {o.number} <Badge s={o.status} map={PO_STATUS} /></h1>
          <div className="actions" style={{ margin: 0 }}><Link className="btn secondary" href={`${basePath}/inkop`}>Alla inköpsorder</Link><PrintButton /></div>
        </div>
        <div className="actions">
          {o.status === 'draft' && <form action={a.poStatus.bind(null, companyId, o.id, 'sent')}><button className="secondary">Markera som skickad till leverantören</button></form>}
          {open && !received && <form action={a.poStatus.bind(null, companyId, o.id, 'cancelled')}><button className="link">Makulera</button></form>}
        </div>
        {open && o.status !== 'draft' && (
          <form action={a.receivePO.bind(null, companyId, o.id)} className="card stack">
            <b>Inleverans till {o.warehouse}</b>
            <div className="table-wrap"><table>
              <thead><tr><th>Artikel</th><th className="num">Beställt</th><th className="num">Mottaget</th><th className="num">Tar emot nu</th></tr></thead>
              <tbody>{o.lines.map((l) => (
                <tr key={l.id}><td>{l.sku} {l.name}<input type="hidden" name="line_id" value={l.id} /></td><td className="num">{qty(l.qty)}</td><td className="num">{qty(l.received)}</td>
                  <td className="num"><input name={`recv_${l.id}`} defaultValue={qty(Math.max(0, l.qty - l.received))} inputMode="decimal" aria-label={`Ta emot ${l.sku}`} style={{ maxWidth: '6rem', textAlign: 'right' }} /></td></tr>
              ))}</tbody>
            </table></div>
            <div className="row"><label>Datum<input type="date" name="date" defaultValue={today()} /></label>
              <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button>Registrera inleverans</button></div></div>
          </form>
        )}
        {received && !o.supplier_invoice_id && (
          <form action={a.invoicePO.bind(null, companyId, o.id)} className="card stack">
            <b>Registrera leverantörens faktura</b>
            <p className="small" style={{ margin: 0 }}>Konteras på 4010 Inköp av varor. Förslag från mottagna antal: {kr(o.lines.reduce((s, l) => s + Math.round(l.received * l.unit_price), 0))} kr exkl. moms. Ange fakturans belopp om det avviker.</p>
            <div className="row">
              <label>Fakturanummer<input name="invoice_number" required /></label><label>Fakturadatum<input type="date" name="invoice_date" defaultValue={today()} /></label>
              <label>Förfallodatum<input type="date" name="due_date" /></label>
              <label>Totalt inkl. moms (valfritt)<input name="total" inputMode="decimal" /></label><label>varav moms<input name="vat" inputMode="decimal" /></label>
            </div>
            <div><button className="secondary">Registrera leverantörsfaktura</button></div>
          </form>
        )}
        {o.supplier_invoice_id && <p className="small">Leverantörsfaktura: <Link href={`/c/${companyId}/leverantorsfakturor/${o.supplier_invoice_id}`}>öppna</Link></p>}
      </div>
      <div className="doc">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '2rem' }}>
          <div><h2 style={{ marginTop: 0 }}>{co.name}</h2><div className="small">{co.address}<br />{co.postal_code} {co.city}<br />Org.nr {co.orgnr}</div></div>
          <div style={{ textAlign: 'right' }}><h2 style={{ marginTop: 0 }}>INKÖPSORDER</h2>
            <div className="small">Nr {o.number}<br />Datum {o.order_date}{o.expected_date && <><br />Önskad leverans {o.expected_date}</>}</div></div>
        </div>
        <p><b>Leverantör:</b> {o.supplier_name}<br /><b>Leveransadress:</b> {o.warehouse}</p>
        <table>
          <thead><tr><th>Vårt art.nr</th><th>Ert art.nr</th><th>Benämning</th><th className="num">Antal</th><th className="num">À-pris</th><th className="num">Belopp</th></tr></thead>
          <tbody>{o.lines.map((l) => (
            <tr key={l.id}><td>{l.sku}</td><td>{l.supplier_sku}</td><td>{l.name}</td><td className="num">{qty(l.qty)} {l.unit}</td><td className="num">{kr(l.unit_price)}</td><td className="num">{kr(l.amount)}</td></tr>
          ))}</tbody>
        </table>
        <table style={{ width: 'auto', marginLeft: 'auto', marginTop: '1rem' }}><tbody>
          <tr><td>Summa exkl. moms</td><td className="num">{kr(o.net)}</td></tr><tr><td>Moms</td><td className="num">{kr(o.vat)}</td></tr>
          <tr className="sum"><td>Totalt</td><td className="num">{kr(o.total)}</td></tr>
        </tbody></table>
        {o.notes && <p>{o.notes}</p>}
        <p className="small">Ange inköpsordernummer {o.number} på följesedel och faktura.</p>
      </div>
    </>
  );
}

// ---------- Kundorder ----------

async function Orders({ companyId, basePath }: ModulePageProps) {
  const [sos, customers, whs] = await Promise.all([
    svc.listSOs(companyId), sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name`, svc.warehouses(sql, companyId),
  ]);
  return (
    <>
      <h1>Kundorder och leveranser</h1>
      <Nav basePath={basePath} />
      <div className="table-wrap"><table>
        <thead><tr><th>Nr</th><th>Kund</th><th>Datum</th><th>Status</th><th>Frakt</th><th className="num">Belopp exkl. moms</th></tr></thead>
        <tbody>
          {sos.map((o) => (
            <tr key={o.id}><td><Link href={`${basePath}/order/${o.id}`}>{o.number}</Link></td><td>{o.customer_name}</td><td>{o.order_date}</td><td><Badge s={o.status} map={SO_STATUS} /></td>
              <td className="small">{[o.carrier, o.tracking].filter(Boolean).join(' ')}</td><td className="num">{kr(o.net)}</td></tr>
          ))}
          {sos.length === 0 && <tr><td colSpan={6} className="muted">Inga kundorder ännu.</td></tr>}
        </tbody>
      </table></div>
      <h2>Ny kundorder</h2>
      {customers.length === 0 ? <p>Lägg först upp en <Link href={`/c/${companyId}/kunder`}>kund</Link>.</p> : (
        <form action={a.createSO.bind(null, companyId)} className="card stack">
          <div className="row">
            <label>Kund<select name="customer_id" required>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Levereras från<select name="warehouse_id">{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
            <label>Er referens<input name="your_reference" /></label>
          </div>
          <label>Leveransadress (tomt = kundens adress)<input name="delivery_address" /></label>
          <OrderRows companyId={companyId} price="sales" />
          <label>Notering<input name="notes" /></label>
          <div><button>Skapa kundorder</button></div>
        </form>
      )}
    </>
  );
}

async function Order({ companyId, basePath, params }: ModulePageProps) {
  const o = await svc.getSO(companyId, Number(params.id));
  const [co] = await sql<{ name: string; address: string; postal_code: string; city: string; phone: string }[]>`SELECT name, address, postal_code, city, phone FROM companies WHERE id = ${companyId}`;
  const short = o.lines.filter((l) => l.in_stock < l.qty);
  return (
    <>
      <div className="no-print">
        <div className="header">
          <h1>Kundorder {o.number} <Badge s={o.status} map={SO_STATUS} /></h1>
          <div className="actions" style={{ margin: 0 }}><Link className="btn secondary" href={`${basePath}/order`}>Alla kundorder</Link><PrintButton /></div>
        </div>
        {o.status === 'open' && (
          <form action={a.shipSO.bind(null, companyId, o.id)} className="card stack">
            <b>Leverera från {o.warehouse}</b>
            {short.length > 0 && <p className="small" style={{ color: 'var(--danger)', margin: 0 }}>Saknas i lager: {short.map((l) => `${l.sku} (${qty(l.in_stock)} av ${qty(l.qty)})`).join(', ')}</p>}
            <div className="row">
              <label>Leveransdatum<input type="date" name="date" defaultValue={today()} /></label>
              <label>Transportör<input name="carrier" placeholder="T.ex. PostNord, DHL, Bring, Schenker" list="carriers" /></label>
              <datalist id="carriers"><option value="PostNord" /><option value="DHL" /><option value="Bring" /><option value="DB Schenker" /><option value="UPS" /><option value="Budbee" /><option value="Instabox" /><option value="Eget bud" /></datalist>
              <label>Kolli-/spårningsnummer<input name="tracking" /></label>
            </div>
            <div><button disabled={short.length > 0}>Leverera och dra från lagret</button></div>
          </form>
        )}
        {o.status === 'open' && <form action={a.cancelSO.bind(null, companyId, o.id)} style={{ marginBottom: '1rem' }}><button className="link">Makulera ordern</button></form>}
        {o.status === 'shipped' && <form action={a.invoiceSO.bind(null, companyId, o.id)} className="card"><button>Skapa faktura från leveransen</button></form>}
        {o.invoice_id && <p className="small">Faktura: <Link href={`/c/${companyId}/fakturor/${o.invoice_id}`}>öppna</Link></p>}
        {o.tracking && <p className="small">Skickad {o.shipped_date} med {o.carrier || 'transportör'}, sändningsnummer <b>{o.tracking}</b>.</p>}
      </div>
      <div className="doc">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '2rem' }}>
          <div><h2 style={{ marginTop: 0 }}>{co.name}</h2><div className="small">{co.address}<br />{co.postal_code} {co.city}{co.phone && <><br />{co.phone}</>}</div></div>
          <div style={{ textAlign: 'right' }}><h2 style={{ marginTop: 0 }}>FÖLJESEDEL</h2>
            <div className="small">Order {o.number}<br />Orderdatum {o.order_date}{o.shipped_date && <><br />Skickad {o.shipped_date}</>}{o.your_reference && <><br />Er referens {o.your_reference}</>}</div></div>
        </div>
        <p><b>Leveransadress:</b><br />{o.customer_name}<br />{o.delivery_address || o.customer_address}</p>
        {o.tracking && <p className="small">Transportör: {o.carrier} · Sändningsnummer: {o.tracking}</p>}
        <table>
          <thead><tr><th>Art.nr</th><th>Benämning</th><th className="num">Antal</th><th className="num no-print">I lager</th><th>Plockat</th></tr></thead>
          <tbody>{o.lines.map((l) => (
            <tr key={l.id}><td>{l.sku}</td><td>{l.name}</td><td className="num">{qty(l.qty)} {l.unit}</td><td className="num no-print">{qty(l.in_stock)}</td><td>☐</td></tr>
          ))}</tbody>
        </table>
        {o.notes && <p>{o.notes}</p>}
      </div>
    </>
  );
}

// ---------- Inventering och lagervärde ----------

async function Count({ companyId, basePath, searchParams }: ModulePageProps) {
  const whs = await svc.warehouses(sql, companyId);
  const wid = Number(searchParams.lager) || whs[0].id;
  const products = await svc.listProducts(companyId, { active: true });
  return (
    <>
      <h1>Inventering</h1>
      <Nav basePath={basePath} />
      <form className="row" style={{ marginBottom: '.5rem' }}>
        <label>Lagerställe<select name="lager" defaultValue={wid}>{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Visa</button></div>
      </form>
      <form action={a.count.bind(null, companyId)} className="stack" id="count-form">
        <input type="hidden" name="warehouse_id" value={wid} />
        <Scanner products={products.map((p) => ({ id: p.id, sku: p.sku, barcode: p.barcode, name: p.name }))} />
        <div className="table-wrap"><table>
          <thead><tr><th>Art.nr</th><th>Benämning</th><th className="num">Enligt lagret</th><th className="num">Räknat</th></tr></thead>
          <tbody>{products.map((p) => (
            <tr key={p.id}><td>{p.sku}<input type="hidden" name="product_id" value={p.id} /></td><td>{p.name}</td>
              <td className="num">{qty(p.stock.find((s) => s.warehouse_id === wid)?.qty ?? 0)} {p.unit}</td>
              <td className="num"><input name={`counted_${p.id}`} inputMode="decimal" aria-label={`Räknat ${p.sku}`} style={{ maxWidth: '7rem', textAlign: 'right' }} /></td></tr>
          ))}</tbody>
        </table></div>
        <div className="row"><label>Inventeringsdatum<input type="date" name="date" defaultValue={today()} /></label>
          <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button>Registrera inventering</button></div></div>
        <p className="small muted" style={{ margin: 0 }}>Fyll bara i de artiklar du har räknat. Skillnader bokas som lagerjusteringar till snittpris. Inventera på bokslutsdagen och bokför sedan lagervärdet.</p>
      </form>
    </>
  );
}

async function Value({ companyId, basePath, searchParams }: ModulePageProps) {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.datum ?? '') ? searchParams.datum! : today();
  const use97 = searchParams.r97 === '1';
  const v = await svc.valuation(companyId, at, use97);
  return (
    <>
      <h1>Lagervärde och lagerförändring</h1>
      <Nav basePath={basePath} />
      <p className="small">Vid bokslutet ska lagret tas upp till sitt värde i balansräkningen (konto 1460). Inköp kostnadsförs löpande på 4010, och lagerförändringen bokförs mot 4960.
        Skattemässigt får lagret tas upp till 97 % av anskaffningsvärdet (schablonmetoden, IL 17 kap. 4 §) om ni inte gör avdrag för inkurans på annat sätt.</p>
      <form className="row card">
        <label>Per datum<input type="date" name="datum" defaultValue={at} /></label>
        <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" name="r97" value="1" defaultChecked={use97} /> Använd 97 %-regeln</label>
        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Räkna</button></div>
      </form>
      <div className="grid">
        <div className="card stat"><div className="label">Anskaffningsvärde (snittpris)</div><div className="value">{kr(v.cost)}</div></div>
        <div className="card stat"><div className="label">Värde att bokföra</div><div className="value">{kr(v.book)}</div></div>
        <div className="card stat"><div className="label">Bokfört på 1460 per {at}</div><div className="value">{kr(v.booked)}</div></div>
        <div className="card stat"><div className="label">Lagerförändring att bokföra</div><div className="value">{kr(v.change)}</div></div>
      </div>
      <form action={a.bookValuation.bind(null, companyId)} className="card row">
        <input type="hidden" name="date" value={at} />{use97 && <input type="hidden" name="use97" value="on" />}
        <div><button disabled={v.change === 0}>Bokför lagerförändring {kr(v.change)} kr per {at}</button></div>
        <span className="small muted" style={{ alignSelf: 'center' }}>Värdet bygger på nuvarande saldon – inventera först om lagret har ändrats sedan bokslutsdagen.</span>
      </form>
      {v.history.length > 0 && (<>
        <h2>Tidigare värderingar</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Datum</th><th className="num">Anskaffningsvärde</th><th className="num">Bokfört värde</th><th>Verifikation</th></tr></thead>
          <tbody>{v.history.map((h, i) => (
            <tr key={i}><td>{h.date}</td><td className="num">{kr(h.cost_value)}</td><td className="num">{kr(h.book_value)}</td>
              <td>{h.voucher_id ? <Link href={`/c/${companyId}/verifikationer/${h.voucher_id}`}>Visa</Link> : '–'}</td></tr>
          ))}</tbody>
        </table></div>
      </>)}
    </>
  );
}

const P = { type: 'object' } as const;
const LINES = { type: 'array', items: { type: 'object', required: ['product_id', 'qty'], properties: { product_id: { type: 'integer' }, qty: { type: 'number' }, unit_price: { type: 'integer', description: 'öre, tomt = artikelns pris' } } } } as const;

export const lager: ModuleDefinition = {
  id: 'lager',
  name: 'Inköp, lager och logistik',
  version: '0.1.0',
  description: 'Artiklar och lagersaldon per lagerställe, inköpsorder med inleverans och leverantörsfaktura, beställningsförslag, kundorder med följesedel och frakt, inventering och lagervärdering i bokslutet.',
  nav: [
    { label: 'Översikt', path: '' },
    { label: 'Artiklar', path: 'artiklar' },
    { label: 'Inköp', path: 'inkop' },
    { label: 'Kundorder', path: 'order' },
    { label: 'Inventering', path: 'inventering' },
    { label: 'Lagervärde', path: 'varde' },
  ],
  pages: {
    '': Overview, artiklar: Products, 'artiklar/:id': Product, inkop: Purchases, 'inkop/:id': Purchase,
    order: Orders, 'order/:id': Order, inventering: Count, varde: Value,
  },
  scopes: [
    { scope: 'lager:read', description: 'Läsa artiklar, saldon, inköpsorder och kundorder' },
    { scope: 'lager:write', description: 'Ändra artiklar, skapa och leverera order, inleverans och inventering' },
  ],
  events: [
    { type: 'lager.purchase_order.created', description: 'En inköpsorder har skapats' },
    { type: 'lager.sales_order.created', description: 'En kundorder har skapats' },
    { type: 'lager.sales_order.shipped', description: 'En kundorder har levererats (med transportör och sändningsnummer)' },
  ],
  api: [
    { method: 'GET', path: '/products', scope: 'lager:read', tag: 'Lager', summary: 'Lista artiklar med saldon', query: [{ name: 'q', description: 'Sök' }],
      handler: async ({ actor, query }) => ({ object: 'list', has_more: false, data: await svc.listProducts(actor.companyId, { q: query.get('q') ?? undefined }) }) },
    { method: 'GET', path: '/products/:id', scope: 'lager:read', tag: 'Lager', summary: 'Hämta artikel', handler: ({ actor, params }) => svc.getProduct(actor.companyId, Number(params.id)) },
    { method: 'POST', path: '/products', scope: 'lager:write', tag: 'Lager', status: 201, summary: 'Lägg upp artikel (priser i öre)',
      body: { type: 'object', required: ['sku', 'name'], properties: { sku: { type: 'string' }, name: { type: 'string' }, unit: { type: 'string' }, purchase_price: { type: 'integer' },
        sales_price: { type: 'integer' }, vat_rate: { type: 'integer' }, reorder_point: { type: 'number' }, reorder_qty: { type: 'number' }, supplier_id: { type: 'integer' },
        opening_qty: { type: 'number' }, warehouse_id: { type: 'integer' } } },
      handler: ({ actor, body }) => svc.saveProduct(actor, null, body) },
    { method: 'GET', path: '/purchase-orders', scope: 'lager:read', tag: 'Lager', summary: 'Lista inköpsorder',
      handler: async ({ actor, query }) => ({ object: 'list', has_more: false, data: await svc.listPOs(actor.companyId, { status: query.get('status') ?? undefined }) }) },
    { method: 'POST', path: '/purchase-orders', scope: 'lager:write', tag: 'Lager', status: 201, summary: 'Skapa inköpsorder',
      body: { type: 'object', required: ['supplier_id', 'lines'], properties: { supplier_id: { type: 'integer' }, warehouse_id: { type: 'integer' }, expected_date: { type: 'string', format: 'date' }, notes: { type: 'string' }, lines: LINES } },
      handler: ({ actor, body }) => svc.createPO(actor, body) },
    { method: 'POST', path: '/purchase-orders/:id/receive', scope: 'lager:write', tag: 'Lager', summary: 'Inleverans (utan lines: allt som återstår)',
      body: { type: 'object', properties: { date: { type: 'string', format: 'date' }, lines: { type: 'array', items: { type: 'object', properties: { line_id: { type: 'integer' }, qty: { type: 'number' } } } } } },
      handler: ({ actor, params, body }) => svc.receivePO(actor, Number(params.id), body) },
    { method: 'GET', path: '/sales-orders', scope: 'lager:read', tag: 'Lager', summary: 'Lista kundorder',
      handler: async ({ actor, query }) => ({ object: 'list', has_more: false, data: await svc.listSOs(actor.companyId, { status: query.get('status') ?? undefined }) }) },
    { method: 'POST', path: '/sales-orders', scope: 'lager:write', tag: 'Lager', status: 201, summary: 'Skapa kundorder (t.ex. från webbutik)',
      body: { type: 'object', required: ['customer_id', 'lines'], properties: { customer_id: { type: 'integer' }, warehouse_id: { type: 'integer' }, delivery_address: { type: 'string' }, your_reference: { type: 'string' }, notes: { type: 'string' }, lines: LINES } },
      handler: ({ actor, body }) => svc.createSO(actor, body) },
    { method: 'POST', path: '/sales-orders/:id/ship', scope: 'lager:write', tag: 'Lager', summary: 'Leverera (dras från lagret)',
      body: { type: 'object', properties: { date: { type: 'string', format: 'date' }, carrier: { type: 'string' }, tracking: { type: 'string' } } },
      handler: ({ actor, params, body }) => svc.shipSO(actor, Number(params.id), body) },
    { method: 'POST', path: '/sales-orders/:id/invoice', scope: 'lager:write', tag: 'Lager', status: 201, summary: 'Fakturautkast från levererad order', body: P,
      handler: ({ actor, params }) => svc.invoiceSO(actor, Number(params.id)) },
  ],
};
