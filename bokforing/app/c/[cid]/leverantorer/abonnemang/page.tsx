import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { overview } from '@/lib/services/supplier-subscriptions';
import { addAction, cancelAction, seatsAction } from './actions';

export const dynamic = 'force-dynamic';

const PERIOD: Record<number, string> = { 1: 'månad', 3: 'kvartal', 6: 'halvår', 12: 'år', 24: '2 år', 36: '3 år' };

export default async function Subscriptions({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'purchasing' });
  const id = company.id;
  const { subscriptions, suppliers, suggestions, totals } = await overview(id);
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Leverantörsabonnemang</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Håll ordning på SaaS-tjänster och licenser: vad de kostar per månad, hur många licenser som används, när de förnyas och sista dag att säga upp dem. Senaste fakturan från leverantören jämförs med avtalat pris så att prishöjningar syns.</p>
      <p className="small">Kostnad per månad: <span className="ss-monthly">{kr(totals.monthly)}</span> kr · varav oanvända licenser: <span className="ss-unused">{kr(totals.unused)}</span> kr</p>
      {subscriptions.filter((s) => s.status === 'active' && s.notice.soon).map((s) => <div key={s.id} className="card small ss-notice">{s.name} förnyas {s.renewal} – säg upp senast {s.notice.by} ({s.notice.left} dagar kvar) om tjänsten inte ska förlängas.</div>)}
      <table className="ss-list"><thead><tr><th>Tjänst</th><th>Leverantör</th><th className="num">Pris</th><th className="num">Per månad</th><th>Licenser</th><th>Förnyas</th><th>Ansvarig</th><th></th></tr></thead>
        <tbody>{subscriptions.map((s) => (
          <tr key={s.id} className="ss-row" data-name={s.name} data-status={s.status}><td>{s.name}<div className="small muted">konto {s.account}</div></td><td className="small">{s.supplier ?? '–'}</td>
            <td className="num">{kr(s.cost)}/{PERIOD[s.period_months]}{s.priceChange != null && <div className="small ss-price">senaste fakturan {kr(s.last_net ?? 0)} ({s.priceChange > 0 ? '+' : ''}{s.priceChange} %)</div>}</td>
            <td className="num ss-row-monthly">{kr(s.monthly)}</td>
            <td className="small">{s.status === 'active' ? <form action={seatsAction.bind(null, id, s.id)} className="row" style={{ gap: '.25rem' }}><input name="seats_used" defaultValue={s.seats_used} style={{ width: '3.5rem' }} aria-label="Använda" /> av <input name="seats" defaultValue={s.seats} style={{ width: '3.5rem' }} aria-label="Licenser" /><button className="link">Spara</button></form> : `${s.seats_used} av ${s.seats}`}
              {s.unused > 0 && <div className="ss-row-unused">oanvänt {kr(s.unused)} kr/mån</div>}</td>
            <td className="small">{s.status === 'active' ? <>{s.renewal}<div className="muted">säg upp senast {s.notice.by}</div></> : <span className="ss-ends">uppsagt, upphör {s.renewal_date}</span>}</td>
            <td className="small">{s.owner}</td>
            <td>{s.status === 'active' && <form action={cancelAction.bind(null, id, s.id)}><button className="link">Säg upp</button></form>}</td></tr>))}
          {!subscriptions.length && <tr><td colSpan={8} className="muted">Inga abonnemang.</td></tr>}</tbody></table>

      {suggestions.length > 0 && <><h2>Ser ut som abonnemang</h2><p className="small">Leverantörer som fakturerat i minst tre olika månader det senaste halvåret men inte finns i listan.</p>
        <ul className="ss-suggestions">{suggestions.map((s) => <li key={s.id}>{s.name}: {s.months} månader, senast {kr(s.last)} kr exkl. moms</li>)}</ul></>}

      <h2>Nytt abonnemang</h2>
      <form action={addAction.bind(null, id)} className="card stack ss-add">
        <div className="row">
          <label>Tjänst<input name="name" required maxLength={100} /></label>
          <label>Leverantör<select name="supplier_id"><option value="">–</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>Kostnadskonto<input name="account" defaultValue="5420" style={{ width: '5rem' }} /></label>
          <label>Ansvarig<input name="owner" maxLength={100} /></label>
        </div>
        <div className="row">
          <label>Pris exkl. moms<input name="cost" inputMode="decimal" required /></label>
          <label>Per<select name="period_months">{Object.entries(PERIOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Licenser<input name="seats" defaultValue="1" style={{ width: '4rem' }} /></label>
          <label>Används<input name="seats_used" style={{ width: '4rem' }} /></label>
          <label>Förnyas<input type="date" name="renewal_date" required /></label>
          <label>Uppsägningstid (dagar)<input name="notice_days" defaultValue="30" style={{ width: '4rem' }} /></label>
        </div>
        <div><button>Spara abonnemang</button></div>
      </form>
    </div>
  );
}
