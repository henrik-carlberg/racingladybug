import Link from 'next/link';
import { requireUser } from '@/lib/server/auth';
import { type SP } from '@/components/ui';
import { PrintButton } from '@/components/PrintButton';
import { kr, today } from '@/lib/format';
import { RESULT_GROUPS } from '@/lib/monthly';
import { BALANCE_GROUPS } from '@/lib/consolidation';
import { groupCandidates, groupReport } from '@/lib/services/consolidation';

export const dynamic = 'force-dynamic';

export default async function Group({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const t = today();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(sp.from)) ? String(sp.from) : `${t.slice(0, 4)}-01-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(sp.to)) ? String(sp.to) : t;
  const raw = sp.c == null ? [] : Array.isArray(sp.c) ? sp.c : [sp.c];
  const candidates = await groupCandidates(user.id);
  const ids = raw.length ? raw.map(Number) : candidates.map((c) => c.id);
  const r = ids.length >= 1 ? await groupReport(user.id, ids, from, to) : null;
  return (
    <div className="center" style={{ maxWidth: 1100 }}>
      <div className="header">
        <h1>Koncernsammanställning</h1>
        <div className="actions" style={{ margin: 0 }}><Link className="btn secondary" href="/">Mina bolag</Link><PrintButton /></div>
      </div>
      <form className="card stack">
        <div className="row">
          <label>Från<input type="date" name="from" defaultValue={from} /></label>
          <label>Till<input type="date" name="to" defaultValue={to} /></label>
        </div>
        <div className="row">{candidates.map((c) => <label key={c.id} className="check"><input type="checkbox" name="c" value={c.id} defaultChecked={ids.includes(c.id)} /> {c.name} <span className="small muted">{c.orgnr}</span></label>)}</div>
        <div><button className="secondary">Visa</button></div>
      </form>
      {r && r.companies.length > 0 && (
        <>
          <p className="small muted">Bolagens bokföring summeras. Försäljning mellan bolagen (kund med samma organisationsnummer som ett annat valt bolag) elimineras från intäkter och externa kostnader, och obetalda koncerninterna fakturor från kundfordringar och kortfristiga skulder. Aktier i dotterbolag mot eget kapital, koncernbidrag och internvinster i lager elimineras inte automatiskt – stäm av med revisorn inför en koncernredovisning.</p>
          <h2>Resultaträkning {from} – {to}</h2>
          <div className="table-wrap"><table>
            <thead><tr><th></th>{r.perCompany.map((p) => <th key={p.id} className="num">{p.name}</th>)}<th className="num">Elimineringar</th><th className="num">Koncernen</th></tr></thead>
            <tbody>
              {RESULT_GROUPS.map((g) => (
                <tr key={g.key}><td>{g.label}</td>{r.perCompany.map((p) => <td key={p.id} className="num">{kr(p.r[g.key])}</td>)}<td className="num">{r.elimR[g.key] ? kr(r.elimR[g.key]) : ''}</td><td className="num"><b>{kr(r.result[g.key])}</b></td></tr>
              ))}
              <tr className="sum"><td><b>Resultat</b></td>{r.perCompany.map((p) => <td key={p.id} className="num">{kr(p.r.result)}</td>)}<td /><td className="num"><b>{kr(r.consolidatedResult)}</b></td></tr>
            </tbody>
          </table></div>
          <h2>Balansräkning {to}</h2>
          <div className="table-wrap"><table>
            <thead><tr><th></th>{r.perCompany.map((p) => <th key={p.id} className="num">{p.name}</th>)}<th className="num">Elimineringar</th><th className="num">Koncernen</th></tr></thead>
            <tbody>
              {BALANCE_GROUPS.map((g) => (
                <tr key={g.key}><td>{g.label}</td>{r.perCompany.map((p) => <td key={p.id} className="num">{kr(p.b[g.key])}</td>)}<td className="num">{r.elimB[g.key] ? kr(r.elimB[g.key]) : ''}</td><td className="num"><b>{kr(r.balance[g.key])}</b></td></tr>
              ))}
            </tbody>
          </table></div>
          {(r.intraSales > 0 || r.intraOpen > 0) && <p className="small">Koncernintern försäljning {kr(r.intraSales)}, obetalt mellan bolagen {kr(r.intraOpen)}.</p>}
        </>
      )}
      {candidates.length === 0 && <p className="muted">Du har inga bolag att sammanställa.</p>}
    </div>
  );
}
