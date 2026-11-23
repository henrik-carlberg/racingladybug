import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { fmt } from '@/lib/bookings';
import { overview } from '@/lib/services/bookings';
import { bookAction, closeAction, doneAction, prepayAction, serviceAction, settingsAction } from './actions';

export const dynamic = 'force-dynamic';
const STATUS: Record<string, string> = { booked: 'Bokad', prepaid: 'Förskott betalt', done: 'Utförd', no_show: 'Uteblev', cancelled: 'Avbokad' };

export default async function Bookings({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const id = company.id;
  const t = today();
  const d = typeof sp.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : t;
  const o = await overview(id, d);
  const s = o.settings;
  const hid = <input type="hidden" name="view_date" value={d} />;
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Tidsbokning</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Kunderna bokar tider via en publik länk. Förskott bokförs när det tas emot: momsen redovisas direkt och resten är förutbetald intäkt (2420) tills tjänsten är utförd.
        Vid avbokning i tid betalas förskottet tillbaka; vid sen avbokning eller uteblivet besök behålls avgiften enligt reglerna nedan.</p>
      {s && <p className="small bk-link">Bokningslänk: <code>/boka/{s.token}</code> – öppet {fmt(s.open_from)}–{fmt(s.open_to)}, veckodagar {s.weekdays}, avbokning senast {s.cancel_hours} timmar före, {s.no_show_pct} % behålls vid uteblivet besök.</p>}
      <div className="row"><div className="card stat"><div className="label">Förskott för kommande tjänster</div><div className="value bk-advance">{kr(o.advance)}</div></div></div>
      <table className="bk-list"><thead><tr><th>Dag</th><th>Tid</th><th>Tjänst</th><th>Kund</th><th className="num">Pris</th><th>Status</th><th></th></tr></thead>
        <tbody>{o.bookings.map((b) => (
          <tr key={b.id} className="bk-row" data-customer={b.customer_name} data-status={b.status}><td>{b.date}</td><td>{b.time}</td><td>{b.service}</td><td>{b.customer_name}{b.source === 'online' && <span className="small muted"> (online)</span>}</td>
            <td className="num">{kr(b.price)}</td><td className="small">{STATUS[b.status]}{b.kept ? ` – ${kr(b.kept)} kr behållet` : ''}</td>
            <td>{['booked', 'prepaid'].includes(b.status) && <div className="row" style={{ gap: '.25rem' }}>
              {b.status === 'booked' && b.price > 0 && <form action={prepayAction.bind(null, id, b.id)}>{hid}<button className="link">Förskott betalt</button></form>}
              <form action={doneAction.bind(null, id, b.id)}>{hid}<button className="link">Utförd</button></form>
              <form action={closeAction.bind(null, id, b.id, 'cancelled')}>{hid}<button className="link">Avboka</button></form>
              <form action={closeAction.bind(null, id, b.id, 'no_show')}>{hid}<button className="link">Uteblev</button></form></div>}</td></tr>))}
          {!o.bookings.length && <tr><td colSpan={7} className="muted">Inga bokningar.</td></tr>}</tbody></table>
      {s && o.services.length > 0 && <form action={bookAction.bind(null, id)} className="card row">{hid}
        <label>Tjänst<select name="service_id">{o.services.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.minutes} min)</option>)}</select></label>
        <label>Dag<input type="date" name="date" defaultValue={d} required /></label>
        <label>Tid<input name="time" placeholder="10:00" required style={{ width: '5rem' }} /></label>
        <label>Kund<input name="customer_name" required /></label>
        <label>E-post<input name="customer_email" type="email" /></label>
        <button>Boka</button>
      </form>}
      <h2>Tjänster</h2>
      <table className="bk-stats"><thead><tr><th>Tjänst</th><th className="num">Utförda (90 dagar)</th><th className="num">Uteblivna</th><th className="num">Intäkt inkl. moms</th></tr></thead>
        <tbody>{o.stats.map((x) => <tr key={x.service} data-service={x.service}><td>{x.service}</td><td className="num">{x.done}</td><td className="num">{x.no_show}</td><td className="num bk-revenue">{kr(x.revenue)}</td></tr>)}
          {!o.stats.length && <tr><td colSpan={4} className="muted">Inga tjänster ännu.</td></tr>}</tbody></table>
      <form action={serviceAction.bind(null, id)} className="row">
        <label>Tjänst<input name="name" required /></label>
        <label>Längd (min)<input name="minutes" inputMode="numeric" defaultValue="60" style={{ width: '5rem' }} /></label>
        <label>Pris inkl. moms<input name="price" inputMode="decimal" style={{ width: '7rem' }} /></label>
        <label>Moms<select name="vat_rate" defaultValue="25"><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option><option value="0">0 %</option></select></label>
        <label className="row"><input type="checkbox" name="prepay" /> Förskott vid bokning</label>
        <button className="secondary">Lägg upp tjänst</button>
      </form>
      <h2>Öppettider och regler</h2>
      <form action={settingsAction.bind(null, id)} className="row">
        <label>Öppnar<input name="open_from" defaultValue={s ? fmt(s.open_from) : '09:00'} style={{ width: '5rem' }} /></label>
        <label>Stänger<input name="open_to" defaultValue={s ? fmt(s.open_to) : '17:00'} style={{ width: '5rem' }} /></label>
        <label>Veckodagar (1 = mån)<input name="weekdays" defaultValue={s?.weekdays ?? '1,2,3,4,5'} style={{ width: '8rem' }} /></label>
        <label>Avbokning senast (timmar)<input name="cancel_hours" defaultValue={s?.cancel_hours ?? 24} inputMode="numeric" style={{ width: '5rem' }} /></label>
        <label>Behålls vid uteblivet besök %<input name="no_show_pct" defaultValue={s?.no_show_pct ?? 100} inputMode="numeric" style={{ width: '5rem' }} /></label>
        <button className="secondary">{s ? 'Spara' : 'Aktivera tidsbokning'}</button>
      </form>
    </div>
  );
}
