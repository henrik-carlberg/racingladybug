import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { ASSET_CATEGORIES } from '@/lib/assets';
import { overview } from '@/lib/services/investments';
import { addAction, decideAction } from './actions';

export const dynamic = 'force-dynamic';
const FIN: Record<string, string> = { cash: 'Köp kontant', loan: 'Köp med lån', lease: 'Leasing' };
const pct = (n: number | null) => (n == null ? '–' : `${n.toLocaleString('sv-SE')} %`);

export default async function Investments({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const list = await overview(id);
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Investeringskalkyl</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Är investeringen lönsam? Nuvärdet visar vad framtida in- och utbetalningar är värda i dag vid kalkylräntan – positivt betyder lönsamt. Internräntan är den ränta där nuvärdet blir noll,
        och återbetalningstiden hur många år det tar innan investeringen är intjänad. Känslighetsanalysen visar nuvärdet om intäkterna eller räntan ändras. En godkänd investering läggs upp i <Link href={`/c/${id}/anlaggningar`}>anläggningsregistret</Link>.</p>
      {list.map((c) => (
        <div key={c.id} className="card stack small ic-calc" data-name={c.name} data-status={c.status} data-profitable={c.profitable ? '1' : '0'}>
          <div><strong>{c.name}</strong> · {ASSET_CATEGORIES[c.category]?.label} · grundinvestering {kr(c.investment)} kr · {c.life_years} år · kalkylränta {pct(c.rate_pct)}{c.status !== 'draft' && ` · ${c.status === 'approved' ? 'godkänd' : 'avslagen'}`}</div>
          <div className="iv-result">Nuvärde <strong className="iv-npv">{kr(c.npv)}</strong> kr · internränta <span className="iv-irr">{pct(c.irr)}</span> · återbetalningstid <span className="iv-payback">{c.payback != null ? `${c.payback.toLocaleString('sv-SE')} år` : 'inom livslängden: nej'}</span> · annuitet {kr(c.annuity)} kr/år</div>
          <div className="iv-sens">Känslighet: intäkter −20 % → {kr(c.sensitivity.revenueMinus20)} · +20 % → {kr(c.sensitivity.revenuePlus20)} · ränta +2 → {kr(c.sensitivity.ratePlus2)} · −2 → {kr(c.sensitivity.rateMinus2)}</div>
          {(c.financing.loan != null || c.financing.lease != null) && <div className="iv-fin">Finansiering (nuvärde av utbetalningarna): kontant {kr(c.financing.cash)}{c.financing.loan != null && ` · lån ${kr(c.financing.loan)}`}{c.financing.lease != null && ` · leasing ${kr(c.financing.lease)}`} – billigast: <strong className="iv-best">{FIN[c.financing.best]}</strong></div>}
          <details><summary>Kassaflöden per år</summary><table className="small"><tbody>{c.flows.map((f, i) => <tr key={i}><td>År {i + 1}</td><td className="num">{kr(f)}</td></tr>)}</tbody></table></details>
          {c.status === 'draft' && <div className="row"><form action={decideAction.bind(null, id, c.id, true)}><button className="link">Godkänn och lägg i anläggningsregistret</button></form><form action={decideAction.bind(null, id, c.id, false)}><button className="link">Avslå</button></form></div>}
          {c.asset_id && <div><Link href={`/c/${id}/anlaggningar`}>Inventariet i anläggningsregistret</Link></div>}
        </div>))}
      {!list.length && <p className="muted">Inga kalkyler.</p>}
      <h2>Ny kalkyl</h2>
      <form action={addAction.bind(null, id)} className="card stack iv-add">
        <div className="row">
          <label>Investering<input name="name" required maxLength={150} /></label>
          <label>Kategori<select name="category" defaultValue="maskiner">{Object.entries(ASSET_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          <label>Grundinvestering<input name="investment" inputMode="decimal" required /></label>
          <label>Livslängd (år)<input name="life_years" inputMode="numeric" required style={{ width: '4rem' }} /></label>
          <label>Restvärde<input name="residual" inputMode="decimal" /></label>
        </div>
        <div className="row">
          <label>Inbetalningar per år<input name="annual_in" inputMode="decimal" /></label>
          <label>Utbetalningar per år<input name="annual_out" inputMode="decimal" /></label>
          <label>Årlig ökning %<input name="growth_pct" inputMode="decimal" style={{ width: '4rem' }} /></label>
          <label>Kalkylränta %<input name="rate_pct" defaultValue="8" inputMode="decimal" style={{ width: '4rem' }} /></label>
        </div>
        <div className="row">
          <label>Låneränta % (jämförelse)<input name="loan_rate_pct" inputMode="decimal" style={{ width: '5rem' }} /></label>
          <label>Leasingavgift per månad (jämförelse)<input name="lease_monthly" inputMode="decimal" /></label>
        </div>
        <div><button>Räkna och spara</button></div>
      </form>
    </div>
  );
}
