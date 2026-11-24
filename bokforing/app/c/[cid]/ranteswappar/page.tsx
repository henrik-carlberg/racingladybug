import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/interest-swaps';
import { addAction, settleAction, valueAction } from './actions';

export const dynamic = 'force-dynamic';
const pct = (n: number) => `${n.toLocaleString('sv-SE')} %`;

export default async function Swaps({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const o = await overview(id);
  const t = today();
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Räntesäkring</h1>
      <Flash searchParams={searchParams} />
      <p className="small">En ränteswap byter den rörliga räntan på ett <Link href={`/c/${id}/finansiering`}>lån</Link> mot en fast: bolaget betalar den fasta swapräntan och får den rörliga referensräntan (t.ex. STIBOR 3M).
        Nettot för varje period bokförs mot räntekostnaden på 8410, så lånets effektiva ränta blir swapräntan plus lånets marginal. Swappen tas inte upp i balansräkningen (säkringsredovisning), men marknadsvärdet lämnas som upplysning i årsredovisningen.</p>
      {o.swaps.map((s) => (
        <div key={s.id} className="card stack small sw-swap" data-counterparty={s.counterparty}>
          <div><strong>{s.counterparty}</strong> · nominellt {kr(s.notional)} kr · betalar fast {pct(s.fixed_rate)} och får {s.floating_index} · {s.start_date} – {s.end_date}{s.loan && ` · säkrar ${s.loan}`}</div>
          <div className="sw-figures">Netto hittills <span className="sw-net">{kr(s.net)}</span> kr{s.effective != null && <> · lånets effektiva ränta <span className="sw-effective">{pct(s.effective)}</span> (lånet {pct(s.loan_rate ?? 0)})</>}</div>
          {s.settlements.length > 0 && <table className="sw-settlements"><tbody>{s.settlements.map((x) => <tr key={x.period_start}><td>{x.period_start} – {x.period_end}</td><td>{s.floating_index} {pct(x.floating_rate)}</td><td className="num">{kr(x.amount)}</td><td>{x.voucher_id && <Link href={`/c/${id}/verifikationer/${x.voucher_id}`}>ver</Link>}</td></tr>)}</tbody></table>}
          {s.next && <form action={settleAction.bind(null, id, s.id)} className="row sw-settle" data-due={s.nextDue ? '1' : '0'} style={{ gap: '.25rem' }}>
            <span>Nästa period {s.next.start} – {s.next.end}{!s.nextDue && ' (inte slut än)'}</span><input name="floating_rate" placeholder={`${s.floating_index} %`} inputMode="decimal" style={{ width: '7rem' }} /><button className="link">Avräkna</button></form>}
          <form action={valueAction.bind(null, id, s.id)} className="row sw-value" style={{ gap: '.25rem' }}><input type="date" name="date" defaultValue={`${t.slice(0, 4)}-12-31`} /><input name="market_value" placeholder="Marknadsvärde (negativt = skuld)" style={{ width: '14rem' }} /><button className="link">Spara värdering</button></form>
          <div className="sw-note">Upplysning: {s.note}</div>
        </div>))}
      {!o.swaps.length && <p className="muted">Inga ränteswappar.</p>}
      <h2>Ny ränteswap</h2>
      <form action={addAction.bind(null, id)} className="card row sw-add">
        <label>Motpart<input name="counterparty" required maxLength={100} /></label>
        <label>Lån<select name="loan_id"><option value="">–</option>{o.loans.map((l) => <option key={l.id} value={l.id}>{l.name} ({kr(l.balance)} kr)</option>)}</select></label>
        <label>Nominellt belopp<input name="notional" inputMode="decimal" required /></label>
        <label>Fast ränta %<input name="fixed_rate" inputMode="decimal" required style={{ width: '5rem' }} /></label>
        <label>Rörlig referens<input name="floating_index" defaultValue="STIBOR 3M" style={{ width: '7rem' }} /></label>
        <label>Start<input type="date" name="start_date" required /></label>
        <label>Slut<input type="date" name="end_date" required /></label>
        <label>Avräkning<select name="period_months" defaultValue="3"><option value="1">Månad</option><option value="3">Kvartal</option><option value="6">Halvår</option><option value="12">År</option></select></label>
        <button>Spara ränteswap</button>
      </form>
    </div>
  );
}
