import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { formatIban } from '@/lib/foreign-pay';
import { overview } from '@/lib/services/foreign-pay';
import { batch, cancel, settle, supplier } from './actions';

export const dynamic = 'force-dynamic';
const cur = (minor: number, c: string) => `${(minor / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

export default async function ForeignPayments({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(cid, { perm: 'payments' });
  const id = ctx.company.id;
  const o = await overview(id);
  const b = typeof sp.batch === 'string' && /^UB[0-9a-f]+$/.test(sp.batch) ? sp.batch : null;
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Utlandsbetalningar</h1>
      <p className="muted">Betala leverantörsfakturor i euro, dollar och andra valutor med en betalfil (pain.001) till banken. Har bolaget ett valutakonto i samma valuta dras betalningen därifrån, annars växlar banken från kronkontot. När banken har avräknat betalningen bokförs kursdifferensen och avgiften.</p>
      <Flash searchParams={searchParams} />
      {b && <p className="card"><a className="btn download-batch" href={`/c/${id}/utlandsbetalningar/fil?batch=${b}`} download>Ladda ner betalfilen</a></p>}
      <div className="small muted">Debiteringskonton: SEK {o.sekIban ? formatIban(o.sekIban) : '(saknar IBAN)'}{o.accounts.filter((a) => a.currency !== 'SEK').map((a) => ` · ${a.currency} ${formatIban(a.iban)}`).join('')}</div>

      <h2>Att betala</h2>
      <div className="table-wrap"><table className="foreign-payables">
        <thead><tr><th>Leverantör</th><th>Faktura</th><th>Förfaller</th><th className="num">Belopp</th><th className="num">Bokförd skuld</th><th>Till</th></tr></thead>
        <tbody>{o.payables.map((p) => (
          <tr key={p.id} className="payable"><td>{p.supplier}{p.blocked && <div className="small" style={{ color: 'var(--danger)' }}>Spärrad – se Varningar och kontroll</div>}</td><td>{p.invoice_number}</td><td>{p.due}</td>
            <td className="num">{cur(p.amountCurrency, p.currency)}</td><td className="num">{kr(p.open)}</td><td className="small">{p.iban ? formatIban(p.iban) : <span style={{ color: 'var(--danger)' }}>IBAN saknas</span>}{p.bic ? ` · ${p.bic}` : ''}</td></tr>
        ))}</tbody>
      </table></div>
      {o.payables.length > 0 && <form action={batch.bind(null, id)}><button>Skapa betalfil</button></form>}

      <h2>Skickade och avräknade</h2>
      <div className="table-wrap"><table className="foreign-payments">
        <thead><tr><th>Leverantör</th><th>Faktura</th><th className="num">Belopp</th><th>Avgifter</th><th className="num">Bokförd skuld</th><th>Avräkning</th></tr></thead>
        <tbody>{o.payments.map((p) => (
          <tr key={p.id} className={`fpayment ${p.status}`}><td>{p.supplier}</td><td>{p.invoice_number}<div className="small muted">{p.batch}</div></td><td className="num">{cur(p.amount_currency, p.currency)}</td><td>{p.charge_bearer}</td><td className="num">{kr(p.booked_sek)}</td>
            <td>{p.status === 'settled' ? <span className="settled">{p.settled_on}: {kr(p.paid_sek ?? 0)} + avgift {kr(p.fee ?? 0)} · kursdiff {kr((p.paid_sek ?? 0) - p.booked_sek)}</span>
              : p.status === 'cancelled' ? <span className="muted">Makulerad</span>
              : <div className="stack"><form action={settle.bind(null, id, p.id)} className="row"><input type="date" name="date" defaultValue={today()} aria-label="Datum" /><input name="paid_sek" inputMode="decimal" placeholder="Dragna kronor" required style={{ width: 120 }} /><input name="fee" inputMode="decimal" placeholder="Avgift" style={{ width: 80 }} /><input name="bank_account" defaultValue="1930" aria-label="Konto" style={{ width: 70 }} /><button className="secondary">Avräkna</button></form>
                <form action={cancel.bind(null, id, p.id)}><button className="secondary">Makulera</button></form></div>}</td></tr>
        ))}</tbody>
      </table></div>

      <h2>Leverantörer i utlandet</h2>
      <div className="table-wrap"><table className="foreign-suppliers"><thead><tr><th>Leverantör</th><th>IBAN</th><th>BIC</th><th>Land</th><th>Avgifter</th></tr></thead>
        <tbody>{o.suppliers.map((s) => <tr key={s.id} className="fsupplier"><td>{s.name}{o.pending.has(s.id) && <div className="small" style={{ color: 'var(--warn)' }}>Nya bankuppgifter väntar på godkännande</div>}</td><td>{s.iban ? formatIban(s.iban) : '–'}</td><td>{s.bic}</td><td>{s.country}</td><td>{s.charge_bearer}</td></tr>)}</tbody></table></div>
      <form action={supplier.bind(null, id)} className="card stack">
        <b>Uppgifter för utlandsbetalning</b>
        <div className="row"><label>Leverantör<select name="supplier_id">{o.all.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label style={{ flex: '2 1 240px' }}>IBAN<input name="iban" required /></label><label>BIC<input name="bic" /></label><label>Land<input name="country" maxLength={2} style={{ width: 60 }} /></label></div>
        <div className="row"><label>Avgifter<select name="charge_bearer"><option value="SHA">Delade (SHA)</option><option value="OUR">Vi betalar alla (OUR)</option></select></label>
          <label>Kod för betalningsstatistik<input name="reg_code" placeholder="vid belopp över 150 000 kr" /></label></div>
        <p className="small muted" style={{ margin: 0 }}>Betalning i euro inom SEPA görs alltid med delade avgifter (SLEV) och kräver inte BIC. Ett ändrat IBAN eller BIC måste godkännas av en annan person innan det används.</p>
        <div><button className="secondary">Spara</button></div>
      </form>
      <p className="small muted">Valutakonton omvärderas till balansdagens kurs under <Link href={`/c/${id}/bokslut/valuta`}>Bokslut → Omvärdering av valuta</Link>.</p>
    </div>
  );
}
