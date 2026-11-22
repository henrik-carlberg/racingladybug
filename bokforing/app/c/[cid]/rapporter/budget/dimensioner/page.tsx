import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/dim-budget';
import { save } from './actions';

export const dynamic = 'force-dynamic';

/** Budget och uppföljning per kostnadsställe eller projekt */
export default async function DimBudget({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const year = /^\d{4}$/.test(String(sp.ar ?? '')) ? Number(sp.ar) : Number(today().slice(0, 4));
  const dim = sp.dim === 'project' ? 'project' : 'cost_center';
  const o = await overview(company.id, year, dim);
  const b = `/c/${company.id}`;
  return (
    <div style={{ maxWidth: 1100 }}>
      <p><Link href={`${b}/rapporter/budget`}>← Budget per konto</Link></p>
      <h1>Budget per {dim === 'project' ? 'projekt' : 'kostnadsställe'}</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Utfallet hämtas från verifikationsraderna som har {dim === 'project' ? 'projekt' : 'kostnadsställe'}: kostnader 4000–7999 och intäkter 3000–3999.
        Prognosen för helåret är utfallet hittills plus budgeten för resterande månader. Varning när utfallet hittills avviker mer än 10 % åt fel håll eller när prognosen passerar årsbudgeten.</p>
      <form className="row" method="get"><label>År<input name="ar" defaultValue={year} style={{ width: '6rem' }} /></label>
        <label>Dimension<select name="dim" defaultValue={dim}><option value="cost_center">Kostnadsställen</option><option value="project">Projekt</option></select></label><div style={{ flex: '0 0 auto' }}><button className="secondary">Visa</button></div></form>
      {o.warnings.length > 0 && <div className="card db-warnings" style={{ borderColor: 'var(--warn)' }}>⚠️ {o.warnings.map((w) => `${w.name} (${w.kind === 'cost' ? 'kostnader' : 'intäkter'}): ${w.warn ? `${w.pct > 0 ? '+' : ''}${w.pct} % mot budget hittills` : ''}${w.warn && w.overYear ? ', ' : ''}${w.overYear ? `prognos ${kr(w.forecast)} kr mot årsbudget ${kr(w.yearB)} kr` : ''}`).join(' · ')}</div>}
      <table className="db-table"><thead><tr><th>{dim === 'project' ? 'Projekt' : 'Kostnadsställe'}</th><th></th><th className="num">Budget hittills</th><th className="num">Utfall hittills</th><th className="num">Avvikelse</th><th className="num">Årsbudget</th><th className="num">Prognos</th></tr></thead>
        <tbody>{o.rows.map((r) => <tr key={`${r.dimId}-${r.kind}`} className="db-row" data-name={r.name} data-kind={r.kind} style={r.warn ? { color: 'var(--warn)' } : {}}><td>{r.name}</td><td>{r.kind === 'cost' ? 'Kostnader' : 'Intäkter'}</td>
          <td className="num">{kr(r.ytdB)}</td><td className="num">{kr(r.ytdA)}</td><td className="num db-diff">{kr(r.diff)} ({r.pct} %)</td><td className="num">{kr(r.yearB)}</td><td className="num db-forecast">{kr(r.forecast)}</td></tr>)}</tbody></table>
      <form action={save.bind(null, company.id)} className="card row" style={{ marginTop: '1rem' }}>
        <input type="hidden" name="year" value={year} /><input type="hidden" name="dim" value={dim} />
        <label>{dim === 'project' ? 'Projekt' : 'Kostnadsställe'}<select name="dim_id" required>{o.list.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Typ<select name="kind"><option value="cost">Kostnader</option><option value="revenue">Intäkter</option></select></label>
        <label>Årsbudget (kr, fördelas lika per månad)<input name="yearly" required style={{ width: '9rem' }} /></label>
        <div style={{ flex: '0 0 auto' }}><button>Spara budget</button></div>
      </form>
    </div>
  );
}
