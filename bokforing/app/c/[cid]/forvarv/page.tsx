import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { taxNote } from '@/lib/business-acquisition';
import { ASSET_ROWS, LIABILITY_ROWS, list } from '@/lib/services/business-acquisition';
import { acquireAction } from './actions';

export const dynamic = 'force-dynamic';

/** Förvärv av rörelse (inkråmsköp): fördelning av köpeskillingen och goodwill */
export default async function Acquisition({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const rows = await list(company.id);
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Förvärv av rörelse</h1>
      <p className="small"><Link href={`/c/${company.id}/anlaggningar`}>Anläggningsregistret</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">Vid ett inkråmsköp köper bolaget en verksamhets tillgångar i stället för aktierna. Köpeskillingen fördelas på tillgångarna till verkligt värde, övertagna skulder räknas av,
        och det som blir över är goodwill. Goodwill skrivs av enligt plan (normalt 5 år). {taxNote}</p>
      {rows.length > 0 && <table className="acq-list"><tbody>{rows.map((r) => <tr key={r.id} className="acq-row"><td>{r.date}</td><td>{r.seller}</td><td className="num">{kr(r.price)}</td>
        <td className="num">goodwill <span className="acq-gw">{kr(r.goodwill)}</span></td><td>{r.voucher_id && <Link href={`/c/${company.id}/verifikationer/${r.voucher_id}`}>Verifikation</Link>}</td></tr>)}</tbody></table>}
      <form action={acquireAction.bind(null, company.id)} className="card stack" style={{ marginTop: '1rem' }}>
        <div className="row">
          <label>Säljare<input name="seller" required maxLength={200} /></label>
          <label>Tillträdesdag<input type="date" name="date" defaultValue={today()} required /></label>
          <label>Köpeskilling (kr)<input name="price" required /></label>
          <label>Betalas<select name="pay_to"><option value="1930">Från företagskontot</option><option value="2440">Skuld till säljaren</option></select></label>
        </div>
        <h2 style={{ margin: 0, fontSize: '1rem' }}>Tillgångar som tas över (verkligt värde)</h2>
        <div className="row">{ASSET_ROWS.map((r) => <label key={r.key}>{r.label} ({r.account})<input name={`a_${r.key}`} /></label>)}</div>
        <h2 style={{ margin: 0, fontSize: '1rem' }}>Skulder som tas över</h2>
        <div className="row">{LIABILITY_ROWS.map((r) => <label key={r.key}>{r.label} ({r.account})<input name={`l_${r.key}`} /></label>)}</div>
        <div className="row">
          <label>Avskrivningstid för goodwill (år)<input name="goodwill_years" defaultValue="5" style={{ width: '5rem' }} /></label>
          <label style={{ flex: '1 1 300px' }}>Avtal och värdering (underlag)<input name="agreement" maxLength={2000} placeholder="T.ex. överlåtelseavtal 2026-11-01, värdering av inventarier enligt besiktning" /></label>
        </div>
        <button>Bokför förvärvet</button>
      </form>
    </div>
  );
}
