import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { overview } from '@/lib/services/profit-share';
import { accrueAction, addAction, payoutAction, showAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ProfitShare({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const id = company.id;
  const o = await overview(id, Number(sp.fy) || null);
  const fy = o.fy;
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Tantiem och vinstdelning</h1>
      <p className="small"><Link href={`/c/${id}/lon`}>← Lönekörningar</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">Tantiem är lön och beräknas på årets resultat före tantiem och skatt. Vid bokslut bokförs den som upplupen lön med sociala avgifter
        (debet 7210 och 7519, kredit 2910 och 2940). När den betalas ut läggs den som lönetillägg i en lönekörning, och den upplupna skulden löses upp när lönen bokförs.</p>
      {fy && <form action={showAction.bind(null, id)} className="row" style={{ alignItems: 'end' }}>
        <label>Räkenskapsår<select name="fy" defaultValue={fy.id}>{o.fys.map((f) => <option key={f.id} value={f.id}>{f.start} – {f.end}</option>)}</select></label><button className="secondary">Visa</button></form>}
      {fy && <div className="grid" style={{ marginTop: '1rem' }}><div className="card stat"><div className="label">Resultat före tantiem och skatt</div><div className="value ps-result">{kr(o.result)}</div></div></div>}
      <table className="ps-list"><thead><tr><th>Anställd</th><th>Villkor</th><th className="num">Tantiem</th><th className="num">Upplupet</th><th className="num">Sociala avgifter</th><th>Utbetalning</th></tr></thead>
        <tbody>{o.rows.map((r) => (
          <tr key={r.id} className="ps-row" data-employee={r.employee}><td>{r.employee}{r.note && <div className="small muted">{r.note}</div>}</td>
            <td className="small">{r.kind === 'percent' ? `${(r.pct ?? 0) / 100} % av resultatet` : `${kr(r.amount ?? 0)} kr om resultatet når ${kr(r.target ?? 0)} kr`}{r.cap ? `, högst ${kr(r.cap)} kr` : ''}</td>
            <td className="num ps-proposal">{kr(r.proposal)}</td><td className="num ps-accrued">{kr(r.accrual?.amount ?? 0)}</td><td className="num ps-fee">{kr(r.accrual?.fee ?? 0)}</td>
            <td>{r.accrual?.reversal_voucher_id ? <span className="small">Utbetald {r.accrual.period}</span>
              : r.accrual?.payout_run_id ? <span className="small">På lönekörning {r.accrual.period}</span>
              : r.accrual && r.accrual.amount > 0 && fy ? (o.runs.length ? <form action={payoutAction.bind(null, id, fy.id, r.accrual.id)} className="row" style={{ gap: '.25rem' }}>
                  <select name="run_id">{o.runs.map((x) => <option key={x.id} value={x.id}>{x.period}</option>)}</select><button className="link">Lägg på lön</button></form>
                : <span className="small muted">Skapa en lönekörning först</span>) : ''}</td></tr>))}
          {!o.rows.length && <tr><td colSpan={6} className="muted">Inga tantiemavtal.</td></tr>}</tbody></table>
      {fy && !fy.closed && o.rows.length > 0 && <form action={accrueAction.bind(null, id, fy.id)} style={{ marginTop: '1rem' }}><button className="secondary">Bokför upplupen tantiem per {fy.end}</button></form>}
      <h2>Nytt tantiemavtal</h2>
      <form action={addAction.bind(null, id, fy?.id ?? 0)} className="card stack">
        <div className="row">
          <label>Anställd<select name="employee_id" required>{o.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label>Typ<select name="kind"><option value="percent">Andel av resultatet</option><option value="target">Belopp vid uppnått mål</option></select></label>
          <label>Andel (%)<input name="pct" inputMode="decimal" style={{ width: '5rem' }} /></label>
          <label>Resultatmål (kr)<input name="target" inputMode="decimal" /></label>
          <label>Belopp vid mål (kr)<input name="amount" inputMode="decimal" /></label>
          <label>Tak (kr)<input name="cap" inputMode="decimal" /></label>
        </div>
        <label>Notering<input name="note" maxLength={300} /></label>
        <div><button>Lägg upp tantiemavtal</button></div>
      </form>
    </div>
  );
}
