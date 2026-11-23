import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/vehicle-log';
import { settleAction, tripAction, vehicleAction } from './actions';

export const dynamic = 'force-dynamic';
const km = (n: number) => `${n.toLocaleString('sv-SE')} km`;

export default async function VehicleLog({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const t = today();
  const year = Number(sp.year) || Number(t.slice(0, 4));
  const o = await overview(id, year);
  return (
    <div style={{ maxWidth: 1050 }}>
      <h1>Körjournal</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Logga varje resa med datum, sträcka och ärende – tjänsteresa eller privat – och koppla den gärna till en kund. Körjournalen är underlag för förmånsvärde, moms på bilkostnader och avdrag.
        {o.ef ? ' I enskild firma räknas årets avdrag för egen bil i tjänsten (25 kr per mil, 7331/2018) och uttaget för privat körning med firmans bil (självkostnad per mil, 2013/3990) fram och bokförs per den 31 december.'
          : <> Anställdas resor med egen bil ersätts via <Link href={`/c/${id}/m/utlagg`}>utlägg</Link>, och privat körning med företagets bil är en <Link href={`/c/${id}/lon/bilforman`}>bilförmån</Link>.</>}</p>
      <form method="get" className="row"><label>År<input name="year" type="number" defaultValue={year} style={{ width: '6rem' }} /></label><button className="secondary">Visa</button></form>

      {o.vehicles.map((v) => (
        <section key={v.id} className="card stack vl-vehicle" data-reg={v.reg_no}>
          <h2 style={{ margin: 0 }}>{v.reg_no} {v.name && <span className="muted">{v.name}</span>} <span className="small muted">{v.owner === 'company' ? 'Företagets bil' : 'Egen bil'}</span></h2>
          <div className="row">
            <div className="card stat"><div className="label">Tjänst</div><div className="value vl-business">{km(v.summary.business)}</div></div>
            <div className="card stat"><div className="label">Privat</div><div className="value vl-private">{km(v.summary.private)}</div></div>
            <div className="card stat"><div className="label">Privat andel</div><div className="value vl-share">{v.summary.privateShare.toLocaleString('sv-SE')} %</div></div>
          </div>
          {v.summary.customers.length > 0 && <p className="small vl-customers">Per kund: {v.summary.customers.map((c) => `${c.customer} ${km(c.km)}`).join(', ')}</p>}
          {v.proposal && (v.settled
            ? <p className="small vl-settled">Avräknat {year}: {kr(v.settled.amount)} kr ({v.settled.kind === 'private_use' ? 'uttag för privat körning' : 'avdrag för egen bil i tjänsten'})</p>
            : <form action={settleAction.bind(null, id, v.id, year)} className="row">
              <span className="small vl-proposal">{v.proposal.kind === 'private_use' ? `Uttag för privat körning: ${km(v.proposal.km)} à ${kr(v.proposal.rate)} kr/mil = ` : `Avdrag för egen bil i tjänsten: ${km(v.proposal.km)} à ${kr(v.proposal.rate)} kr/mil = `}<b>{kr(v.proposal.amount)} kr</b></span>
              {v.proposal.kind === 'private_use' && <label className="small">Kostnad per mil (kr)<input name="rate" placeholder={kr(v.proposal.rate)} inputMode="decimal" style={{ width: '6rem' }} /></label>}
              <button>Bokför årsavräkning</button></form>)}
          <table className="vl-trips"><thead><tr><th>Datum</th><th>Från–till</th><th>Ärende</th><th>Kund</th><th className="num">Mätare</th><th className="num">Sträcka</th></tr></thead>
            <tbody>{v.trips.map((x) => <tr key={x.id}><td>{x.date}</td><td>{x.from_place}{x.to_place && `–${x.to_place}`}</td><td>{x.private ? <i>Privat</i> : x.purpose}</td><td>{x.customer ?? ''}</td>
              <td className="num small">{x.odo_start != null ? `${x.odo_start}–${x.odo_end}` : ''}</td><td className="num">{km(x.km)}</td></tr>)}
              {!v.trips.length && <tr><td colSpan={6} className="muted">Inga resor {year}.</td></tr>}</tbody></table>
        </section>))}
      {o.ef && <p className="small">Bilkostnader {year} (56xx): <span className="vl-costs">{kr(o.costs)}</span> kr, självkostnad <span className="vl-cpm">{kr(o.costPerMil)}</span> kr per mil för företagets bilar.</p>}

      {o.vehicles.length > 0 && <><h2>Ny resa</h2>
        <form action={tripAction.bind(null, id)} className="card stack">
          <input type="hidden" name="year" value={year} />
          <div className="row">
            <label>Fordon<select name="vehicle_id">{o.vehicles.map((v) => <option key={v.id} value={v.id}>{v.reg_no}</option>)}</select></label>
            <label>Datum<input type="date" name="date" defaultValue={t} required /></label>
            <label>Från<input name="from_place" /></label>
            <label>Till<input name="to_place" /></label>
          </div>
          <div className="row">
            <label>Mätare vid avfärd<input name="odo_start" inputMode="numeric" style={{ width: '7rem' }} /></label>
            <label>Mätare vid ankomst<input name="odo_end" inputMode="numeric" style={{ width: '7rem' }} /></label>
            <label>eller sträcka (km)<input name="km" inputMode="decimal" style={{ width: '6rem' }} /></label>
          </div>
          <div className="row">
            <label>Ärende<input name="purpose" /></label>
            <label>Kund<select name="customer_id"><option value="">–</option>{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="row"><input type="checkbox" name="private" /> Privat resa</label>
          </div>
          <div><button>Spara resa</button></div>
        </form></>}

      <h2>Lägg till fordon</h2>
      <form action={vehicleAction.bind(null, id)} className="row">
        <input type="hidden" name="year" value={year} />
        <label>Registreringsnummer<input name="reg_no" required style={{ width: '8rem' }} /></label>
        <label>Benämning<input name="name" /></label>
        <label>Ägs av<select name="owner"><option value="company">Företaget</option><option value="private">{o.ef ? 'Mig privat (egen bil i tjänsten)' : 'Privatperson'}</option></select></label>
        <button>Lägg till fordon</button>
      </form>
    </div>
  );
}
