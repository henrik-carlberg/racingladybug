import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/vmb';
import { purchase, sale, settle } from './actions';

export const dynamic = 'force-dynamic';

/** Vinstmarginalbeskattning för begagnade varor, konst och antikviteter (förenklad metod) */
export default async function Vmb({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const o = await overview(company.id);
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Vinstmarginalbeskattning</h1>
      <Flash searchParams={searchParams} />
      <p className="small">För begagnade varor, konst, antikviteter och samlarföremål som köps utan moms kan momsen tas ut på vinstmarginalen i stället för hela priset.
        Med förenklad metod (varor köpta för högst 50 000 kr styck) räknas marginalen per redovisningsperiod: försäljning minus inköp. Momsen är 20 % av en positiv marginal,
        och en negativ marginal förs över till nästa period. Ingående moms på inköpen får inte dras av, och kvitton och fakturor ska ha texten
        &quot;Vinstmarginalbeskattning för begagnade varor&quot; utan att momsen visas. Avräkna VMB-perioden innan momsdeklarationen för samma period.</p>
      <div className="grid">
        <div className="card stat"><div className="label">Negativ marginal att föra över</div><div className="value vmb-carry">{kr(o.carry)}</div></div>
      </div>
      <div className="row" style={{ alignItems: 'start' }}>
        <form action={purchase.bind(null, company.id)} className="card stack" style={{ flex: 1 }}>
          <h3 style={{ margin: 0 }}>Inköp</h3>
          <label>Vara<input name="description" required maxLength={200} /></label>
          <label>Inköpspris (kr)<input name="price" required /></label>
          <label>Datum<input type="date" name="date" defaultValue={today()} /></label>
          <div><button className="secondary">Bokför inköp</button></div>
        </form>
        <form action={sale.bind(null, company.id)} className="card stack" style={{ flex: 1 }}>
          <h3 style={{ margin: 0 }}>Försäljning</h3>
          <label>Vara<input name="description" required maxLength={200} /></label>
          <label>Försäljningspris (kr)<input name="price" required /></label>
          <label>Datum<input type="date" name="date" defaultValue={today()} /></label>
          <div><button className="secondary">Bokför försäljning</button></div>
        </form>
      </div>
      <form action={settle.bind(null, company.id)} className="card row" style={{ marginTop: '1rem' }}>
        <label>Period från<input type="date" name="period_from" defaultValue={o.nextFrom ?? `${today().slice(0, 7)}-01`} /></label>
        <label>till<input type="date" name="period_to" defaultValue={today()} /></label>
        <div style={{ flex: '0 0 auto' }}><button>Avräkna perioden</button></div>
      </form>
      {o.settlements.length > 0 && <table className="vmb-list"><thead><tr><th>Period</th><th className="num">Försäljning</th><th className="num">Inköp</th><th className="num">Överfört</th><th className="num">Marginal</th><th className="num">Moms</th></tr></thead>
        <tbody>{o.settlements.map((s) => <tr key={s.id} className="vmb-row"><td>{s.period_from} – {s.period_to}</td><td className="num">{kr(s.sales)}</td><td className="num">{kr(s.purchases)}</td>
          <td className="num">{kr(s.carried_in)}</td><td className="num">{kr(s.margin)}</td><td className="num vmb-vat">{kr(s.vat)}</td></tr>)}</tbody></table>}
    </div>
  );
}
