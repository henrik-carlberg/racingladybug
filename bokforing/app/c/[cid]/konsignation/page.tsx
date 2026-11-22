import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/consignment';
import { addItem, move } from './actions';

export const dynamic = 'force-dynamic';

/** Konsignationslager hos återförsäljare */
export default async function Consignment({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const o = await overview(company.id);
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Konsignationslager</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Varor som lämnas till en återförsäljare i konsignation är fortfarande era tills återförsäljaren har sålt dem. De ligger kvar i lagret (1465, varulager hos återförsäljare)
        och tas med i lagervärdet vid bokslutet. När återförsäljaren rapporterar försäljning skapas en faktura och lagret minskas till inköpspriset.</p>
      <div className="grid"><div className="card stat"><div className="label">Lagervärde hos återförsäljare</div><div className="value kg-total">{kr(o.total)}</div></div></div>
      <table className="kg-list"><thead><tr><th>Återförsäljare</th><th>Artikel</th><th className="num">Hos återförsäljaren</th><th className="num">Lagervärde</th><th /></tr></thead>
        <tbody>{o.rows.map((r) => <tr key={r.id} className="kg-row" data-article={r.article}><td>{r.customer}</td><td>{r.article}</td><td className="num kg-qty">{r.onHand} st</td><td className="num">{kr(r.value)}</td>
          <td><form action={move.bind(null, company.id, r.id)} className="row" style={{ gap: '.25rem' }}>
            <select name="kind"><option value="ship">Utleverans</option><option value="sold">Sålt enligt rapport</option><option value="return">Retur</option></select>
            <input name="qty" required style={{ width: '5rem' }} placeholder="Antal" /><input type="date" name="date" defaultValue={today()} /><button className="secondary">Bokför</button></form></td></tr>)}</tbody></table>
      <form action={addItem.bind(null, company.id)} className="card row" style={{ marginTop: '1rem' }}>
        <label>Återförsäljare<select name="customer_id" required>{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Artikel<input name="article" required maxLength={200} /></label>
        <label>Inköpspris/st (kr)<input name="unit_cost" required style={{ width: '7rem' }} /></label>
        <label>Pris till återförsäljaren/st exkl. moms (kr)<input name="unit_price" required style={{ width: '7rem' }} /></label>
        <label>Moms<select name="vat_rate"><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option><option value="0">0 %</option></select></label>
        <div style={{ flex: '0 0 auto' }}><button>Lägg upp artikel</button></div>
      </form>
    </div>
  );
}
