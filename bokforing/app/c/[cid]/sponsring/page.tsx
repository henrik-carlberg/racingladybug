import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { GIFT_LIMIT } from '@/lib/sponsorship';
import { overview } from '@/lib/services/sponsorship';
import { register } from './actions';

export const dynamic = 'force-dynamic';

/** Sponsring och gåvor till affärsförbindelser */
export default async function Sponsorship({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const year = /^\d{4}$/.test(String(sp.ar ?? '')) ? Number(sp.ar) : Number(today().slice(0, 4));
  const o = await overview(company.id, year);
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Sponsring och gåvor</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Sponsring är avdragsgill när bolaget får en motprestation som motsvarar betalningen, t.ex. reklamplats, exponering eller biljetter för kunder; beskriv den.
        Utan motprestation är betalningen en gåva som inte är avdragsgill, och momsen får då inte dras av. Gåvor till kunder och affärskontakter är avdragsgilla bara om värdet är
        obetydligt, högst {kr(GIFT_LIMIT)} kr exkl. moms per mottagare. Ej avdragsgilla belopp bokförs på 6993 och läggs till i deklarationen.</p>
      <div className="grid">
        <div className="card stat"><div className="label">Avdragsgillt {year}</div><div className="value sp-ded">{kr(o.deductible)}</div></div>
        <div className="card stat"><div className="label">Ej avdragsgillt {year} (läggs till i deklarationen)</div><div className="value sp-nonded">{kr(o.nonDeductible)}</div></div>
      </div>
      <table className="sp-list"><tbody>{o.rows.map((r) => <tr key={r.id} className="sp-row"><td>{r.date}</td><td>{r.kind === 'gift' ? `Gåvor till ${r.recipients}` : 'Sponsring'}</td><td>{r.recipient}</td>
        <td className="num">{kr(r.amount)}</td><td>{r.deductible ? 'Avdragsgill' : 'Ej avdragsgill'}</td><td className="small">{r.counter_performance}</td></tr>)}</tbody></table>
      <div className="row" style={{ alignItems: 'start', marginTop: '1rem' }}>
        <form action={register.bind(null, company.id)} className="card stack sp-sponsor" style={{ flex: 1 }}>
          <input type="hidden" name="kind" value="sponsor" />
          <h3 style={{ margin: 0 }}>Sponsring</h3>
          <label>Den sponsrade<input name="recipient" required maxLength={200} /></label>
          <label>Belopp exkl. moms (kr)<input name="amount" required /></label>
          <label>Moms (kr)<input name="vat" defaultValue="0" /></label>
          <label>Motprestation (lämna tomt om ingen)<input name="counter_performance" maxLength={500} placeholder="T.ex. logotyp på matchtröjor och skylt vid planen" /></label>
          <label>Datum<input type="date" name="date" defaultValue={today()} /></label>
          <div><button>Bokför sponsring</button></div>
        </form>
        <form action={register.bind(null, company.id)} className="card stack sp-gift" style={{ flex: 1 }}>
          <input type="hidden" name="kind" value="gift" />
          <h3 style={{ margin: 0 }}>Gåvor till affärsförbindelser</h3>
          <label>Mottagare<input name="recipient" required maxLength={200} placeholder="T.ex. julgåvor till kunder" /></label>
          <label>Antal mottagare<input name="recipients" defaultValue="1" /></label>
          <label>Belopp exkl. moms totalt (kr)<input name="amount" required /></label>
          <label>Moms (kr)<input name="vat" defaultValue="0" /></label>
          <label>Datum<input type="date" name="date" defaultValue={today()} /></label>
          <div><button>Bokför gåvor</button></div>
        </form>
      </div>
    </div>
  );
}
