import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCompany } from '@/lib/server/auth';
import { NotFoundError } from '@/lib/errors';
import { kr } from '@/lib/format';
import { PrintButton } from '@/components/PrintButton';
import { cashFlowReport } from '@/lib/services/k3';
import type { CashFlow } from '@/lib/cashflow';

export const dynamic = 'force-dynamic';

export default async function CashFlowPage({ params }: { params: Promise<{ cid: string; fyid: string }> }) {
  const { cid, fyid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const r = await cashFlowReport(company.id, Number(fyid)).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const cols: { label: string; f: CashFlow }[] = [...r.months.map((m) => ({ label: m.period.slice(5), f: m.flow })), { label: 'Året', f: r.year }];
  const line = (label: string, get: (f: CashFlow) => number, bold = false, cls = '') => (
    <tr className={cls}><td>{bold ? <b>{label}</b> : label}</td>{cols.map((c, i) => <td key={i} className="num">{bold ? <b>{kr(get(c.f))}</b> : kr(get(c.f))}</td>)}</tr>
  );
  const group = (title: string, key: 'operating' | 'workingCapital' | 'investing' | 'financing') => (<>
    {title && <tr><td colSpan={cols.length + 1}><b>{title}</b></td></tr>}
    {r.year[key].map((l, i) => cols.some((c) => c.f[key][i].amount) ? <tr key={l.key}><td>{l.label}</td>{cols.map((c, j) => <td key={j} className="num">{kr(c.f[key][i].amount)}</td>)}</tr> : null)}
  </>);
  return (
    <div>
      <div className="header no-print"><h1>Kassaflödesanalys {r.fy.start_date} – {r.fy.end_date}</h1><div className="actions" style={{ margin: 0 }}><PrintButton /><Link className="btn secondary" href={`/c/${company.id}/bokslut/${fyid}`}>Tillbaka</Link></div></div>
      <p className="muted">Indirekt metod: resultatet justeras för poster som inte påverkar kassan och för förändringen av rörelsekapitalet. Summan stäms av mot förändringen av likvida medel (19xx) varje månad.</p>
      <div className="table-wrap"><table className="cashflow">
        <thead><tr><th></th>{cols.map((c, i) => <th key={i} className="num">{c.label}</th>)}</tr></thead>
        <tbody>
          <tr><td colSpan={cols.length + 1}><b>Den löpande verksamheten</b></td></tr>
          {group('', 'operating')}
          {line('Före förändring av rörelsekapital', (f) => f.beforeWorkingCapital, true)}
          {group('', 'workingCapital')}
          {line('Kassaflöde från den löpande verksamheten', (f) => f.operatingTotal, true, 'cf-operating')}
          {group('Investeringsverksamheten', 'investing')}
          {line('Kassaflöde från investeringsverksamheten', (f) => f.investingTotal, true, 'cf-investing')}
          {group('Finansieringsverksamheten', 'financing')}
          {line('Kassaflöde från finansieringsverksamheten', (f) => f.financingTotal, true, 'cf-financing')}
          {line('Periodens kassaflöde', (f) => f.change, true, 'cf-change')}
          {line('Förändring av likvida medel enligt bokföringen', (f) => f.cashChange, false, 'cf-cash')}
        </tbody>
      </table></div>
      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card stat"><div className="label">Likvida medel vid årets början</div><div className="value">{kr(r.opening)}</div></div>
        <div className="card stat"><div className="label">Likvida medel vid periodens slut</div><div className="value cf-closing">{kr(r.closing)}</div></div>
        <div className="card stat"><div className="label">Avstämning</div><div className="value cf-check">{cols.every((c) => c.f.change === c.f.cashChange) ? 'Stämmer' : 'Avviker'}</div></div>
      </div>
    </div>
  );
}
