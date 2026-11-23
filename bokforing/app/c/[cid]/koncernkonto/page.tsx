import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/cash-pool';
import { createAction, interestAction, memberAction, sweepAction } from './actions';

export const dynamic = 'force-dynamic';
const prevMonth = (d: string) => { const [y, m] = d.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const pct = (n: number) => n.toLocaleString('sv-SE', { maximumFractionDigits: 3 });

export default async function CashPool({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const t = today();
  const period = typeof sp.period === 'string' && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : prevMonth(t);
  const o = await overview(id, period);
  return (
    <div style={{ maxWidth: 1050 }}>
      <h1>Koncernkonto</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Ett koncernkonto samlar koncernens likviditet på moderbolagets huvudkonto. Dotterbolagens saldon är fordringar på (1660) eller skulder till moderbolaget, som bokför motsvarande mot 2860 per dotterbolag.
        Överföringar bokförs i båda bolagen samtidigt, och internräntan räknas månadsvis på det dagliga saldot (faktiska dagar/365) och läggs till saldot.</p>
      {o.memberOf.map((m) => <p key={m.pool} className="card small cp-member">{company.name} ingår i {m.master}s koncernkonto {m.pool}: saldo <b>{kr(m.balance)}</b> kr ({m.balance >= 0 ? 'fordran på moderbolaget' : 'skuld till moderbolaget'}).</p>)}
      <form method="get" className="row"><label>Räntemånad<input type="month" name="period" defaultValue={period} /></label><button className="secondary">Visa</button></form>

      {o.pools.map((p) => (
        <section key={p.id} className="card stack cp-pool" data-name={p.name}>
          <h2 style={{ margin: 0 }}>{p.name} <span className="small muted">huvudkonto {p.bank_account}, insättning {pct(p.deposit_rate)} %, utlåning {pct(p.borrow_rate)} %</span></h2>
          <table className="cp-members"><thead><tr><th>Bolag</th><th className="num">Saldo</th><th className="num">Snittsaldo {period}</th><th className="num">Ränta {period}</th><th className="num">Dotterbolagets 1660</th><th className="num">Moderbolagets 2860</th><th>Avstämning</th></tr></thead>
            <tbody>{p.members.map((m) => (
              <tr key={m.company_id} className="cp-row" data-company={m.name}><td>{m.name} <span className="small muted">({m.bank_account})</span></td><td className="num cp-balance">{kr(m.balance)}</td>
                <td className="num">{m.calc ? kr(m.calc.average) : ''}</td><td className="num cp-interest">{m.interestBooked != null ? kr(m.interestBooked) : m.calc ? kr(m.calc.interest) : ''}{m.interestBooked != null && <span className="small muted"> bokförd</span>}</td>
                <td className="num">{kr(m.memberLedger)}</td><td className="num">{kr(m.masterLedger)}</td><td className="small cp-check">{m.diff === 0 ? 'Stämmer' : `Differens ${kr(m.diff)} kr`}</td></tr>))}
              {!p.members.length && <tr><td colSpan={7} className="muted">Inga anslutna dotterbolag.</td></tr>}</tbody>
            <tfoot><tr><th>Koncernen netto</th><th className="num cp-total">{kr(p.total)}</th><th colSpan={5}></th></tr></tfoot></table>
          {p.members.length > 0 && <>
            <form action={interestAction.bind(null, id, p.id, period)}><button>Bokför internränta för {period}</button></form>
            <form action={sweepAction.bind(null, id, p.id)} className="row">
              <input type="hidden" name="period" value={period} />
              <label>Bolag<select name="company_id">{p.members.map((m) => <option key={m.company_id} value={m.company_id}>{m.name}</option>)}</select></label>
              <label>Riktning<select name="direction"><option value="in">Till huvudkontot</option><option value="out">Från huvudkontot</option></select></label>
              <label>Belopp<input name="amount" inputMode="decimal" required style={{ width: '8rem' }} /></label>
              <label>Datum<input type="date" name="date" defaultValue={t} required /></label>
              <button>Bokför överföring</button>
            </form></>}
          <form action={memberAction.bind(null, id, p.id)} className="row">
            <input type="hidden" name="period" value={period} />
            <label>Anslut dotterbolag<select name="company_id">{o.subsidiaries.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label>Underkonto (bank)<input name="bank_account" defaultValue="1930" style={{ width: '6rem' }} /></label>
            <button className="secondary">Anslut</button>
          </form>
        </section>))}

      {o.subsidiaries.length > 0 ? <><h2>Nytt koncernkonto</h2>
        <form action={createAction.bind(null, id)} className="card row">
          <input type="hidden" name="period" value={period} />
          <label>Namn<input name="name" required defaultValue={o.pools.length ? '' : 'Koncernkonto'} /></label>
          <label>Huvudkonto (bank)<input name="bank_account" defaultValue="1930" style={{ width: '6rem' }} /></label>
          <label>Insättningsränta %<input name="deposit_rate" inputMode="decimal" defaultValue="0" style={{ width: '5rem' }} /></label>
          <label>Utlåningsränta %<input name="borrow_rate" inputMode="decimal" defaultValue="0" style={{ width: '5rem' }} /></label>
          <button>Lägg upp koncernkonto</button>
        </form></> : !o.memberOf.length && <p className="muted">Koncernkontot läggs upp i moderbolaget när dotterbolagen är kopplade i koncernstrukturen.</p>}
    </div>
  );
}
