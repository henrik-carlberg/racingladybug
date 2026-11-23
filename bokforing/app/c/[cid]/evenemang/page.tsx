import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/events';
import { costAction, eventAction, finishAction, refundAction, sellAction, sponsorAction, typeAction } from './actions';

export const dynamic = 'force-dynamic';
const STATUS: Record<string, string> = { open: 'Planerat', held: 'Genomfört', cancelled: 'Inställt' };

export default async function Events({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const id = company.id;
  const o = await overview(id);
  const t = today();
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Evenemang och biljetter</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Biljettintäkter redovisas som förutbetald intäkt (2970) fram till eventdagen, med momsen när betalningen tas emot och rätt momssats per biljettyp. Sponsring faktureras mot förutbetalda intäkter.
        När evenemanget är genomfört intäktsförs allt; ställs det in återbetalas biljetterna med sin moms.</p>
      {o.events.map((e) => (
        <section key={e.id} className="card stack ev-event" data-name={e.name}>
          <h2 style={{ margin: 0 }}>{e.name} <span className="small muted">{e.date}{e.venue && `, ${e.venue}`} · {STATUS[e.status]}</span></h2>
          <div className="row">
            <div className="card stat"><div className="label">Intäkter exkl. moms</div><div className="value ev-revenue">{kr(e.revenue)}</div></div>
            <div className="card stat"><div className="label">Kostnader</div><div className="value ev-costs">{kr(e.costs)}</div>{e.budget_cost > 0 && <div className="small muted">budget {kr(e.budget_cost)}</div>}</div>
            <div className="card stat"><div className="label">Resultat</div><div className="value ev-result">{kr(e.result)}</div></div>
          </div>
          <table><thead><tr><th>Biljettyp</th><th className="num">Pris</th><th>Moms</th><th className="num">Sålda</th><th className="num">Kvar</th></tr></thead>
            <tbody>{e.types.map((x) => <tr key={x.id} className="ev-type" data-name={x.name}><td>{x.name}</td><td className="num">{kr(x.price)}</td><td>{x.vat_rate} %</td><td className="num ev-sold">{x.sold}</td><td className="num ev-left">{x.left ?? '–'}</td></tr>)}</tbody></table>
          {e.status === 'open' && <div className="row" style={{ alignItems: 'start' }}>
            {e.types.length > 0 && <form action={sellAction.bind(null, id, e.id)} className="row"><select name="type_id">{e.types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <input name="quantity" placeholder="Antal" inputMode="numeric" style={{ width: '4rem' }} /><input name="buyer" placeholder="Köpare" required /><button>Sälj biljetter</button></form>}
            <form action={typeAction.bind(null, id, e.id)} className="row"><input name="name" placeholder="Biljettyp" required style={{ width: '8rem' }} /><input name="price" placeholder="Pris inkl. moms" inputMode="decimal" style={{ width: '7rem' }} />
              <select name="vat_rate" defaultValue="25"><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option><option value="0">0 %</option></select>
              <input name="capacity" placeholder="Platser" inputMode="numeric" style={{ width: '5rem' }} /><button className="secondary">Lägg till biljettyp</button></form>
          </div>}
          <table className="small"><tbody>{e.tickets.map((k) => <tr key={k.id} className="ev-ticket" data-buyer={k.buyer}><td>{k.buyer}</td><td>{k.quantity} × {k.type}</td><td className="num">{kr(k.amount)}</td><td>{k.status === 'refunded' ? 'Återbetald' : ''}</td>
            <td>{k.status === 'sold' && e.status === 'open' && <form action={refundAction.bind(null, id, k.id)}><button className="link">Återbetala</button></form>}</td></tr>)}</tbody></table>
          <div className="small">{e.sponsors.map((s, i) => <div key={i}>Sponsor {s.customer}: {kr(s.amount)} kr {s.invoice_id && <Link href={`/c/${id}/fakturor/${s.invoice_id}`}>faktura</Link>}</div>)}
            {e.costItems.map((c, i) => <div key={i}>Kostnad {c.supplier} {c.number}: {kr(c.net)} kr</div>)}</div>
          {e.status === 'open' && <div className="row">
            <form action={sponsorAction.bind(null, id, e.id)} className="row"><select name="customer_id">{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><input name="amount" placeholder="Sponsring exkl. moms" inputMode="decimal" style={{ width: '9rem' }} /><button className="secondary">Fakturera sponsring</button></form>
            {o.supplierInvoices.length > 0 && <form action={costAction.bind(null, id, e.id)} className="row"><select name="supplier_invoice_id">{o.supplierInvoices.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select><button className="secondary">Koppla kostnad</button></form>}
            <form action={finishAction.bind(null, id, e.id, 'held')}><button>Genomfört</button></form>
            <form action={finishAction.bind(null, id, e.id, 'cancelled')}><button className="secondary">Ställ in</button></form>
          </div>}
        </section>))}
      <h2>Nytt evenemang</h2>
      <form action={eventAction.bind(null, id)} className="row">
        <label>Namn<input name="name" required /></label>
        <label>Datum<input type="date" name="date" defaultValue={t} required /></label>
        <label>Plats<input name="venue" /></label>
        <label>Kostnadsbudget (kr)<input name="budget_cost" inputMode="decimal" style={{ width: '8rem' }} /></label>
        <button>Lägg upp evenemang</button>
      </form>
    </div>
  );
}
