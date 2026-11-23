import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/rental';
import { checkinAction, checkoutAction, invoiceAction, itemAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function Rental({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const id = company.id;
  const o = await overview(id);
  const t = today();
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Uthyrning av utrustning</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Varje individ har ett serienummer och kan vara uthyrd till en kund i taget. Hyran räknas per dag med första och sista dagen, och det billigaste av dag-, vecko- och månadspris används.
        Pågående hyror kan faktureras per period (t.ex. vid månadsskiftet); vid återlämning faktureras resten tillsammans med eventuell skade- och förseningsavgift.</p>
      <table className="rn-items"><thead><tr><th>Serienr</th><th>Utrustning</th><th className="num">Dag / vecka / månad</th><th>Status</th><th className="num">Beläggning 90 dagar</th><th className="num">Intäkt</th><th></th></tr></thead>
        <tbody>{o.items.map((i) => (
          <tr key={i.id} className="rn-row" data-serial={i.serial}><td>{i.serial}</td><td>{i.name}</td><td className="num small">{kr(i.day_rate)} / {i.week_rate ? kr(i.week_rate) : '–'} / {i.month_rate ? kr(i.month_rate) : '–'}</td>
            <td className="small rn-status">{i.current ? <>Uthyrd till {i.current.customer} sedan {i.current.start}{i.current.invoiced_until && <div>Fakturerat t.o.m. {i.current.invoiced_until}</div>}{i.overdue && <div style={{ color: 'var(--danger)' }}>Skulle ha lämnats {i.current.expected_end}</div>}</> : 'Tillgänglig'}</td>
            <td className="num rn-util">{i.util.pct.toLocaleString('sv-SE')} %</td><td className="num rn-revenue">{kr(i.revenue)}</td>
            <td>{i.current ? <div className="stack" style={{ gap: '.25rem' }}>
              <form action={invoiceAction.bind(null, id, i.current.id)} className="row" style={{ gap: '.25rem' }}><input type="date" name="until" defaultValue={t} /><button className="link">Fakturera period</button></form>
              <form action={checkinAction.bind(null, id, i.current.id)} className="stack" style={{ gap: '.25rem' }}>
                <div className="row" style={{ gap: '.25rem' }}><input name="damage" placeholder="Skadeavgift" inputMode="decimal" style={{ width: '6rem' }} /><input name="damage_note" placeholder="Skada" style={{ width: '7rem' }} /><input name="late" placeholder="Förseningsavgift" inputMode="decimal" style={{ width: '7rem' }} /></div>
                <div className="row" style={{ gap: '.25rem' }}><input type="date" name="date" defaultValue={t} /><button className="link">Återlämnad</button></div></form>
            </div> : <form action={checkoutAction.bind(null, id, i.id)} className="row" style={{ gap: '.25rem' }}>
              <select name="customer_id">{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <input type="date" name="start_date" defaultValue={t} /><input type="date" name="expected_end" title="Planerad återlämning" /><button className="link">Lämna ut</button></form>}</td></tr>))}
          {!o.items.length && <tr><td colSpan={7} className="muted">Ingen utrustning ännu.</td></tr>}</tbody></table>
      <h2>Ny utrustning</h2>
      <form action={itemAction.bind(null, id)} className="row">
        <label>Serienummer<input name="serial" required style={{ width: '8rem' }} /></label>
        <label>Benämning<input name="name" required /></label>
        <label>Dagpris (kr)<input name="day_rate" inputMode="decimal" required style={{ width: '6rem' }} /></label>
        <label>Veckopris<input name="week_rate" inputMode="decimal" style={{ width: '6rem' }} /></label>
        <label>Månadspris<input name="month_rate" inputMode="decimal" style={{ width: '6rem' }} /></label>
        <label>Moms<select name="vat_rate" defaultValue="25"><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option><option value="0">0 %</option></select></label>
        <button>Lägg upp utrustning</button>
      </form>
    </div>
  );
}
