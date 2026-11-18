import { requireCompany } from '@/lib/server/auth';
import { fiscalYears } from '@/lib/server/ledger';
import { kr, today } from '@/lib/format';
import { resultByDimension } from '@/lib/services/dimensions';
import type { SP } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function DimensionReport({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const sp = await searchParams;
  const years = await fiscalYears(company.id);
  const t = today();
  const fy = years.find((y) => y.start_date <= t && y.end_date >= t) ?? years[0];
  const from = typeof sp.from === 'string' && sp.from ? sp.from : fy?.start_date ?? `${t.slice(0, 4)}-01-01`;
  const to = typeof sp.to === 'string' && sp.to ? sp.to : fy?.end_date ?? `${t.slice(0, 4)}-12-31`;
  const dim = sp.dim === 'project' ? 'project' : 'cost_center';
  const r = await resultByDimension(company.id, dim, from, to);
  return (
    <>
      <h1>Resultat per {dim === 'project' ? 'projekt' : 'kostnadsställe'}</h1>
      <form className="card row" style={{ alignItems: 'end' }}>
        <label style={{ flex: '0 0 180px' }}>Dimension<select name="dim" defaultValue={dim}><option value="cost_center">Kostnadsställe</option><option value="project">Projekt</option></select></label>
        <label style={{ flex: '0 0 170px' }}>Från<input type="date" name="from" defaultValue={from} /></label>
        <label style={{ flex: '0 0 170px' }}>Till<input type="date" name="to" defaultValue={to} /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Visa</button></div>
      </form>
      {r.columns.length === 0 ? <p className="muted">Inga intäkter eller kostnader i perioden.</p> : (
        <div className="table-wrap"><table className="small">
          <thead><tr><th>Konto</th>{r.columns.map((c) => <th key={String(c.id)} className="num">{c.label}</th>)}</tr></thead>
          <tbody>
            {r.accounts.map((a) => (
              <tr key={a.account}><td>{a.account} {a.name}</td>{r.columns.map((c) => <td key={String(c.id)} className="num">{a.values[String(c.id)] ? kr(a.values[String(c.id)]) : ''}</td>)}</tr>
            ))}
            <tr className="sum"><td>Resultat</td>{r.columns.map((c) => <td key={String(c.id)} className="num">{kr(r.totals[String(c.id)])}</td>)}</tr>
          </tbody>
        </table></div>
      )}
      <p className="small muted">Intäkter visas positiva och kostnader negativa. ”Utan” är rader som saknar {dim === 'project' ? 'projekt' : 'kostnadsställe'}.</p>
    </>
  );
}
