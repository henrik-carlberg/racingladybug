import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { overview } from '@/lib/services/revenue';
import { post } from './actions';

export const dynamic = 'force-dynamic';

export default async function RevenuePlan({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id;
  const o = await overview(id);
  const c = o.current;
  const max = Math.max(1, ...o.series.map((s) => s.mrr));
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Intäktsplan och återkommande intäkter</h1>
      <p className="muted">Fakturor med tjänsteperiod (t.ex. årsabonnemang) intäktsförs månad för månad: det som avser kommande månader bokas som förutbetalda intäkter (2970) och förs över till intäktskontot när månaden är slut. Ange tjänsteperioden på fakturan.</p>
      <Flash searchParams={searchParams} />
      <div className="grid">
        <div className="card stat"><div className="label">MRR {c.period}</div><div className="value mrr">{kr(c.mrr)}</div></div>
        <div className="card stat"><div className="label">ARR</div><div className="value arr">{kr(c.arr)}</div></div>
        <div className="card stat"><div className="label">Aktiva kunder</div><div className="value">{c.active}</div><div className="small muted">{c.newCustomers} nya, {c.churnedCustomers} förlorade</div></div>
        <div className="card stat"><div className="label">Nettoretention</div><div className="value nrr">{c.nrr == null ? '–' : `${c.nrr.toLocaleString('sv-SE')} %`}</div><div className="small muted">churn {c.churnRate == null ? '–' : `${c.churnRate.toLocaleString('sv-SE')} %`}</div></div>
        <div className="card stat"><div className="label">Förutbetalt kvar</div><div className="value deferred-balance">{kr(o.deferredBalance)}</div></div>
      </div>
      <form action={post.bind(null, id)} className="card row"><span style={{ flex: '1 1 300px' }}>Bokför avslutade månaders intäkter från förutbetalda intäkter. Görs också automatiskt varje dag.</span><button className="secondary">Bokför periodiserade intäkter</button></form>

      <h2>MRR per månad</h2>
      <div className="table-wrap"><table className="mrr-series">
        <thead><tr><th>Månad</th><th>MRR</th><th className="num">Ny</th><th className="num">Utökning</th><th className="num">Minskning</th><th className="num">Förlorad</th><th className="num">Netto&shy;retention</th></tr></thead>
        <tbody>{o.series.map((s) => (
          <tr key={s.period} className="mrr-row"><td>{s.period}</td>
            <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div aria-hidden style={{ height: 8, width: `${Math.round((s.mrr / max) * 160)}px`, background: 'var(--accent)', borderRadius: 4 }} /><span className="num">{kr(s.mrr)}</span></div></td>
            <td className="num">{kr(s.added)}</td><td className="num">{kr(s.expansion)}</td><td className="num">{kr(s.contraction)}</td><td className="num">{kr(s.churned)}</td><td className="num">{s.nrr == null ? '–' : `${s.nrr.toLocaleString('sv-SE')} %`}</td></tr>
        ))}</tbody>
      </table></div>

      <h2>Kunder</h2>
      <table className="rev-customers"><thead><tr><th>Kund</th><th className="num">MRR nu</th><th className="num">Kvar att intäktsföra</th></tr></thead>
        <tbody>{o.customers.map((x) => <tr key={x.id} className="rev-customer"><td>{x.name}</td><td className="num">{kr(x.mrr)}</td><td className="num">{kr(x.future)}</td></tr>)}</tbody></table>
      <h2>Fakturor med tjänsteperiod</h2>
      <ul className="rev-invoices">{o.invoices.map((i) => <li key={i.id}><Link href={`/c/${id}/fakturor/${i.id}`}>{i.number ?? 'utkast'}</Link> {i.customer}: {i.from} – {i.to}{i.deferred != null ? ` · ${kr(i.deferred)} periodiserat` : ' · periodiseras när fakturan bokförs'}</li>)}</ul>
    </div>
  );
}
