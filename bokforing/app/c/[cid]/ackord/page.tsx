import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/debt-settlement';
import { settle } from './actions';

export const dynamic = 'force-dynamic';

/** Ackord vid företagsrekonstruktion */
export default async function Settlement({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const o = await overview(company.id);
  const b = `/c/${company.id}`;
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Ackord och skuldnedskrivning</h1>
      <Flash searchParams={searchParams} />
      <p className="small">När tingsrätten har fastställt ett ackord i en företagsrekonstruktion sätts leverantörsskulderna ned till dividenden. Nedsättningen bokförs som ackordsvinst (3996).
        Den är inte skattepliktig, men bolagets underskott från tidigare år minskas med motsvarande belopp. Resten betalas enligt ackordet.
        Ackord gäller oprioriterade fordringar; skatter, löner och säkerställda skulder omfattas normalt inte.</p>
      <div className="grid"><div className="card stat"><div className="label">Underskott från tidigare år</div><div className="value ak-deficit">{kr(o.deficit)}</div></div></div>
      {o.done.map((d) => <div key={d.id} className="card small ak-done">Ackord {d.decided_on} (rekonstruktion {d.reconstruction_on}): dividend {d.dividend_pct} %, nedsättning <b className="ak-writedown">{kr(d.writedown)}</b> kr,
        att betala {kr(d.to_pay)} kr{d.pay_by ? ` senast ${d.pay_by}` : ''}. <Link href={`${b}/bokslut/underskott`}>Underskott</Link></div>)}
      {o.rows.map((r) => r.note && <p key={r.year} className="small ak-note">{r.year}: {r.note}</p>)}
      {o.debts.length > 0 ? (
        <form action={settle.bind(null, company.id)} className="card stack">
          <h3 style={{ margin: 0 }}>Fastställt ackord</h3>
          <table><tbody>{o.debts.map((d) => <tr key={d.id}><td><input type="checkbox" name="inv" value={d.id} defaultChecked aria-label={d.number} /></td><td>{d.supplier}</td><td>{d.number}</td><td className="num">{kr(d.remaining)}</td></tr>)}</tbody></table>
          <div className="row">
            <label>Beslut om rekonstruktion<input type="date" name="reconstruction_on" required /></label>
            <label>Ackordet fastställt<input type="date" name="decided_on" defaultValue={today()} /></label>
            <label>Dividend (% som betalas)<input name="dividend_pct" required style={{ width: '6rem' }} /></label>
            <label>Betalas senast<input type="date" name="pay_by" /></label>
          </div>
          <div><button>Bokför ackordet</button></div>
        </form>) : <p className="muted">Inga öppna leverantörsskulder.</p>}
    </div>
  );
}
