import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { APPLICATION_FEE, STATUS_LABEL } from '@/lib/payment-order';
import { overview } from '@/lib/services/payment-orders';
import { apply, receive, setStatus } from './actions';

export const dynamic = 'force-dynamic';

/** Betalningsföreläggande hos Kronofogden */
export default async function PaymentOrders({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const o = await overview(company.id);
  const b = `/c/${company.id}`;
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Betalningsföreläggande</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Betalar kunden inte trots påminnelse och inkassokrav kan du ansöka om betalningsföreläggande hos Kronofogden. Ange kapitalet, dröjsmålsränta från förfallodagen
        (referensräntan + 8 procentenheter om inget annat avtalats), påminnelseavgift om den har avtalats (högst 60 kr) och ansökningsavgiften ({kr(APPLICATION_FEE)} kr), som gäldenären får betala.
        Bestrider kunden går ärendet till tingsrätten. Inbetalningar avräknas först mot kostnader, sedan ränta och sist kapital.</p>
      {o.orders.map((x) => (
        <section key={x.id} className="card stack po-order" data-number={x.number} style={{ marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}><Link href={`${b}/fakturor/${x.invoice_id}`}>Faktura {x.number}</Link> – {x.customer} <span className="badge po-status">{x.label}</span></h3>
          <table className="small po-basis"><tbody>
            <tr><td>Gäldenär</td><td>{x.customer}{x.orgnr ? `, ${x.orgnr}` : ''}</td></tr>
            <tr><td>Kapital</td><td className="num">{kr(x.capital)}</td></tr>
            <tr><td>Dröjsmålsränta {x.interest_rate} % från {x.due} (hittills)</td><td className="num po-interest">{kr(x.interestNow)}</td></tr>
            <tr><td>Påminnelseavgift</td><td className="num">{kr(x.reminder_fee)}</td></tr>
            <tr><td>Ansökningsavgift</td><td className="num">{kr(x.fee)}</td></tr>
            <tr><td>Kvar på fakturan</td><td className="num po-remaining">{kr(x.remaining)}</td></tr>
          </tbody></table>
          {x.next.length > 0 && <form action={setStatus.bind(null, company.id, x.id)} className="row"><select name="status">{x.next.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
            <input name="case_no" placeholder="Målnummer" defaultValue={x.case_no} maxLength={60} /><button className="secondary">Uppdatera</button></form>}
          {x.status !== 'paid' && x.status !== 'withdrawn' && <form action={receive.bind(null, company.id, x.id)} className="row"><label>Inbetalt via Kronofogden (kr)<input name="amount" required /></label>
            <label>Datum<input type="date" name="date" defaultValue={today()} /></label><button>Registrera inbetalning</button></form>}
        </section>
      ))}
      {o.candidates.length > 0 ? <form action={apply.bind(null, company.id)} className="card row">
        <label>Förfallen faktura<select name="invoice_id">{o.candidates.map((c) => <option key={c.id} value={c.id}>{c.number} – {c.customer} ({kr(c.remaining)}, förföll {c.due})</option>)}</select></label>
        <label>Dröjsmålsränta %<input name="interest_rate" defaultValue="10" style={{ width: '5rem' }} /></label>
        <label>Påminnelseavgift (kr)<input name="reminder_fee" defaultValue="0" style={{ width: '5rem' }} /></label>
        <label>Ansökt<input type="date" name="applied_on" defaultValue={today()} /></label>
        <div style={{ flex: '0 0 auto' }}><button>Registrera ansökan</button></div>
      </form> : <p className="muted">Inga förfallna, obetalda fakturor.</p>}
    </div>
  );
}
