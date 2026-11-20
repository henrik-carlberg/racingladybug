import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { KIND_LABEL } from '@/lib/securities';
import { portfolio } from '@/lib/services/securities';
import { addSecurity, trade, undo, valueAction } from './actions';

export const dynamic = 'force-dynamic';

/** Värdepapper och placeringar: aktier, fonder och kryptotillgångar med genomsnittsmetoden, värdering och skatt */
export default async function Securities({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const sp = await searchParams;
  const t = today();
  const year = /^\d{4}$/.test(String(sp.year)) ? Number(sp.year) : Number(t.slice(0, 4));
  const p = await portfolio(company.id, year);
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Värdepapper och placeringar</h1>
      <Flash searchParams={searchParams} />
      <div className="grid">
        <div className="card stat"><div className="label">Anskaffningsvärde</div><div className="value">{kr(p.rows.reduce((a, r) => a + r.cost, 0))}</div></div>
        <div className="card stat"><div className="label">Bokfört värde</div><div className="value sec-book">{kr(p.rows.reduce((a, r) => a + r.book, 0))}</div></div>
        <div className="card stat"><div className="label">Skattemässig justering {year}</div><div className="value sec-tax">{kr(p.tax.taxableAdjustment)}</div><div className="small muted">+ ökar, − minskar skattepliktigt resultat</div></div>
      </div>
      {p.rows.map((r) => (
        <details key={r.id} className="card stack security" data-name={r.name}>
          <summary><b>{r.name}</b> · {r.label} · {r.holding === 'fixed' ? 'anläggningstillgång' : 'kortfristig placering'}{r.businessRelated ? ' · näringsbetingad' : ''} — {r.quantity} st, bokfört <span className="sec-row-book">{kr(r.book)}</span> kr</summary>
          <p className="small" style={{ margin: 0 }}>Genomsnittligt anskaffningsvärde {kr(Math.round(r.average))} kr per st{r.writedown ? `, nedskrivet ${kr(r.writedown)} kr` : ''}{r.market != null ? `, marknadsvärde ${kr(r.market)} kr per ${r.marketDate}` : ''}.</p>
          <form action={trade.bind(null, company.id, r.id)} className="row trade">
            <label>Transaktion<select name="kind"><option value="buy">Köp</option><option value="sell">Försäljning</option><option value="dividend">Utdelning</option><option value="interest">Ränta</option></select></label>
            <label>Datum<input type="date" name="date" defaultValue={t} required /></label>
            <label>Antal<input name="quantity" inputMode="decimal" style={{ width: '7rem' }} /></label>
            <label>Belopp (kr)<input name="amount" required style={{ width: '9rem' }} /></label>
            <label>Courtage<input name="fee" style={{ width: '6rem' }} /></label>
            <label>Bank<select name="bank_account"><option value="1930">1930</option><option value="1940">1940</option></select></label>
            <div style={{ flex: '0 0 auto' }}><button>Bokför</button></div>
          </form>
          {r.quantity > 0 && <form action={valueAction.bind(null, company.id, r.id)} className="row valuation">
            <label>Värderingsdag<input type="date" name="date" defaultValue={`${year}-12-31`} required /></label>
            <label>Marknadsvärde för hela innehavet (kr)<input name="market" required /></label>
            {r.holding === 'fixed' && <label className="row" style={{ alignItems: 'center' }}><input type="checkbox" name="permanent" /> Bestående värdenedgång</label>}
            <div style={{ flex: '0 0 auto' }}><button className="secondary">Värdera</button></div>
          </form>}
          {r.trades.length > 0 && <>
            <table className="small"><tbody>{r.trades.map((x) => <tr key={x.id}><td>{x.date}</td><td>{{ buy: 'Köp', sell: 'Försäljning', dividend: 'Utdelning', interest: 'Ränta' }[x.kind]}</td>
              <td className="num">{x.quantity || ''}</td><td className="num">{kr(x.amount)}</td><td className="num">{x.gain != null ? `${x.gain >= 0 ? 'vinst' : 'förlust'} ${kr(Math.abs(x.gain))}` : ''}</td></tr>)}</tbody></table>
            <form action={undo.bind(null, company.id, r.id)}><button className="secondary small">Ångra senaste</button></form>
          </>}
        </details>
      ))}
      <section className="card stack tax-summary">
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Skatt {year}</h2>
        <table><tbody>
          <tr><td>Skattefria utdelningar och kapitalvinster (näringsbetingade andelar)</td><td className="num sec-exempt">{kr(p.tax.exemptIncome)}</td></tr>
          <tr><td>Ej avdragsgilla förluster och nedskrivningar</td><td className="num sec-nondeductible">{kr(p.tax.nonDeductible)}</td></tr>
          <tr><td>varav kapitalförlust på delägarrätter som inte kan kvittas i år</td><td className="num sec-loss">{kr(p.tax.lossNotDeductible)}</td></tr>
          <tr><td>Schablonintäkt på fondandelar (0,4 % av värdet vid årets ingång)</td><td className="num sec-standard">{kr(p.tax.standardIncome)}</td></tr>
        </tbody></table>
        <p className="small muted" style={{ margin: 0 }}>Onoterade aktier och noterade innehav som är näringsbetingade (minst 10 % av rösterna eller rörelsebetingade) ger skattefri utdelning och vinst; förlust är inte avdragsgill.
          Förlust på delägarrätter som är kapitalplacering får bara dras av mot vinst på delägarrätter. Kryptotillgångar är inte delägarrätter – förlust är avdragsgill. Justeringarna förs in i INK2S.</p>
      </section>
      <form action={addSecurity.bind(null, company.id)} className="card stack" style={{ marginTop: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Nytt innehav</h2>
        <label>Namn<input name="name" required maxLength={200} placeholder="T.ex. Investor B, Indexfond Sverige, Bitcoin" /></label>
        <label>ISIN eller beteckning<input name="identifier" maxLength={40} /></label>
        <label>Typ<select name="kind">{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Innehav<select name="holding"><option value="current">Kortfristig placering (1810/1880)</option><option value="fixed">Långsiktigt innehav, anläggningstillgång (1350)</option></select></label>
        <label className="row" style={{ alignItems: 'center' }}><input type="checkbox" name="business_related" /> Näringsbetingat (noterat innehav med minst 10 % av rösterna eller som rörelsen kräver)</label>
        <button>Lägg upp innehavet</button>
      </form>
    </div>
  );
}
