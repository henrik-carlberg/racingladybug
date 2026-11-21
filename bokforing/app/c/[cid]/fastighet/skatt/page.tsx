import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { TYPE_LABEL } from '@/lib/property-tax';
import { overview, propertyForSale } from '@/lib/services/property-tax';
import { addProperty, bookTax, sellProperty } from './actions';

export const dynamic = 'force-dynamic';

/** Fastighetsskatt och fastighetsavgift per månad, och skattemässiga avskrivningar på byggnader och markanläggningar */
export default async function PropertyTax({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const sp = await searchParams;
  const t = today();
  const year = /^\d{4}$/.test(String(sp.year)) ? Number(sp.year) : Number(t.slice(0, 4));
  const o = await overview(company.id, year);
  const forSale = new Map(await Promise.all(o.rows.filter((r) => !r.sold_on).map(async (r) => [r.id, (await propertyForSale(company.id, r.id))] as const)));
  const k = (n: number) => (n / 100).toFixed(2).replace('.', ',');
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Fastighetsskatt och skattemässiga avskrivningar {year}</h1>
      <p className="small"><Link href={`/c/${company.id}/fastighet`}>← Fastighet och uthyrning</Link> · {[year - 1, year + 1].map((y) => <Link key={y} href={`?year=${y}`} style={{ marginRight: '.5rem' }}>{y}</Link>)}</p>
      <Flash searchParams={searchParams} />
      {o.rows.map((r) => (
        <section key={r.id} className="card stack tax-property" data-designation={r.designation}>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{r.designation} <span className="small muted">{r.label}, taxeringsvärde {kr(r.tax_value)} kr</span></h2>
          <p style={{ margin: 0 }}>{r.type === 'bostad' ? 'Fastighetsavgift' : 'Fastighetsskatt'} {year}: <b className="pt-yearly">{kr(r.tax.amount)}</b> kr ({r.tax.rule}). Bokfört i år: <span className="pt-booked">{kr(r.booked)}</span> kr.</p>
          {r.tax.amount > 0 && <form action={bookTax.bind(null, company.id, r.id)} className="row">
            <label>Bokför till och med<input type="month" name="until" defaultValue={`${year}-${t.slice(5, 7)}`} required /></label>
            <div style={{ flex: '0 0 auto' }}><button className="secondary">Bokför månaderna (5191 / 2513)</button></div>
          </form>}
          <table className="small"><tbody>
            <tr><td>Värdeminskningsavdrag byggnad ({String(r.building_rate).replace('.', ',')} % av {kr(r.building_cost)} kr{r.dep.months < 12 ? `, ${r.dep.months} mån` : ''})</td><td className="num pt-building">{kr(r.dep.building)}</td></tr>
            <tr><td>Värdeminskningsavdrag markanläggningar (5 % av {kr(r.improvement_cost)} kr)</td><td className="num pt-improvement">{kr(r.dep.improvement)}</td></tr>
            <tr><td>Mark ({kr(r.land_cost)} kr) – skrivs inte av</td><td className="num">0,00</td></tr>
            <tr><td>Skattemässigt restvärde byggnad efter året</td><td className="num">{kr(r.dep.residualBuilding)}</td></tr>
          </tbody></table>
          {r.sold_on && r.sale ? <p className="pt-sold" style={{ margin: 0 }}>Såld {r.sold_on} för {kr(r.sale.price)} kr. Bokfört värde {kr(r.sale.bookValue)} kr – {r.sale.result >= 0 ? 'vinst' : 'förlust'} <b>{kr(Math.abs(r.sale.result))}</b> kr i bokföringen.
              Skattemässigt: omkostnadsbelopp {kr(r.sale.tax.adjustedBasis)} kr, vinst <b className="pt-tax-gain">{kr(r.sale.tax.gain)}</b> kr, varav återförda värdeminskningsavdrag <span className="pt-recaptured">{kr(r.sale.tax.recaptured)}</span> kr (underlag till N6).</p>
            : <details className="pt-sell"><summary>Sälj fastigheten</summary>
              <form action={sellProperty.bind(null, company.id, r.id)} className="stack">
                <div className="row"><label>Tillträdesdag<input type="date" name="date" defaultValue={t} required /></label><label>Köpeskilling (kr)<input name="price" required /></label>
                  <label>Försäljningskostnader (kr)<input name="costs" /></label><label>Förbättringsutgifter (kr)<input name="improvements" /></label></div>
                <div className="row small">
                  <label>Byggnad 1110<input name="book_building" defaultValue={k(forSale.get(r.id)?.book.building ?? 0)} /></label><label>Ack. avskr. 1119<input name="book_building_dep" defaultValue={k(forSale.get(r.id)?.book.buildingDep ?? 0)} /></label>
                  <label>Mark 1130<input name="book_land" defaultValue={k(forSale.get(r.id)?.book.land ?? 0)} /></label><label>Markanl. 1150<input name="book_improvement" defaultValue={k(forSale.get(r.id)?.book.improvement ?? 0)} /></label>
                  <label>Ack. avskr. 1159<input name="book_improvement_dep" defaultValue={k(forSale.get(r.id)?.book.improvementDep ?? 0)} /></label></div>
                {!forSale.get(r.id)?.single && <p className="small muted" style={{ margin: 0 }}>Bolaget har flera fastigheter – ange den här fastighetens ackumulerade avskrivningar.</p>}
                <button>Bokför försäljningen</button>
              </form></details>}
        </section>
      ))}
      {o.rows.length > 0 && (
        <section className="card stack pt-summary">
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Till deklarationen</h2>
          <table><tbody>
            <tr><td>Bokförda avskrivningar på byggnader och markanläggningar (7820–7829)</td><td className="num pt-booked-dep">{kr(o.bookedDep)}</td></tr>
            <tr><td>Skattemässiga värdeminskningsavdrag</td><td className="num pt-tax-dep">{kr(o.taxDep)}</td></tr>
            <tr><td><b>{o.adjustment >= 0 ? 'Läggs till' : 'Dras av'} i INK2S</b></td><td className="num pt-adjustment"><b>{kr(Math.abs(o.adjustment))}</b></td></tr>
          </tbody></table>
          <p className="small muted" style={{ margin: 0 }}>Bokförd avskrivning återförs och det skattemässiga värdeminskningsavdraget dras av i stället.</p>
        </section>
      )}
      <form action={addProperty.bind(null, company.id)} className="card stack" style={{ marginTop: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Ny fastighet</h2>
        <div className="row">
          <label>Fastighetsbeteckning<input name="designation" required maxLength={200} placeholder="T.ex. Eken 4" /></label>
          <label>Typ<select name="type">{Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Taxeringsvärde (kr)<input name="tax_value" required /></label>
        </div>
        <div className="row">
          <label>Antal lägenheter (bostäder)<input name="apartments" defaultValue="0" /></label>
          <label>Takbelopp per lägenhet (kr, årets)<input name="cap_per_apartment" placeholder="Enligt Skatteverket för året" /></label>
          <label>Värdeår<input name="value_year" placeholder="T.ex. 1975" /></label>
        </div>
        <div className="row">
          <label>Förvärvad<input type="date" name="acquired" required /></label>
          <label>Byggnad, anskaffningsvärde (kr)<input name="building_cost" /></label>
          <label>Avskrivning byggnad (%)<input name="building_rate" defaultValue="4" style={{ width: '5rem' }} /></label>
          <label>Markanläggningar (kr)<input name="improvement_cost" /></label>
          <label>Mark (kr)<input name="land_cost" /></label>
        </div>
        <button>Lägg upp fastigheten</button>
        <p className="small muted" style={{ margin: 0 }}>Byggnader skrivs normalt av med 2 % (bostäder), 3–4 % (kontor, butiker) eller 5 % (industri). Bostäder betalar fastighetsavgift: 0,3 % av taxeringsvärdet, men högst takbeloppet per lägenhet; nybyggda bostäder är befriade de första 15 åren.</p>
      </form>
    </div>
  );
}
