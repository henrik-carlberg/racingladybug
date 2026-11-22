import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { addDays, kr, today } from '@/lib/format';
import { overview } from '@/lib/services/gift-cards';
import { expire, redeem, sell } from './actions';

export const dynamic = 'force-dynamic';

/** Presentkort: enfunktions- och flerfunktionsvoucher */
export default async function GiftCards({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const o = await overview(company.id);
  const t = today();
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Presentkort</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Ett presentkort som bara kan användas för varor eller tjänster med samma momssats hos er (enfunktionsvoucher) beskattas redan när det säljs.
        Kan det användas för varor med olika momssatser eller hos flera företag (flerfunktionsvoucher) tas momsen ut först när kortet löses in.
        Sålda kort är en skuld (2421) tills de löses in. Kort som går ut utan att användas intäktsförs utan moms.</p>
      <div className="grid">
        <div className="card stat"><div className="label">Utestående presentkort</div><div className="value gc-outstanding">{kr(o.outstanding)}</div></div>
      </div>
      {o.expiredDue > 0 && <form action={expire.bind(null, company.id)} className="card row"><span>{o.expiredDue} kort har gått ut utan att lösas in.</span><button className="secondary">Intäktsför utgångna presentkort</button></form>}
      <div className="row" style={{ alignItems: 'start' }}>
        <form action={sell.bind(null, company.id)} className="card stack gc-sell" style={{ flex: 1 }}>
          <h3 style={{ margin: 0 }}>Sälj presentkort</h3>
          <label>Kortnummer<input name="code" required maxLength={40} /></label>
          <label>Typ<select name="kind"><option value="single">Enfunktionsvoucher (en momssats, moms nu)</option><option value="multi">Flerfunktionsvoucher (moms vid inlösen)</option></select></label>
          <label>Momssats<select name="vat_rate"><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option></select></label>
          <label>Värde inkl. moms (kr)<input name="amount" required /></label>
          <label>Betalning<select name="payment"><option value="card">Kort</option><option value="swish">Swish</option><option value="cash">Kontant</option></select></label>
          <div className="row"><label>Sålt<input type="date" name="date" defaultValue={t} /></label><label>Giltigt till<input type="date" name="valid_to" defaultValue={addDays(t, 365)} /></label></div>
          <div><button>Bokför försäljning</button></div>
        </form>
        <form action={redeem.bind(null, company.id)} className="card stack gc-redeem" style={{ flex: 1 }}>
          <h3 style={{ margin: 0 }}>Lös in presentkort</h3>
          <label>Kortnummer<input name="code" required maxLength={40} /></label>
          <label>Belopp inkl. moms (kr)<input name="amount" required /></label>
          <label>Datum<input type="date" name="date" defaultValue={t} /></label>
          <div><button>Bokför inlösen</button></div>
        </form>
      </div>
      <table className="gc-list"><tbody>{o.cards.map((c) => <tr key={c.id} className="gc-row" data-code={c.code}><td>{c.code}</td><td>{c.kind === 'single' ? 'Enfunktion' : 'Flerfunktion'} {c.vat_rate} %</td>
        <td>{c.sold_on} – {c.valid_to}</td><td className="num">{kr(c.amount)}</td><td className="num gc-left">{kr(c.amount - c.redeemed)}</td><td>{c.expired_on ? `Utgånget ${c.expired_on}` : c.valid_to < t ? 'Har gått ut' : ''}</td></tr>)}</tbody></table>
    </div>
  );
}
