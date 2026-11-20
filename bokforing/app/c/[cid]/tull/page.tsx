import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { sql } from '@/lib/db';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { openPOs, overview } from '@/lib/services/customs';
import { isModuleEnabled } from '@/lib/modules/enabled';
import { allocate, decision, statement } from './actions';

export const dynamic = 'force-dynamic';

export default async function Customs({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id;
  const y = Number(String(sp.ar ?? '').slice(0, 4)) || Number(today().slice(0, 4));
  const o = await overview(id, y);
  const lager = await isModuleEnabled(id, 'lager');
  const pos = lager ? await openPOs(id) : [];
  const suppliers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM suppliers WHERE company_id = ${id} ORDER BY name`;
  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="header"><h1>Import och tull {y}</h1><div className="row"><Link href={`?ar=${y - 1}`}>← {y - 1}</Link><Link href={`?ar=${y + 1}`}>{y + 1} →</Link></div></div>
      <p className="muted">Registrera Tullverkets beslut för varor från länder utanför EU. Importmomsen redovisas i momsdeklarationen (ruta 50 och 60) och dras av som ingående moms (ruta 48). Tull och frakt kan fördelas på varorna så att lagervärdet blir rätt.</p>
      <Flash searchParams={searchParams} />
      <div className="grid">
        <div className="card stat"><div className="label">Skuld till Tullverket</div><div className="value customs-debt">{kr(o.debt)}</div><div className="small muted">konto 2895</div></div>
        <div className="card stat"><div className="label">Importmoms i år</div><div className="value">{kr(o.decisions.reduce((s, d) => s + d.vat, 0))}</div></div>
        <div className="card stat"><div className="label">Tull och avgifter i år</div><div className="value">{kr(o.decisions.reduce((s, d) => s + d.duty + d.fees, 0))}</div></div>
      </div>

      <form action={decision.bind(null, id)} className="card stack">
        <b>Nytt tullbeslut</b>
        <div className="row">
          <label>Beslutsnummer<input name="decision_no" required /></label><label>Beslutsdatum<input type="date" name="date" defaultValue={today()} required /></label>
          <label>Leverantör<select name="supplier_id"><option value="">–</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label style={{ flex: '2 1 200px' }}>Varor<input name="description" placeholder="t.ex. skor från Kina" /></label>
        </div>
        <div className="row">
          <label>Tullvärde (kr)<input name="customs_value" inputMode="decimal" required /></label><label>Tull (kr)<input name="duty" inputMode="decimal" /></label>
          <label>Övriga avgifter (kr)<input name="fees" inputMode="decimal" /></label><label>Frakt till bestämmelseort i Sverige (kr)<input name="freight_sweden" inputMode="decimal" /></label>
          <label>Moms<select name="vat_rate"><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option></select></label>
        </div>
        <div className="row">
          <label>Moms enligt beslutet (kr, för kontroll)<input name="vat_stated" inputMode="decimal" /></label>
          <label>Avdragsrätt<select name="deductible"><option value="yes">Full avdragsrätt</option><option value="no">Ingen avdragsrätt</option></select></label>
          {lager && <><label>Frakt att fördela på varorna (kr)<input name="freight_alloc" inputMode="decimal" /></label>
            <label>Inköpsorder<select name="po_id"><option value="">–</option>{pos.map((p) => <option key={p.id} value={p.id}>{p.number} {p.supplier ?? ''}</option>)}</select></label></>}
        </div>
        <div><button>Bokför beslutet</button></div>
        <p className="small muted" style={{ margin: 0 }}>Beskattningsunderlaget är tullvärdet plus tull, övriga avgifter och frakt fram till bestämmelseorten i Sverige. Verifikationen: 4545/4549 (underlag), 2615 (utgående moms), 2645 (ingående moms), 5720 mot 2895 (tull).</p>
      </form>

      {o.decisions.length > 0 && <div className="table-wrap"><table className="decisions">
        <thead><tr><th>Datum</th><th>Beslut</th><th>Varor</th><th className="num">Tullvärde</th><th className="num">Tull</th><th className="num">Underlag (50)</th><th className="num">Moms (60)</th><th>Fördelning</th></tr></thead>
        <tbody>{o.decisions.map((d) => (
          <tr key={d.id} className="decision"><td>{d.date}</td><td>{d.voucher_id ? <Link href={`/c/${id}/verifikationer/${d.voucher_id}`}>{d.decision_no}</Link> : d.decision_no}</td><td>{d.description}{d.supplier && <div className="small muted">{d.supplier}</div>}</td>
            <td className="num">{kr(d.customs_value)}</td><td className="num">{kr(d.duty + d.fees)}</td><td className="num">{kr(d.vat_base)}</td>
            <td className="num">{kr(d.vat)}{d.vat_stated != null && Math.abs(d.vat_stated - d.vat) > 100 && <div className="small" style={{ color: 'var(--danger)' }}>beslut: {kr(d.vat_stated)}</div>}</td>
            <td>{d.allocated_at ? <span className="allocated">Fördelat på order {d.po_number}</span> : lager && d.duty + d.fees + d.freight_alloc > 0 ? (
              <form action={allocate.bind(null, id, d.id)} className="row">{!d.po_id && <select name="po_id" aria-label="Inköpsorder">{pos.map((p) => <option key={p.id} value={p.id}>{p.number}</option>)}</select>}<button className="secondary">Fördela på varorna</button></form>) : ''}</td></tr>
        ))}</tbody>
      </table></div>}
      {o.allocations.length > 0 && (<>
        <h2>Landed cost</h2>
        <div className="table-wrap"><table className="landed">
          <thead><tr><th>Artikel</th><th className="num">Antal</th><th className="num">Tull och frakt</th><th className="num">Snittpris före</th><th className="num">Snittpris efter</th></tr></thead>
          <tbody>{o.allocations.map((a) => <tr key={`${a.decision_id}-${a.sku}`} className="landed-row"><td>{a.sku} {a.name}</td><td className="num">{a.qty}</td><td className="num">{kr(a.allocated)}</td><td className="num">{kr(a.unit_before)}</td><td className="num">{kr(a.unit_after)}</td></tr>)}</tbody>
        </table></div>
      </>)}

      <h2>Avstämning mot Tullverket</h2>
      <div className="table-wrap"><table className="customs-rec">
        <thead><tr><th>Månad</th><th className="num">Beslut</th><th className="num">Ruta 50</th><th className="num">Ruta 60</th><th className="num">Tull enligt beslut</th><th className="num">Bokfört på 2895</th><th className="num">Betalt</th><th className="num">Tullverkets besked</th><th>Status</th></tr></thead>
        <tbody>{o.months.map((m) => (
          <tr key={m.month} className="rec-row"><td>{m.month}</td><td className="num">{m.count}</td><td className="num">{kr(m.box50)}</td><td className="num">{kr(m.box60)}</td><td className="num">{kr(m.due)}</td><td className="num">{kr(m.booked)}</td><td className="num">{kr(m.paid)}</td>
            <td className="num">{m.statement == null ? '–' : kr(m.statement)}</td><td className="rec-status">{m.ok ? (m.statement == null ? 'Väntar på besked' : 'Stämmer') : `Avviker ${kr(m.diffStatement ?? m.diffBooked)}`}</td></tr>
        ))}</tbody>
      </table></div>
      <form action={statement.bind(null, id)} className="card row">
        <label>Månad<input name="month" defaultValue={today().slice(0, 7)} pattern="\d{4}-\d{2}" /></label><label>Att betala enligt Tullverkets besked (kr)<input name="amount" inputMode="decimal" required /></label>
        <button className="secondary">Spara besked</button>
      </form>
      <p className="small muted">Ruta 50 och 60 hämtas från bokföringen och ska stämma med summan av besluten. Tullen jämförs med Tullverkets månadsbesked; betalningen bokas mot 2895 när den dras från banken.</p>
    </div>
  );
}
