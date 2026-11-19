import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { PrintButton } from '@/components/PrintButton';
import { BALANCE_GROUPS, pctChange } from '@/lib/statements';
import { statements, type Compare } from '@/lib/services/statements';

export const dynamic = 'force-dynamic';

export default async function Reports({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const sp = await searchParams;
  const compare = (['fjol', 'budget'].includes(String(sp.jmf)) ? sp.jmf : 'none') as Compare;
  const s = await statements(company.id, { fy: sp.fy ? String(sp.fy) : undefined, from: sp.from ? String(sp.from) : undefined, to: sp.to ? String(sp.to) : undefined, compare });
  if (!s) return <p>Inget räkenskapsår.</p>;
  const { fy, years, from, to, names, income, ib, ub, ubPrev } = s;
  const cmp = compare !== 'none';
  const cmpLabel = compare === 'fjol' ? 'Förra året' : 'Budget';
  const inRange = (m: Map<number, number>, a: number, b: number) => [...m].filter(([n, v]) => n >= a && n <= b && v !== 0).sort((x, y) => x[0] - y[0]);
  const assets = inRange(ub, 1000, 1999).reduce((acc, [, v]) => acc + v, 0);
  const liab = -inRange(ub, 2000, 2999).reduce((acc, [, v]) => acc + v, 0);
  const qs = new URLSearchParams({ fy: String(fy.id), from, to, ...(cmp ? { jmf: compare } : {}) }).toString();
  const diffCells = (cur: number, prev: number | null) => cmp ? <><td className="num muted">{prev === null ? '' : kr(prev)}</td><td className={`num ${prev !== null && cur - prev < 0 ? 'neg' : ''}`}>{prev === null ? '' : kr(cur - prev)}</td><td className="num small muted">{(() => { const p = pctChange(cur, prev); return p === null ? '' : `${p > 0 ? '+' : ''}${String(p).replace('.', ',')} %`; })()}</td></> : null;
  return (
    <>
      <div className="header">
        <h1>Resultat- och balansräkning</h1>
        <div className="actions no-print" style={{ margin: 0 }}><a className="btn secondary" href={`/c/${company.id}/rapporter/xlsx?r=rrbr&${qs}`} download>Excel</a><PrintButton /></div>
      </div>
      <form className="card row no-print">
        <label>Räkenskapsår<select name="fy" defaultValue={fy.id}>{years.map((y) => <option key={y.id} value={y.id}>{y.start_date} – {y.end_date}</option>)}</select></label>
        <label>Från<input type="date" name="from" defaultValue={from} /></label>
        <label>Till<input type="date" name="to" defaultValue={to} /></label>
        <label>Jämför med<select name="jmf" defaultValue={compare}><option value="none">Ingen jämförelse</option><option value="fjol">Samma period förra året</option><option value="budget">Budget</option></select></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Visa</button></div>
      </form>
      <p className="muted small">{company.name}, {company.orgnr}. Resultat {from} – {to}. Balans per {to}.{compare === 'budget' && <> Budgeten läggs in under <Link href={`/c/${company.id}/rapporter/budget`}>Budget</Link>.</>}</p>

      <h2>Resultaträkning</h2>
      <div className="table-wrap"><table>
        {cmp && <thead><tr><th colSpan={2}></th><th className="num">Utfall</th><th className="num">{cmpLabel}</th><th className="num">Skillnad</th><th className="num">%</th></tr></thead>}
        <tbody>
          {income.groups.map((g) => [
            <tr key={g.label}><th colSpan={2}>{g.label}</th><th className="num">{kr(g.total)}</th>{cmp && <>{diffCells(g.total, g.compareTotal)}</>}</tr>,
            ...g.rows.map((r) => <tr key={r.account}><td>{r.account}</td><td>{r.name}</td><td className="num">{kr(r.amount)}</td>{diffCells(r.amount, r.compare)}</tr>),
          ])}
          <tr className="sum"><td colSpan={2}>Beräknat resultat</td><td className="num">{kr(income.result)}</td>{diffCells(income.result, income.compareResult)}</tr>
        </tbody>
      </table></div>

      <h2>Balansräkning</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Konto</th><th>Namn</th><th className="num">Ingående balans</th><th className="num">Utgående balans</th>{ubPrev && <th className="num">Samma dag förra året</th>}</tr></thead>
        <tbody>
          {BALANCE_GROUPS.map(([label, a, b]) => {
            const accs = [...new Set([...inRange(ib, a, b), ...inRange(ub, a, b), ...(ubPrev ? inRange(ubPrev, a, b) : [])].map(([n]) => n))].sort((x, y) => x - y);
            if (accs.length === 0) return null;
            const sign = a < 2000 ? 1 : -1;
            return [
              <tr key={label}><th colSpan={ubPrev ? 5 : 4}>{label}</th></tr>,
              ...accs.map((n) => <tr key={n}><td>{n}</td><td>{names.get(n)}</td><td className="num">{kr(sign * (ib.get(n) ?? 0))}</td><td className="num">{kr(sign * (ub.get(n) ?? 0))}</td>{ubPrev && <td className="num muted">{kr(sign * (ubPrev.get(n) ?? 0))}</td>}</tr>),
            ];
          })}
          <tr className="sum"><td colSpan={3}>Summa tillgångar</td><td className="num">{kr(assets)}</td>{ubPrev && <td />}</tr>
          <tr className="sum"><td colSpan={3}>Summa eget kapital och skulder (före årets resultat)</td><td className="num">{kr(liab)}</td>{ubPrev && <td />}</tr>
          <tr className="sum"><td colSpan={3}>Årets resultat hittills</td><td className="num">{kr(assets - liab)}</td>{ubPrev && <td />}</tr>
        </tbody>
      </table></div>
    </>
  );
}
