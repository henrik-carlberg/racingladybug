import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { forecast } from '@/lib/services/sales-forecast';
import { transferAction } from './actions';

export const dynamic = 'force-dynamic';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export default async function SalesForecast({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const f = await forecast(ctx.company.id);
  const b = `/c/${ctx.company.id}`;
  const max = Math.max(1, ...f.rows.map((r) => Math.max(r.total, r.budget ?? 0)));
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Försäljningsprognos</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Försäljningen de kommande tolv månaderna exklusive moms: avtal och abonnemang som faktureras, öppna affärer i säljpipelinen viktade med sannolikheten och övrig försäljning
        utifrån de senaste tolv månaderna (utan avtalsfakturor) fördelad med säsongsmönstret från bokföringen. Jämförs med intäktsbudgeten.</p>
      <div className="row">
        <div className="card stat"><div className="label">Prognos 12 månader</div><div className="value sf-total">{kr(f.total)}</div></div>
        <div className="card stat"><div className="label">Budget samma period</div><div className="value">{f.budgetTotal == null ? '–' : kr(f.budgetTotal)}</div>{f.budgetTotal != null && <div className="small sf-vs-budget">{f.total >= f.budgetTotal ? '+' : ''}{kr(f.total - f.budgetTotal)} mot budget</div>}</div>
        <div className="card stat"><div className="label">Övrig försäljning per månad</div><div className="value">{kr(f.baselineMonthly)}</div><div className="small muted">{f.seasonal ? 'med säsongsmönster' : 'utan säsongsmönster (kräver ett års historik)'}</div></div>
      </div>
      <table className="sf-months"><thead><tr><th>Månad</th><th className="num">Avtal</th><th className="num">Pipeline (viktad)</th><th className="num">Övrig försäljning</th><th className="num">Prognos</th><th className="num">Budget</th><th className="num">Mot budget</th><th style={{ width: '22%' }}></th></tr></thead>
        <tbody>{f.rows.map((r) => <tr key={r.month} className="sf-row" data-month={r.month}><td>{label(r.month)}</td><td className="num sf-contracts">{kr(r.contracts)}</td><td className="num sf-pipeline">{kr(r.pipeline)}</td><td className="num">{kr(r.baseline)}</td>
          <td className="num sf-month-total"><strong>{kr(r.total)}</strong></td><td className="num">{r.budget == null ? '' : kr(r.budget)}</td><td className={`num ${r.diff != null && r.diff < 0 ? 'neg' : ''}`}>{r.diff == null ? '' : kr(r.diff)}</td>
          <td aria-hidden="true"><div style={{ height: 8, borderRadius: 4, background: 'var(--accent)', width: `${Math.round(r.total / max * 100)}%` }} />{r.budget != null && <div style={{ height: 2, marginTop: 2, background: 'var(--muted)', width: `${Math.round(r.budget / max * 100)}%` }} />}</td></tr>)}</tbody></table>
      {f.deals.length > 0 && <><h2>Affärer i pipelinen</h2>
        <table className="small sf-deals"><thead><tr><th>Affär</th><th>Månad</th><th className="num">Värde</th><th className="num">Sannolikhet</th><th className="num">Viktat</th></tr></thead>
          <tbody>{f.deals.map((d, i) => <tr key={i} data-title={d.title}><td>{d.title}</td><td>{label(d.month)}</td><td className="num">{kr(d.value)}</td><td className="num">{d.probability} %</td><td className="num">{kr(d.weighted)}</td></tr>)}</tbody></table></>}
      <h2>Till likviditetsprognosen</h2>
      {f.transferred == null ? <p className="small muted">Aktivera likviditetsmodulen för att föra över prognosen.</p> : <>
        <p className="small">Pipeline och övrig försäljning läggs in som planerade inbetalningar inklusive moms, med betalning efter bolagets betalningsvillkor. Avtalen finns redan med i likviditetsprognosen. En ny överföring ersätter den förra{f.transferred ? ` (${f.transferred} poster finns nu)` : ''}.</p>
        <form action={transferAction.bind(null, ctx.company.id)} className="row card">
          <label>Moms<select name="vat" defaultValue="25"><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option><option value="0">Ingen moms</option></select></label>
          <div><button>För över till likviditetsprognosen</button></div>
        </form>
        <p className="small"><Link href={`${b}/m/likviditet`}>Till likviditetsprognosen</Link></p></>}
    </div>
  );
}
