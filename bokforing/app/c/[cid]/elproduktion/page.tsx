import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/power';
import { certAction, monthAction, plantAction } from './actions';

export const dynamic = 'force-dynamic';
const k = (n: number) => `${n.toLocaleString('sv-SE')} kWh`;
const KIND: Record<string, string> = { sol: 'Solceller', vind: 'Vindkraft', vatten: 'Vattenkraft', annan: 'Annan' };

export default async function Power({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const t = today();
  const year = Number(sp.year) || Number(t.slice(0, 4));
  const o = await overview(id, year);
  return (
    <div style={{ maxWidth: 1050 }}>
      <h1>Egen elproduktion</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Registrera producerad, såld och köpt el per månad. Försäljningen bokförs mot 3060 med 25 % moms (eller utan moms om verksamheten är momsbefriad), elcertifikat och ursprungsgarantier mot 3061 när de säljs.
        {o.ef ? ' Underlaget för skattereduktion för mikroproduktion (inmatad el, högst köpt el och högst 30 000 kWh) visas per år för inkomstdeklarationen.' : ''}</p>
      <form method="get" className="row"><label>År<input name="year" type="number" defaultValue={year} style={{ width: '6rem' }} /></label><button className="secondary">Visa</button></form>
      {o.plants.map((p) => (
        <section key={p.id} className="card stack pw-plant" data-name={p.name}>
          <h2 style={{ margin: 0 }}>{p.name} <span className="small muted">{KIND[p.kind]}{p.capacity_kw ? `, ${p.capacity_kw.toLocaleString('sv-SE')} kW` : ''}{p.asset ? `, tillgång: ${p.asset}` : ''}</span></h2>
          <div className="row">
            <div className="card stat"><div className="label">Producerat {year}</div><div className="value pw-produced">{k(p.summary.produced)}</div></div>
            <div className="card stat"><div className="label">Sålt</div><div className="value pw-sold">{k(p.summary.sold)}</div></div>
            <div className="card stat"><div className="label">Egen förbrukning</div><div className="value pw-own">{k(p.summary.own)}</div></div>
            <div className="card stat"><div className="label">Intäkter</div><div className="value pw-revenue">{kr(p.summary.revenue)}</div></div>
            <div className="card stat"><div className="label">Återbetalningstid</div><div className="value pw-payback">{p.summary.payback != null ? `${p.summary.payback.toLocaleString('sv-SE')} år` : '–'}</div></div>
          </div>
          {o.ef && <p className="small pw-reduction">Skattereduktion {year}: underlag {k(p.reduction.basis)}{p.reduction.amount != null ? <> × {p.reduction.rate} öre = <b>{kr(p.reduction.amount)} kr</b></> : ' – nivån för året är inte känd här, kontrollera hos Skatteverket'}</p>}
          <table><thead><tr><th>Månad</th><th className="num">Producerat</th><th className="num">Sålt</th><th className="num">Köpt</th><th className="num">Ersättning exkl. moms</th></tr></thead>
            <tbody>{p.months.map((m) => <tr key={m.period}><td>{m.period}</td><td className="num">{k(m.produced_kwh)}</td><td className="num">{k(m.sold_kwh)}</td><td className="num">{k(m.bought_kwh)}</td><td className="num">{kr(m.sold_amount)}{m.vat_rate ? '' : ' (utan moms)'}</td></tr>)}
              {p.certs.map((c, i) => <tr key={`c${i}`}><td>{c.date}</td><td colSpan={3}>{c.quantity} {c.kind === 'elcert' ? 'elcertifikat' : 'ursprungsgarantier'}</td><td className="num">{kr(c.amount)}</td></tr>)}
              {!p.months.length && !p.certs.length && <tr><td colSpan={5} className="muted">Inget registrerat {year}.</td></tr>}</tbody></table>
          <form action={monthAction.bind(null, id, p.id)} className="row">
            <input type="hidden" name="year" value={year} />
            <label>Månad<input type="month" name="period" required /></label>
            <label>Producerat (kWh)<input name="produced_kwh" inputMode="decimal" style={{ width: '6rem' }} /></label>
            <label>Sålt (kWh)<input name="sold_kwh" inputMode="decimal" style={{ width: '6rem' }} /></label>
            <label>Köpt (kWh)<input name="bought_kwh" inputMode="decimal" style={{ width: '6rem' }} /></label>
            <label>Ersättning exkl. moms (kr)<input name="sold_amount" inputMode="decimal" style={{ width: '7rem' }} /></label>
            <label>Moms<select name="vat_rate"><option value="25">25 %</option><option value="0">Ingen (momsbefriad)</option></select></label>
            <button>Registrera månad</button>
          </form>
          <form action={certAction.bind(null, id, p.id)} className="row">
            <input type="hidden" name="year" value={year} />
            <label>Sålt<select name="kind"><option value="elcert">Elcertifikat</option><option value="guarantee">Ursprungsgarantier</option></select></label>
            <label>Antal<input name="quantity" inputMode="numeric" style={{ width: '5rem' }} /></label>
            <label>Ersättning exkl. moms (kr)<input name="amount" inputMode="decimal" style={{ width: '7rem' }} /></label>
            <label>Moms<select name="vat_rate"><option value="25">25 %</option><option value="0">Ingen</option></select></label>
            <label>Datum<input type="date" name="date" defaultValue={t} /></label>
            <button className="secondary">Bokför försäljning</button>
          </form>
        </section>))}
      <h2>Ny anläggning</h2>
      <form action={plantAction.bind(null, id)} className="row">
        <label>Namn<input name="name" required /></label>
        <label>Typ<select name="kind">{Object.entries(KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>Effekt (kW)<input name="capacity_kw" inputMode="decimal" style={{ width: '5rem' }} /></label>
        <label>Investering (kr)<input name="investment" inputMode="decimal" style={{ width: '8rem' }} /></label>
        <label>Anläggningstillgång<select name="asset_id"><option value="">–</option>{o.assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>Driftstart<input type="date" name="start_date" defaultValue={t} /></label>
        <button>Lägg upp anläggning</button>
      </form>
    </div>
  );
}
