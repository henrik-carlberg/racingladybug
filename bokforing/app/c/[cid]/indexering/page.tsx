import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { notice, overview } from '@/lib/services/indexation';
import { applyAction, indexAction, linkAction } from './actions';

export const dynamic = 'force-dynamic';
const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('sv-SE')} %`;

export default async function Indexation({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const id = company.id;
  const t = today();
  const period = typeof sp.period === 'string' && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : `${Number(t.slice(0, 4)) - 1}-10`;
  const o = await overview(id, period);
  const n = Number(sp.notice) ? await notice(id, Number(sp.notice), period).catch(() => null) : null;
  if (n) return (
    <div style={{ maxWidth: 700 }} className="ix-notice">
      <p className="small no-print"><a href={`/c/${id}/indexering?period=${period}`}>← Tillbaka</a></p>
      <h1>Meddelande om prisjustering</h1>
      <p>Till {n.customer}</p>
      <p>Enligt avtalet {n.name} räknas priset om med {n.index_name}. Indexet har förändrats från basmånaden {n.base_period} till {n.period}{n.factor ? `, vilket ger en uppräkning med ${((n.factor - 1) * 100).toLocaleString('sv-SE', { maximumFractionDigits: 2 })} %` : ''}. Från och med nästa fakturering gäller följande priser per period:</p>
      <table><thead><tr><th>Tjänst</th><th className="num">Tidigare pris</th><th className="num">Nytt pris</th></tr></thead>
        <tbody>{n.rows.map((r, i) => <tr key={i}><td>{r.description}</td><td className="num">{kr(r.old)}</td><td className="num ix-new">{kr(r.next)}</td></tr>)}</tbody></table>
      <p>Med vänlig hälsning<br />{n.company}</p>
    </div>
  );
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Indexuppräkning av avtal</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Koppla återkommande avtal till ett index (t.ex. KPI) med basmånad. Uppräkningen räknas från baspriserna: nytt pris = baspris × (1 + indexförändring × indexreglerad andel). Med golv sänks priset aldrig under baspriset.
        Granska förslaget, välj avtal och tillämpa – priserna på avtalen uppdateras och historiken sparas.</p>
      <form method="get" className="row"><label>Indexmånad<input type="month" name="period" defaultValue={period} /></label><button className="secondary">Visa förslag</button></form>
      <form action={applyAction.bind(null, id, period)} className="stack">
        <table className="ix-list"><thead><tr><th></th><th>Avtal</th><th>Index</th><th className="num">Faktor</th><th>Rader</th><th className="num">Per period nu</th><th className="num">Efter uppräkning</th><th className="num">Ändring</th><th></th></tr></thead>
          <tbody>{o.proposals.map((p) => (
            <tr key={p.contract_id} className="ix-row" data-name={p.name}><td>{!p.applied && p.factor != null && <input type="checkbox" name={`c_${p.contract_id}`} defaultChecked aria-label={`Välj ${p.name}`} />}</td>
              <td>{p.name}<div className="small muted">{p.customer}</div></td><td className="small">{p.index_name} {p.base_period} ({p.baseIndex ?? '?'}) → {period} ({p.index ?? 'saknas'}){p.share < 100 ? `, ${p.share} %` : ''}</td>
              <td className="num ix-factor">{p.factor != null ? p.factor.toLocaleString('sv-SE', { maximumFractionDigits: 4 }) : '–'}</td>
              <td className="small">{p.rows.map((r) => <div key={r.id}>{r.description}: {kr(r.unit_price)}{r.next != null && r.next !== r.unit_price ? ` → ${kr(r.next)}` : ''}</div>)}</td>
              <td className="num">{kr(p.total)}</td><td className="num ix-new-total">{kr(p.newTotal)}</td><td className="num ix-change">{kr(p.diff)} ({pct(p.pct)})</td>
              <td className="small">{p.applied ? 'Uppräknat' : ''}<div><a href={`/c/${id}/indexering?period=${period}&notice=${p.contract_id}`}>Meddelande till kunden</a></div></td></tr>))}
            {!o.proposals.length && <tr><td colSpan={9} className="muted">Inga indexreglerade avtal.</td></tr>}</tbody></table>
        {o.proposals.some((p) => !p.applied && p.factor != null) && <div><button>Tillämpa uppräkningen</button></div>}
      </form>

      <div className="row" style={{ alignItems: 'start' }}>
        <form action={indexAction.bind(null, id)} className="card stack"><b>Indexvärde</b><input type="hidden" name="view_period" value={period} />
          <div className="row"><label>Index<input name="index_name" defaultValue="KPI" style={{ width: '6rem' }} /></label><label>Månad<input type="month" name="period" required /></label><label>Värde<input name="value" inputMode="decimal" required style={{ width: '6rem' }} /></label></div>
          <button className="secondary">Spara indexvärde</button></form>
        {o.contracts.length > 0 && <form action={linkAction.bind(null, id)} className="card stack"><b>Koppla avtal till index</b><input type="hidden" name="view_period" value={period} />
          <label>Avtal<select name="contract_id">{o.contracts.map((c) => <option key={c.id} value={c.id}>{c.customer}: {c.name}</option>)}</select></label>
          <div className="row"><label>Index<input name="index_name" defaultValue="KPI" style={{ width: '6rem' }} /></label><label>Basmånad<input type="month" name="base_period" required /></label><label>Indexreglerad andel %<input name="share" defaultValue="100" inputMode="decimal" style={{ width: '5rem' }} /></label></div>
          <input type="hidden" name="floor" value="on" />
          <button className="secondary">Koppla avtal</button></form>}
      </div>
      <h2>Indexserier</h2>
      <table className="small"><tbody>{o.series.map((s) => <tr key={`${s.index_name}${s.period}`}><td>{s.index_name}</td><td>{s.period}</td><td className="num">{s.value.toLocaleString('sv-SE')}</td></tr>)}{!o.series.length && <tr><td className="muted">Inga indexvärden ännu.</td></tr>}</tbody></table>
      {o.history.length > 0 && <><h2>Prishistorik</h2><table className="ix-history"><tbody>{o.history.map((h, i) => <tr key={i}><td>{h.date}</td><td>{h.contract}</td><td>{h.description ?? ''}</td><td className="num">{kr(h.old_price)} → {kr(h.new_price)}</td><td className="small">{h.index_period}</td></tr>)}</tbody></table></>}
    </div>
  );
}
