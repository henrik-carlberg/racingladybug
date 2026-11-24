import { requireCompany } from '@/lib/server/auth';
import { kr } from '@/lib/format';
import { overview } from '@/lib/services/spend';

export const dynamic = 'force-dynamic';
const pct = (n: number | null) => (n == null ? '–' : `${n > 0 ? '+' : ''}${n.toLocaleString('sv-SE')} %`);

export default async function SpendAnalysis({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'purchasing' });
  const o = await overview(company.id);
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Inköpsanalys</h1>
      <p className="small">Bokförda leverantörsfakturor de senaste tolv månaderna jämfört med året innan, exklusive moms. Paretolistan visar de leverantörer som tillsammans står för 80 % av inköpen – där finns störst möjlighet att förhandla.
        Nya leverantörer, prishöjningar på återkommande fakturor och små leverantörer som kan samordnas med andra i samma kategori lyfts fram.</p>
      <div className="card small sp-summary">Inköp senaste 12 månaderna: <strong className="sp-total">{kr(o.total)}</strong> kr ({pct(o.change)} mot året innan) · {o.suppliers.length} leverantörer · <span className="sp-top">{o.topCount}</span> står för 80 %</div>
      {o.increases.length > 0 && <><h2>Prishöjningar</h2><ul className="sp-increases">{o.increases.map((s) => <li key={s.id} data-name={s.name}>{s.name}: senaste fakturan {kr(s.last)} kr är {pct(s.priceIncrease)} mot tidigare</li>)}</ul></>}
      {o.newSuppliers.length > 0 && <><h2>Nya leverantörer (senaste 90 dagarna)</h2><ul className="sp-new">{o.newSuppliers.map((s) => <li key={s.id} data-name={s.name}>{s.name} – {kr(s.spend)} kr ({s.category.toLowerCase()})</li>)}</ul></>}
      {o.consolidate.length > 0 && <><h2>Kan samordnas</h2><ul className="sp-consolidate">{o.consolidate.map((s) => <li key={s.id} data-name={s.name}>{s.name} ({s.cat.toLowerCase()}, {s.invoices} fakturor, {s.share.toLocaleString('sv-SE')} %) – {s.peers} leverantörer i samma kategori</li>)}</ul></>}
      <h2>Leverantörer</h2>
      <table className="sp-suppliers"><thead><tr><th>Leverantör</th><th>Kategori</th><th className="num">Inköp</th><th className="num">Året innan</th><th className="num">Förändring</th><th className="num">Andel</th><th className="num">Ackumulerat</th></tr></thead>
        <tbody>{o.suppliers.map((s) => <tr key={s.id} className="sp-row" data-name={s.name} data-top={s.top ? '1' : '0'}><td>{s.name}</td><td className="small">{s.category}</td><td className="num">{kr(s.spend)}</td><td className="num">{kr(s.prior)}</td><td className="num">{pct(s.change)}</td><td className="num sp-share">{s.share.toLocaleString('sv-SE')} %</td><td className="num">{s.cumulative.toLocaleString('sv-SE')} %</td></tr>)}
          {!o.suppliers.length && <tr><td colSpan={7} className="muted">Inga bokförda leverantörsfakturor.</td></tr>}</tbody></table>
      <h2>Kategorier</h2>
      <table className="small sp-categories"><tbody>{o.categories.map((c) => <tr key={c.name} data-name={c.name}><td>{c.name}</td><td className="num">{kr(c.spend)}</td></tr>)}</tbody></table>
    </div>
  );
}
