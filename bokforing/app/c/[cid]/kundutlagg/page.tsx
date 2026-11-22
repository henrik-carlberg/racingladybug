import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/outlays';
import { invoice, register } from './actions';

export const dynamic = 'force-dynamic';

/** Utlägg för kunds räkning */
export default async function Outlays({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const o = await overview(company.id);
  const b = `/c/${company.id}`;
  const open = [...new Map(o.rows.filter((r) => !r.invoice_id).map((r) => [r.customer_id, r.customer])).entries()];
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Utlägg för kunder</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Ett utlägg är en kostnad som du betalar i kundens namn och för kundens räkning, till exempel en ansökningsavgift eller avgift till en myndighet, med kvitto ställt till kunden.
        Utlägget bokförs som fordran (1680) och faktureras utan moms; det är inte omsättning och tas inte upp i momsdeklarationen.
        Köper du något själv och tar betalt av kunden är det i stället vidarefakturering: vanlig försäljning med moms, även om du fakturerar till självkostnad.</p>
      <div className="grid"><div className="card stat"><div className="label">Ofakturerade utlägg</div><div className="value ku-open">{kr(o.open)}</div></div></div>
      {open.map(([id, name]) => <form key={id} action={invoice.bind(null, company.id, id)} className="row ku-invoice"><span>{name}</span><button className="secondary">Skapa faktura för utläggen</button></form>)}
      <table className="ku-list"><tbody>{o.rows.map((r) => <tr key={r.id} className="ku-row"><td>{r.date}</td><td>{r.customer}</td><td>{r.description}</td><td className="num">{kr(r.amount)}</td>
        <td>{r.invoice_id ? <Link href={`${b}/fakturor/${r.invoice_id}`}>{r.invoice_status === 'draft' ? 'Utkast' : 'Fakturerad'}</Link> : 'Att fakturera'}</td></tr>)}</tbody></table>
      <form action={register.bind(null, company.id)} className="card stack" style={{ marginTop: '1rem' }}>
        <div className="row">
          <label>Kund<select name="customer_id" required>{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Beskrivning<input name="description" required maxLength={200} placeholder="T.ex. ansökningsavgift till Bolagsverket" /></label>
          <label>Belopp (kr)<input name="amount" required style={{ width: '8rem' }} /></label>
          <label>Betalt<input type="date" name="date" defaultValue={today()} /></label>
        </div>
        <label className="check"><input type="checkbox" name="on_behalf" /> Köpet är gjort i kundens namn och för kundens räkning</label>
        <label className="check"><input type="checkbox" name="receipt" /> Kvittot är ställt till kunden</label>
        <div><button>Bokför utlägg</button></div>
      </form>
    </div>
  );
}
