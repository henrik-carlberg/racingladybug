import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { overview } from '@/lib/services/product-costing';
import { ackAction, createAction, priceAction } from './actions';

export const dynamic = 'force-dynamic';
const pctFmt = (n: number | null) => (n == null ? '–' : `${n.toLocaleString('sv-SE')} %`);

export default async function Costing({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const id = company.id;
  const { calcs, products } = await overview(id);
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Produktkalkyl</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Självkostnadskalkyl enligt påläggsmetoden: direkt material med materialomkostnader (MO), direkt lön med tillverkningsomkostnader (TO) och påslag för administration och försäljning (AFFO).
        Täckningsbidraget är priset minus de rörliga kostnaderna (material och lön). Material som är kopplat till en artikel räknas med senaste inköpspriset, så kalkylen följer med när leverantörerna höjer priserna.</p>
      {calcs.filter((c) => c.below || c.change > 0).map((c) => <div key={c.id} className="card small pc-warning" data-name={c.name}>
        {c.name}: {c.change > 0 && `självkostnaden har ökat ${c.change.toLocaleString('sv-SE')} % sedan kalkylen sparades. `}{c.below && `Marginalen är ${pctFmt(c.margin)} mot målet ${pctFmt(c.target_margin)} – föreslaget pris ${c.suggested ? kr(c.suggested) : '–'} kr.`}</div>)}
      <table className="pc-list"><thead><tr><th>Kalkyl</th><th className="num">Material</th><th className="num">Lön</th><th className="num">Självkostnad</th><th className="num">Pris</th><th className="num">TB</th><th className="num">Marginal</th><th></th></tr></thead>
        <tbody>{calcs.map((c) => (
          <tr key={c.id} className="pc-row" data-name={c.name}><td>{c.name}{c.product && <div className="small muted">{c.product}</div>}
            <ul className="small">{c.lines.map((l) => <li key={l.id}>{l.qty.toLocaleString('sv-SE')} × {l.component ?? l.description} à {kr(l.cost)}{l.component && l.current_cost == null ? ' (inget inköpspris)' : ''}</li>)}</ul></td>
            <td className="num">{kr(c.material)}</td><td className="num">{kr(c.labour)}</td><td className="num pc-self">{kr(c.selfCost)}</td><td className="num pc-price">{kr(c.price)}</td>
            <td className="num pc-tb">{kr(c.contribution)}<div className="small">{pctFmt(c.contributionPct)}</div></td><td className="num pc-margin">{pctFmt(c.margin)}</td>
            <td>{c.suggested && <form action={priceAction.bind(null, id, c.id)}><button className="link">Använd {kr(c.suggested)} kr</button></form>}
              {c.change !== 0 && <form action={ackAction.bind(null, id, c.id)}><button className="link">Granskad</button></form>}</td></tr>))}
          {!calcs.length && <tr><td colSpan={8} className="muted">Inga kalkyler.</td></tr>}</tbody></table>

      <h2>Ny kalkyl</h2>
      <form action={createAction.bind(null, id)} className="card stack pc-add">
        <div className="row">
          <label>Kalkyl<input name="name" required maxLength={150} /></label>
          <label>Artikel (pris hämtas därifrån)<select name="product_id"><option value="">– ingen –</option>{products.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
          <label>eller pris exkl. moms<input name="price" inputMode="decimal" style={{ width: '7rem' }} /></label>
          <label>Antal per sats<input name="batch_qty" defaultValue="1" style={{ width: '5rem' }} /></label>
        </div>
        <table><thead><tr><th>Material</th><th>Beskrivning</th><th>Antal</th><th>Kostnad per enhet</th></tr></thead>
          <tbody>{[0, 1, 2, 3].map((i) => <tr key={i}><td><select name={`component_${i}`}><option value="">–</option>{products.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></td>
            <td><input name={`desc_${i}`} /></td><td><input name={`qty_${i}`} style={{ width: '5rem' }} /></td><td><input name={`cost_${i}`} inputMode="decimal" placeholder="om ingen artikel" style={{ width: '8rem' }} /></td></tr>)}</tbody></table>
        <div className="row">
          <label>Arbetstid (min per sats)<input name="labour_minutes" style={{ width: '6rem' }} /></label>
          <label>Timkostnad inkl. avgifter<input name="labour_rate" inputMode="decimal" style={{ width: '7rem' }} /></label>
          <label>MO %<input name="mo_pct" defaultValue="0" style={{ width: '4rem' }} /></label>
          <label>TO %<input name="to_pct" defaultValue="0" style={{ width: '4rem' }} /></label>
          <label>AFFO %<input name="affo_pct" defaultValue="0" style={{ width: '4rem' }} /></label>
          <label>Målmarginal %<input name="target_margin" defaultValue="20" style={{ width: '4rem' }} /></label>
        </div>
        <div><button>Spara kalkyl</button></div>
      </form>
    </div>
  );
}
