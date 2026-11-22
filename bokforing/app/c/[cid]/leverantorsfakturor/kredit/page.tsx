import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/supplier-credit';
import { apply, refund, register } from './actions';

export const dynamic = 'force-dynamic';

/** Kreditfakturor från leverantörer */
export default async function SupplierCredits({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'purchasing' });
  const o = await overview(company.id);
  const b = `/c/${company.id}`;
  return (
    <div style={{ maxWidth: 1000 }}>
      <p><Link href={`${b}/leverantorsfakturor`}>← Leverantörsfakturor</Link></p>
      <h1>Kreditfakturor från leverantörer</h1>
      <Flash searchParams={searchParams} />
      <p className="small">En kreditfaktura bokar tillbaka kostnaden och den ingående momsen mot leverantörsskulden. Avser den en obetald faktura kvittas den direkt;
        annars kan den kvittas mot nästa faktura från samma leverantör eller bokas som återbetalning när leverantören betalar tillbaka.</p>
      <table className="sc-list"><tbody>{o.credits.map((c) => {
        const left = c.total - c.used;
        const targets = o.open.filter((i) => i.supplier_id === c.supplier_id);
        return (
          <tr key={c.id} className="sc-row" data-number={c.credit_number}><td>{c.date}</td><td>{c.supplier}</td><td>{c.credit_number}{c.original ? ` (avser ${c.original})` : ''}</td><td className="num">{kr(c.total)}</td>
            <td className="num sc-left">{kr(left)}</td>
            <td>{left > 0 && <div className="row" style={{ gap: '.25rem' }}>
              {targets.length > 0 && <form action={apply.bind(null, company.id, c.id)} className="row" style={{ gap: '.25rem' }}><select name="invoice_id">{targets.map((i) => <option key={i.id} value={i.id}>{i.number} ({kr(i.remaining)})</option>)}</select><button className="secondary">Kvitta</button></form>}
              <form action={refund.bind(null, company.id, c.id)} className="row" style={{ gap: '.25rem' }}><input type="date" name="date" defaultValue={today()} /><button className="secondary">Återbetald</button></form></div>}</td></tr>);
      })}</tbody></table>
      <form action={register.bind(null, company.id)} className="card row" style={{ marginTop: '1rem' }}>
        <label>Avser faktura<select name="original_invoice_id" required>{o.invoices.map((i) => <option key={i.id} value={i.id}>{i.supplier} – {i.number} ({kr(i.total)})</option>)}</select></label>
        <label>Kreditfakturans nummer<input name="credit_number" required maxLength={60} /></label>
        <label>Belopp inkl. moms (kr)<input name="total" required style={{ width: '8rem' }} /></label>
        <label>Varav moms (kr)<input name="vat" defaultValue="0" style={{ width: '7rem' }} /></label>
        <label>Datum<input type="date" name="date" defaultValue={today()} /></label>
        <div style={{ flex: '0 0 auto' }}><button>Bokför kreditfaktura</button></div>
      </form>
    </div>
  );
}
