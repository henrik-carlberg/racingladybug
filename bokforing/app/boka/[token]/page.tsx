import { notFound } from 'next/navigation';
import { kr, today } from '@/lib/format';
import { publicInfo } from '@/lib/services/bookings';
import { publicBookAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

export default async function PublicBooking({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const t = today();
  const d = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date >= t ? sp.date : t;
  const info = await publicInfo(token, d);
  if (!info) notFound();
  return (
    <main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Boka tid hos {info.company}</h1>
      {sp.ok && <p className="flash ok" role="status">{sp.ok}</p>}
      {sp.fel && <p className="flash error" role="alert">{sp.fel}</p>}
      <form method="get" className="row"><label>Dag<input type="date" name="date" defaultValue={d} min={t} /></label><button className="secondary">Visa lediga tider</button></form>
      {!info.open && <p className="muted">Stängt den dagen.</p>}
      {info.services.map((s) => (
        <section key={s.id} className="card stack pb-service" data-name={s.name}>
          <b>{s.name}</b><span className="small muted">{s.minutes} min · {kr(s.price)} kr{s.prepay ? ' · betalas i förskott' : ''}</span>
          {s.slots.length ? <form action={publicBookAction.bind(null, token)} className="stack">
            <input type="hidden" name="service_id" value={s.id} /><input type="hidden" name="date" value={d} />
            <label>Tid<select name="time">{s.slots.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
            <label>Namn<input name="customer_name" required /></label>
            <label>E-post<input name="customer_email" type="email" required /></label>
            <label>Telefon<input name="customer_phone" /></label>
            <button>Boka</button>
          </form> : info.open && <p className="small muted">Inga lediga tider den dagen.</p>}
        </section>))}
      <p className="small muted">Avbokning senast {info.cancelHours} timmar före besöket.</p>
    </main>
  );
}
