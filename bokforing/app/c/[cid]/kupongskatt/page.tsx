import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/withholding';
import { payDividend, payWithholding } from './actions';

export const dynamic = 'force-dynamic';

/** Utdelning till utländska ägare med kupongskatt */
export default async function Withholding({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const o = await overview(company.id);
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Kupongskatt</h1>
      <Flash searchParams={searchParams} />
      <p className="small">När bolaget betalar utdelning till en ägare som bor eller har säte utomlands ska 30 % kupongskatt hållas inne, eller lägre enligt skatteavtal om ägaren visar hemvistintyg.
        Utländska bolag med näringsbetingade andelar (och EU-bolag med minst 10 % av kapitalet) är befriade. Kupongskatten betalas in till Skatteverket och utdelningen redovisas i kontrolluppgift.</p>
      <div className="grid">
        <div className="card stat"><div className="label">Beslutad, obetald utdelning (2898)</div><div className="value ks-debt">{kr(o.dividendDebt)}</div></div>
        <div className="card stat"><div className="label">Innehållen kupongskatt att betala</div><div className="value ks-unpaid">{kr(o.unpaidTax)}</div></div>
      </div>
      {o.unpaidTax > 0 && <form action={payWithholding.bind(null, company.id)}><button className="secondary">Bokför inbetalning till Skatteverket</button></form>}
      <table className="ks-list"><tbody>{o.rows.map((r) => <tr key={r.id} className="ks-row"><td>{r.date}</td><td>{r.recipient} <span className="small muted">{r.country}</span></td><td className="num">{kr(r.gross)}</td><td>{r.pct} %</td><td className="num">{kr(r.withheld)}</td><td>{r.paid_to_skv ? 'Inbetald' : 'Att betala'}</td></tr>)}</tbody></table>
      <form action={payDividend.bind(null, company.id)} className="card row" style={{ marginTop: '1rem' }}>
        <label>Mottagare<input name="recipient" required maxLength={200} /></label>
        <label>Hemviststat<input name="country" required maxLength={2} style={{ width: '4rem' }} placeholder="NO" /></label>
        <label>Mottagaren är<select name="recipient_type"><option value="person">Fysisk person</option><option value="company">Bolag</option></select></label>
        <label>Ägarandel %<input name="holding_pct" defaultValue="0" style={{ width: '5rem' }} /></label>
        <label className="row" style={{ alignItems: 'center' }}><input type="checkbox" name="business_related" /> Näringsbetingade andelar</label>
        <label>Avtalssats % (om annan)<input name="treaty_rate" style={{ width: '5rem' }} /></label>
        <label>Utdelning före skatt (kr)<input name="gross" required style={{ width: '8rem' }} /></label>
        <label>Utbetalningsdag<input type="date" name="date" defaultValue={today()} /></label>
        <div style={{ flex: '0 0 auto' }}><button>Bokför utbetalning</button></div>
      </form>
    </div>
  );
}
