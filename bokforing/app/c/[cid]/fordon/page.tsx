import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { EVENTS } from '@/lib/vehicle-register';
import { overview } from '@/lib/services/vehicle-register';
import { eventAction, vehicleAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function Vehicles({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const o = await overview(id);
  const t = today();
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Fordonsregister</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Bolagets fordon med besiktning, försäkring, service och däckbyten. Drivmedel, service och reparationer bokförs på 561x med avdragsgill moms, fordonsskatt och försäkring utan moms.
        Körda mil hämtas från <Link href={`/c/${id}/korjournal`}>körjournalen</Link> och kostnaden per mil räknas på årets kostnader och avskrivningen i anläggningsregistret.</p>
      {o.tyres && <div className="card small vr-tyres">{o.tyres}.</div>}
      {o.vehicles.map((v) => (
        <div key={v.id} className="card stack vr-vehicle" data-reg={v.reg_no}>
          <div><strong>{v.reg_no}</strong> {v.name}{v.model && ` · ${v.model}`}{v.model_year && ` (${v.model_year})`}{v.fuel && ` · ${v.fuel}`}{v.asset && <span className="small muted"> · inventarie: {v.asset}</span>}</div>
          {v.reminders.map((r) => <div key={r.kind} className="small vr-reminder" data-kind={r.kind} data-overdue={r.overdue ? '1' : '0'}>{r.text}</div>)}
          <div className="small vr-figures">Mätarställning <span className="vr-odo">{v.odometer ?? '–'}</span> km · körda mil {o.year}: {(v.km / 10).toLocaleString('sv-SE')} · kostnader {o.year}: <span className="vr-costs">{kr(v.costs)}</span> kr
            {v.depreciation > 0 && <> · avskrivning {kr(v.depreciation)} kr</>} · per mil: <span className="vr-per-mil">{v.perMil != null ? kr(v.perMil) : '–'}</span> kr</div>
          <div className="small">Besiktning {v.inspection_due ?? '–'} · försäkring till {v.insurance_until ?? '–'} · service {v.service_due_date ?? ''}{v.service_due_km != null && ` vid ${v.service_due_km} km`}</div>
          <form action={eventAction.bind(null, id, v.id)} className="row vr-event" style={{ gap: '.25rem' }}>
            <select name="kind">{Object.entries(EVENTS).map(([k, e]) => <option key={k} value={k}>{e.label}</option>)}</select>
            <input type="date" name="date" defaultValue={t} /><input name="amount" placeholder="Belopp exkl. moms" inputMode="decimal" style={{ width: '8rem' }} /><input name="vat" placeholder="Moms" inputMode="decimal" style={{ width: '6rem' }} />
            <input name="odometer" placeholder="Mätare (km)" inputMode="numeric" style={{ width: '7rem' }} /><input type="date" name="next_date" aria-label="Nästa datum" title="Nästa besiktning, service eller förnyelse" /><input name="next_km" placeholder="Nästa service (km)" inputMode="numeric" style={{ width: '9rem' }} />
            <input name="note" placeholder="Anteckning" /><button className="link">Registrera</button></form>
          {v.events.length > 0 && <ul className="small vr-events">{v.events.map((e) => <li key={e.id}>{e.date} {EVENTS[e.kind].label}{e.amount ? `: ${kr(e.amount)} kr` : ''}{e.odometer != null && ` · ${e.odometer} km`}{e.note && ` · ${e.note}`}</li>)}</ul>}
        </div>))}
      {!o.vehicles.length && <p className="muted">Inga fordon registrerade.</p>}

      <h2>Registrera eller uppdatera fordon</h2>
      <form action={vehicleAction.bind(null, id)} className="card stack vr-add">
        <div className="row">
          <label>Registreringsnummer<input name="reg_no" required maxLength={12} /></label>
          <label>Benämning<input name="name" maxLength={100} /></label>
          <label>Modell<input name="model" maxLength={100} /></label>
          <label>Årsmodell<input name="model_year" inputMode="numeric" style={{ width: '5rem' }} /></label>
          <label>Drivmedel<input name="fuel" maxLength={40} placeholder="El, diesel …" /></label>
        </div>
        <div className="row">
          <label>Nästa besiktning<input type="date" name="inspection_due" /></label>
          <label>Försäkring till<input type="date" name="insurance_until" /></label>
          <label>Service senast<input type="date" name="service_due_date" /></label>
          <label>eller vid (km)<input name="service_due_km" inputMode="numeric" style={{ width: '7rem' }} /></label>
          <label>Inventarie<select name="asset_id"><option value="">–</option>{o.assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        </div>
        <div><button>Spara fordon</button></div>
      </form>
    </div>
  );
}
