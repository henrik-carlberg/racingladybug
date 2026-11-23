import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/excise';
import { addTypeAction, declareAction, entryAction, linkAction, payAction } from './actions';

export const dynamic = 'force-dynamic';

const prevMonth = (d: string) => { const [y, m] = d.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const rate = (ore: number) => (ore / 100).toLocaleString('sv-SE', { maximumFractionDigits: 4 });

export default async function Excise({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const t = today();
  const period = typeof sp.period === 'string' && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : prevMonth(t);
  const o = await overview(id, period);
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Punktskatter</h1>
      <Flash searchParams={searchParams} />
      <p className="small">För dig som är skattskyldig för punktskatt, till exempel energiskatt, kemikalieskatt eller skatt på nikotinprodukter. Underlaget är det som levererats ur lagret av artiklar kopplade till ett skatteslag
        (minus returer tillbaka i lager) och egna uttag. Deklarationen bokförs som kostnad mot 2660 Särskilda punktskatter och betalas via skattekontot.</p>

      <form method="get" className="row"><label>Period<input type="month" name="period" defaultValue={period} /></label><button className="secondary">Visa</button></form>
      <h2>Deklaration {period}</h2>
      <table className="ex-return"><thead><tr><th>Skatteslag</th><th className="num">Underlag</th><th className="num">Skattesats</th><th className="num">Skatt</th></tr></thead>
        <tbody>{(o.declared ? o.declared.lines.map((l) => ({ rate: 0, ...l })) : o.computed.lines).map((l) => (
          <tr key={l.name} data-type={l.name}><td>{l.name}</td><td className="num ex-qty">{l.quantity} {l.unit}</td><td className="num">{l.rate ? `${rate(l.rate)} kr/${l.unit}` : ''}</td><td className="num ex-tax">{kr(l.tax)}</td></tr>))}
          {!(o.declared?.lines.length ?? o.computed.lines.length) && <tr><td colSpan={4} className="muted">Inget skattepliktigt underlag.</td></tr>}</tbody>
        <tfoot><tr><th colSpan={3}>Att betala</th><th className="num ex-total">{kr(o.declared?.total ?? o.computed.total)}</th></tr></tfoot></table>
      {o.declared ? <p className="small">Deklarerad.</p> : <form action={declareAction.bind(null, id, period)}><button>Bokför punktskatt för {period}</button></form>}
      <p className="small">Skuld på 2660 enligt bokföringen: <span className="ex-ledger">{kr(o.ledger)}</span> kr</p>

      <h2>Deklarationer</h2>
      <table className="ex-list"><thead><tr><th>Period</th><th className="num">Skatt</th><th>Förfaller</th><th>Betald</th><th></th></tr></thead>
        <tbody>{o.returns.map((r) => (
          <tr key={r.id} className="ex-row" data-period={r.period}><td>{r.period}</td><td className="num">{kr(r.total)}</td><td>{r.due}</td><td>{r.paid_on ?? (r.total ? '' : '–')}</td>
            <td>{!r.paid_on && r.total > 0 && <form action={payAction.bind(null, id, r.id, period)} className="row" style={{ gap: '.25rem' }}><input type="date" name="date" defaultValue={t} /><button className="link">Betald</button></form>}</td></tr>))}
          {!o.returns.length && <tr><td colSpan={5} className="muted">Inga deklarationer ännu.</td></tr>}</tbody></table>

      <h2>Egna uttag och övrigt underlag</h2>
      <table><tbody>{o.entries.map((e) => <tr key={e.id}><td>{e.date}</td><td>{e.type}</td><td className="num">{e.quantity}</td><td className="small">{e.note}</td></tr>)}
        {!o.entries.length && <tr><td className="muted">Inga uttag under perioden.</td></tr>}</tbody></table>
      {o.types.length > 0 && <form action={entryAction.bind(null, id)} className="row">
        <input type="hidden" name="period" value={period} />
        <label>Skatteslag<select name="excise_type_id">{o.types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label>Datum<input type="date" name="date" defaultValue={`${period}-28`} required /></label>
        <label>Antal enheter<input name="quantity" inputMode="decimal" required style={{ width: '7rem' }} /></label>
        <label>Notering<input name="note" /></label>
        <button>Registrera uttag</button>
      </form>}

      <h2>Skatteslag</h2>
      <table className="ex-types"><thead><tr><th>Skatteslag</th><th className="num">Skattesats</th><th>Kostnadskonto</th><th>Fakturarad</th><th>Artiklar</th></tr></thead>
        <tbody>{o.types.map((x) => <tr key={x.id}><td>{x.name}</td><td className="num">{rate(x.rate)} kr/{x.unit}</td><td>{x.cost_account}</td><td>{x.invoice_line ? 'Ja' : 'Nej'}</td>
          <td className="small">{o.links.filter((l) => l.excise_type_id === x.id).map((l) => <div key={l.product_id}>{l.product} ({l.factor} {x.unit}/st)</div>)}</td></tr>)}
          {!o.types.length && <tr><td colSpan={5} className="muted">Inga skatteslag ännu.</td></tr>}</tbody></table>
      <form action={addTypeAction.bind(null, id)} className="card stack">
        <input type="hidden" name="period" value={period} />
        <div className="row">
          <label>Skatteslag<input name="name" placeholder="t.ex. Kemikalieskatt" required /></label>
          <label>Enhet<input name="unit" defaultValue="kg" style={{ width: '5rem' }} /></label>
          <label>Skattesats (kr per enhet)<input name="rate" inputMode="decimal" required style={{ width: '7rem' }} /></label>
          <label>Kostnadskonto<input name="cost_account" defaultValue="6900" style={{ width: '6rem' }} /></label>
        </div>
        <label className="row"><input type="checkbox" name="invoice_line" /> Visa punktskatten som egen rad på fakturor från kundorder</label>
        <div><button>Lägg upp skatteslag</button></div>
      </form>
      {o.types.length > 0 && o.products.length > 0 && <form action={linkAction.bind(null, id)} className="row">
        <input type="hidden" name="period" value={period} />
        <label>Skatteslag<select name="excise_type_id">{o.types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label>Artikel<select name="product_id">{o.products.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label>Skattepliktiga enheter per artikelenhet<input name="factor" inputMode="decimal" required style={{ width: '6rem' }} /></label>
        <button>Koppla artikel</button>
      </form>}
    </div>
  );
}
