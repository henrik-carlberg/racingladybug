import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCompany } from '@/lib/server/auth';
import { ValidationError } from '@/lib/errors';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { CAPITAL_TAX, EXPANSION_TAX } from '@/lib/ef-tax';
import { planning } from '@/lib/services/ef-tax';
import { book, saveParams } from './actions';

export const dynamic = 'force-dynamic';

export default async function NePlanning({ params, searchParams }: { params: Promise<{ cid: string; fyid: string }>; searchParams: SP }) {
  const { cid, fyid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const fy = Number(fyid);
  const pl = await planning(company.id, fy).catch((e) => { if (e instanceof ValidationError) notFound(); throw e; });
  const p = pl.proposal;
  const row = (label: string, a: number, b: number, cls = '') => <tr className={cls}><td>{label}</td><td className="num">{kr(a)}</td><td className="num">{kr(b)}</td></tr>;
  return (
    <div style={{ maxWidth: 900 }}>
      <div className="header"><h1>Skatteplanering NE {pl.year}</h1><Link className="btn secondary" href={`/c/${company.id}/bokslut/${fy}`}>Tillbaka</Link></div>
      <p className="muted">Räntefördelning, periodiseringsfond och expansionsfond för enskild firma, och hur de påverkar skatt och egenavgifter. Beräkningen är en uppskattning utan grundavdrag och jobbskatteavdrag; kontrollera beloppen i Skatteverkets e-tjänst innan du deklarerar.</p>
      <Flash searchParams={searchParams} />
      <form action={saveParams.bind(null, company.id, fy)} className="card row">
        <label>Statslåneränta 30 nov året före (%)<input name="slr_pct" inputMode="decimal" defaultValue={pl.params?.slr_pct ?? ''} required /></label>
        <label>Kommunalskatt (%)<input name="municipal_pct" inputMode="decimal" defaultValue={pl.params?.municipal_pct ?? ''} required /></label>
        <label>Brytpunkt för statlig skatt (kr)<input name="brytpunkt" inputMode="decimal" defaultValue={pl.params ? String(pl.params.brytpunkt / 100) : ''} required /></label>
        <button className="secondary">Spara satser</button>
      </form>
      {!p ? <p>Ange årets satser för att se förslaget. Statslåneräntan och brytpunkten publiceras av Riksgälden respektive Skatteverket.</p> : (<>
        <div className="grid">
          <div className="card stat"><div className="label">Överskott</div><div className="value">{kr(p.surplus)}</div></div>
          <div className="card stat"><div className="label">Skatt och avgifter utan planering</div><div className="value">{kr(p.base.total)}</div></div>
          <div className="card stat"><div className="label">Med förslaget</div><div className="value ef-total">{kr(p.plan.total)}</div><div className="small muted">varav uppskjutet i fonder</div></div>
          <div className="card stat"><div className="label">Lägre skatt i år</div><div className="value ef-saving">{kr(p.saving)}</div></div>
        </div>
        <h2>Förslag</h2>
        <table className="ef-plan"><thead><tr><th></th><th className="num">Utan planering</th><th className="num">Förslag</th></tr></thead><tbody>
          {row(p.allocation.kind === 'negative' ? 'Negativ räntefördelning (obligatorisk, ökar näringsinkomsten)' : `Positiv räntefördelning (beskattas med ${CAPITAL_TAX * 100} % som kapital, högst ${(p.allocation.max / 100).toLocaleString('sv-SE')} kr)`, p.base.interest, p.plan.interest, 'ef-interest')}
          {row(`Periodiseringsfond (högst ${(p.pfondMax / 100).toLocaleString('sv-SE')} kr)`, 0, p.plan.pfond, 'ef-pfond')}
          {row(`Expansionsfond (${EXPANSION_TAX * 100} % nu, högst ${(p.expMax / 100).toLocaleString('sv-SE')} kr)`, 0, p.plan.expansion, 'ef-expansion')}
          {row('Aktiv näringsinkomst före schablonavdrag', p.base.active, p.plan.active, 'ef-active')}
          {row('Skatt och egenavgifter på näringsinkomsten', p.base.tax, p.plan.tax)}
          {row('Kapitalskatt på räntefördelningen', p.base.capitalTax, p.plan.capitalTax)}
          {row('Expansionsfondsskatt', p.base.expansionTax, p.plan.expansionTax)}
          {row('Summa', p.base.total, p.plan.total)}
        </tbody></table>
        <p className="small muted">Ordningen: räntefördelningen tas ut fullt när den beskattas lägre än näringsinkomsten. Därefter sänks inkomsten till brytpunkten med periodiseringsfond (skjuter upp skatten i högst sex år) och expansionsfond. Schablonavdraget för egenavgifter är 25 %.</p>
        {pl.booked ? <p className="badge ok ef-booked">Fondavsättningarna är bokförda.</p> : !pl.closed && (p.plan.pfond > 0 || p.plan.expansion > 0) && (
          <form action={book.bind(null, company.id, fy)} className="card row">
            <label>Periodiseringsfond (kr)<input name="pfond" inputMode="decimal" defaultValue={String(p.plan.pfond / 100)} /></label>
            <label>Expansionsfond (kr)<input name="expansion" inputMode="decimal" defaultValue={String(p.plan.expansion / 100)} /></label>
            <button>Bokför avsättningarna</button>
          </form>)}
        <p className="small muted">Räntefördelningen bokförs inte – den förs in direkt i NE-bilagan.</p>
      </>)}
    </div>
  );
}
