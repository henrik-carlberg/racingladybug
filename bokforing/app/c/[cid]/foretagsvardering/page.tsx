import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { overview } from '@/lib/services/valuation';
import { saveAction, toggleAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function Valuation({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  await requireCompany(cid, { perm: 'payroll' });
  const o = await overview(company.id);
  const p = o.plan, tr = o.transfer;
  return (
    <div style={{ maxWidth: 1050 }}>
      <h1>Företagsvärdering och ägarskifte</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Tre sätt att värdera bolaget utifrån bokföringen: substansvärdet (eget kapital plus obeskattade reserver och övervärden efter 20,6 % latent skatt), avkastningsvärdet (genomsnittligt rörelseresultat efter skatt delat med avkastningskravet)
        och en EBIT-multipel plus nettokassa. Värdet är ett underlag – en köpare eller värderare gör sin egen bedömning.</p>
      <div className="row">{o.values.map((v) => <div key={v.key} className="card stat bv-value" data-key={v.key}><div className="label">{v.label}</div><div className="value">{kr(v.value)}</div></div>)}</div>
      <p className="small bv-range">Intervall: <strong>{kr(o.range[0])}</strong> – <strong>{kr(o.range[1])}</strong> kr</p>
      <table className="small"><tbody>
        <tr><td>Eget kapital</td><td className="num">{kr(o.equity)}</td></tr><tr><td>Obeskattade reserver</td><td className="num">{kr(o.untaxedReserves)}</td></tr>
        <tr><td>Likvida medel och kortfristiga placeringar</td><td className="num">{kr(o.cash)}</td></tr><tr><td>Räntebärande skulder</td><td className="num">{kr(o.debt)}</td></tr>
        {o.ebits.map((e) => <tr key={e.label}><td>Rörelseresultat {e.label}</td><td className="num">{kr(e.ebit)}</td></tr>)}
        <tr className="sum"><td>Genomsnittligt rörelseresultat</td><td className="num bv-ebit">{kr(o.avgEbit)}</td></tr></tbody></table>

      <h2>Antaganden och ägarskifte</h2>
      <form action={saveAction.bind(null, company.id)} className="card stack">
        <div className="row">
          <label>EBIT-multipel<input name="ebit_multiple" inputMode="decimal" defaultValue={String(p.ebit_multiple)} required /></label>
          <label>Avkastningskrav %<input name="required_return" inputMode="decimal" defaultValue={String(p.required_return)} required /></label>
          <label>Övervärden i tillgångar (kr)<input name="surplus_value" inputMode="decimal" defaultValue={p.surplus_value ? String(p.surplus_value / 100) : ''} /></label>
        </div>
        <div className="row">
          <label>Överlåtelse<select name="transfer_kind" defaultValue={p.transfer_kind}><option value="sale">Försäljning</option><option value="gift">Gåva (t.ex. generationsskifte)</option></select></label>
          <label>Ägare<select name="owner_id" defaultValue={p.owner_id ? String(p.owner_id) : ''}><option value="">–</option>{o.owners.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.share_pct.toLocaleString('sv-SE')} %)</option>)}</select></label>
          <label>Andel av bolaget %<input name="share_pct" inputMode="decimal" defaultValue={String(p.share_pct)} /></label>
          <label>Ersättning (kr)<input name="price" inputMode="decimal" defaultValue={p.price ? String(p.price / 100) : ''} /></label>
          <label>Köpare/mottagare<input name="recipient" defaultValue={p.recipient} maxLength={200} /></label>
          <label className="small"><input type="checkbox" name="qualified" defaultChecked={p.qualified} /> Kvalificerade andelar (3:12)</label>
        </div>
        <div><button>Spara</button></div>
      </form>
      {!o.owners.length && <p className="small muted">Lägg in ägarna under <Link href={`/c/${company.id}/agare`}>Ägare och utdelning</Link> för att räkna på skatten vid ägarskiftet.</p>}
      {tr && <section className="card bv-transfer">
        <h3 style={{ marginTop: 0 }}>{p.transfer_kind === 'sale' ? 'Försäljning' : 'Gåva'} av {p.share_pct.toLocaleString('sv-SE')} % från {tr.owner.name}{p.recipient && ` till ${p.recipient}`}</h3>
        <p className="small">Andelens värde: {tr.shareValues.map((v) => `${kr(v.value)} kr`).join(' / ')} · omkostnadsbelopp {kr(tr.costBasis)} kr · gränsbelopp (utan lönebaserat utrymme) {kr(tr.limit)} kr</p>
        {tr.giftTaxedAsSale && <p className="warn small">Ersättningen överstiger omkostnadsbeloppet – enligt huvudsaklighetsprincipen beskattas överlåtelsen som en försäljning.</p>}
        {tr.gift ? <p className="bv-gift">Ingen skatt vid överlåtelsen: ersättningen överstiger inte omkostnadsbeloppet. Mottagaren tar över omkostnadsbeloppet och det sparade utdelningsutrymmet.</p>
          : tr.tax && <table className="bv-tax"><tbody>
            <tr><td>Kapitalvinst</td><td className="num">{kr(tr.tax.gain)}</td></tr>
            <tr><td>Inom gränsbeloppet (20 %)</td><td className="num">{kr(tr.tax.within)}</td></tr>
            <tr><td>Beskattas som tjänst (upp till 100 inkomstbasbelopp, ca 52 %)</td><td className="num">{kr(tr.tax.service)}</td></tr>
            <tr><td>Över takbeloppet (20 %)</td><td className="num">{kr(tr.tax.above)}</td></tr>
            <tr className="sum"><td>Skatt</td><td className="num bv-taxsum">{kr(tr.tax.tax)}</td></tr>
            <tr><td>Kvar efter skatt</td><td className="num">{kr(tr.tax.net)}</td></tr></tbody></table>}
      </section>}

      <h2>Checklista – {p.transfer_kind === 'sale' ? 'försäljning' : 'gåva'}</h2>
      <ul className="stack bv-checklist" style={{ listStyle: 'none', padding: 0 }}>{o.checklist.map((c) => <li key={c.key} className="row" data-key={c.key} data-done={c.done ? '1' : '0'} style={{ gap: '.5rem', alignItems: 'center' }}>
        <form action={toggleAction.bind(null, company.id, c.key)}><button className="link" aria-label={c.done ? 'Markera som ej klar' : 'Markera som klar'}>{c.done ? '☑' : '☐'}</button></form><span className={c.done ? 'muted' : ''}>{c.text}</span></li>)}</ul>
    </div>
  );
}
