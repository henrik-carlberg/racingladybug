import { requireCompany } from '@/lib/server/auth';
import { type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { budgetGrid } from '@/lib/services/budget';
import { copy, save } from './actions';

export const dynamic = 'force-dynamic';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

export default async function Budget({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const sp = await searchParams;
  const t = today();
  const year = Number(sp.year) || Number(t.slice(0, 4));
  const upTo = year < Number(t.slice(0, 4)) ? 12 : year > Number(t.slice(0, 4)) ? 0 : Number(t.slice(5, 7));
  const g = await budgetGrid(company.id, year);
  const cell = (a: number, m: number) => g.budget.get(`${a}:${m}`) ?? 0;
  const act = (a: number, m: number) => g.actual.get(`${a}:${m}`) ?? 0;
  const ytd = (f: (a: number, m: number) => number, a: number) => Array.from({ length: upTo }, (_, i) => f(a, i + 1)).reduce((s, v) => s + v, 0);
  const isIncome = (a: number) => a < 4000;
  const totals = (f: (a: number, m: number) => number) => g.accounts.reduce((s, x) => s + (isIncome(x.account) ? 1 : -1) * ytd(f, x.account), 0);
  const fmt = (v: number) => (v ? (v / 100).toFixed(0) : '');
  const hasBudget = g.budget.size > 0;
  return (
    <div>
      <div className="header">
        <h1>Budget {year}</h1>
        <form className="row" style={{ margin: 0 }}><label>År<input name="year" defaultValue={year} inputMode="numeric" style={{ width: '6rem' }} /></label><div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Visa</button></div></form>
      </div>
      <p className="muted">Budget per konto och månad, i kronor. Intäkter och kostnader anges som positiva belopp. Utfallet jämförs till och med {upTo ? MONTHS[upTo - 1] : 'årets början'}. <a href={`/c/${company.id}/rapporter/budget/dimensioner`}>Budget per kostnadsställe och projekt</a></p>
      {!hasBudget && (
        <form action={copy.bind(null, company.id, year)} className="card row" style={{ alignItems: 'end' }}>
          <span style={{ flex: '1 1 260px' }}>Börja med förra årets utfall och justera sedan.</span>
          <label style={{ flex: '0 0 160px' }}>Uppräkning %<input name="uplift" defaultValue="0" inputMode="decimal" /></label>
          <div style={{ flex: '0 0 auto' }}><button className="secondary">Fyll från {year - 1}</button></div>
        </form>
      )}
      {hasBudget && upTo > 0 && (
        <>
          <h2>Budget mot utfall hittills i år</h2>
          <div className="table-wrap"><table className="budget-compare">
            <thead><tr><th>Konto</th><th className="num">Budget</th><th className="num">Utfall</th><th className="num">Avvikelse</th></tr></thead>
            <tbody>
              {g.accounts.filter((x) => ytd(cell, x.account) || ytd(act, x.account)).map((x) => {
                const bu = ytd(cell, x.account), ac = ytd(act, x.account), dev = ac - bu;
                const good = isIncome(x.account) ? dev >= 0 : dev <= 0;
                return <tr key={x.account}><td>{x.account} {x.name}</td><td className="num">{kr(bu)}</td><td className="num">{kr(ac)}</td>
                  <td className="num" style={{ color: dev === 0 ? undefined : good ? 'var(--ok)' : 'var(--danger)' }}>{dev > 0 ? '+' : ''}{kr(dev)}</td></tr>;
              })}
              <tr className="sum"><td>Resultat</td><td className="num">{kr(totals(cell))}</td><td className="num">{kr(totals(act))}</td><td className="num">{kr(totals(act) - totals(cell))}</td></tr>
            </tbody>
          </table></div>
        </>
      )}
      <h2>Budget per månad</h2>
      <form action={save.bind(null, company.id, year)}>
        <div className="table-wrap"><table className="budget-grid small">
          <thead><tr><th>Konto</th>{MONTHS.map((m) => <th key={m} className="num">{m}</th>)}<th className="num">År</th></tr></thead>
          <tbody>
            {g.accounts.map((x) => (
              <tr key={x.account}>
                <td style={{ whiteSpace: 'nowrap' }}>{x.account} <span className="muted">{x.name.slice(0, 24)}</span></td>
                {MONTHS.map((_, i) => <td key={i}><input name={`b_${x.account}_${i + 1}`} defaultValue={fmt(cell(x.account, i + 1))} inputMode="decimal" style={{ width: '5.5rem', padding: '.2rem .35rem' }} /></td>)}
                <td className="num">{kr(Array.from({ length: 12 }, (_, i) => cell(x.account, i + 1)).reduce((s, v) => s + v, 0))}</td>
              </tr>
            ))}
            <tr>
              <td><input name="new_account" placeholder="Nytt konto" inputMode="numeric" style={{ width: '7rem' }} /></td>
              <td colSpan={12}><input name="new_amount" placeholder="Belopp per år (fördelas jämnt)" inputMode="decimal" style={{ maxWidth: '16rem' }} /></td><td />
            </tr>
          </tbody>
        </table></div>
        <div className="actions"><button>Spara budget</button></div>
      </form>
    </div>
  );
}
