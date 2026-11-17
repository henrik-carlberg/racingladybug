import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { loadLines } from '@/lib/server/invoices';
import { Flash, Status, type SP } from '@/components/ui';
import { computeInvoice, lineNet } from '@/lib/invoice';
import { kr, today } from '@/lib/format';
import { bookInvoice, creditInvoice, deleteDraft, registerPayment } from '../actions';
import { PrintButton } from '@/components/PrintButton';

export const dynamic = 'force-dynamic';

interface Inv {
  id: number; invoice_number: number | null; invoice_date: string; due_date: string; delivery_date: string; status: string; ocr: string | null;
  our_reference: string; your_reference: string; notes: string; reverse_charge: boolean; total: number; rounding: number;
  voucher_id: number | null; payment_voucher_id: number | null; paid_date: string | null; credit_of_id: number | null;
  c_name: string; c_orgnr: string; c_vat: string; c_address: string; c_postal: string; c_city: string; c_country: string;
}

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ cid: string; iid: string }>; searchParams: SP }) {
  const { cid, iid } = await params;
  const { company: co } = await requireCompany(cid);
  const [inv] = await sql<Inv[]>`
    SELECT i.*, to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date, to_char(i.due_date,'YYYY-MM-DD') AS due_date,
      to_char(i.paid_date,'YYYY-MM-DD') AS paid_date,
      c.name AS c_name, c.orgnr AS c_orgnr, c.vat_number AS c_vat, c.address AS c_address, c.postal_code AS c_postal, c.city AS c_city, c.country AS c_country
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${Number(iid)} AND i.company_id = ${co.id}`;
  if (!inv) notFound();
  const lines = await loadLines(sql, inv.id);
  const t = computeInvoice(lines, { reverseCharge: inv.reverse_charge });
  const [orig] = inv.credit_of_id ? await sql<{ id: number; invoice_number: number }[]>`SELECT id, invoice_number FROM invoices WHERE id = ${inv.credit_of_id}` : [];
  const isCredit = !!inv.credit_of_id;
  const b = `/c/${co.id}`;
  const t0 = today();

  return (
    <>
      <div className="no-print">
        <div className="header">
          <h1>{inv.invoice_number ? `${isCredit ? 'Kreditfaktura' : 'Faktura'} ${inv.invoice_number}` : 'Fakturautkast'} <Status s={inv.status} overdue={inv.due_date < t0} /></h1>
          <div className="actions" style={{ margin: 0 }}>
            <Link className="btn secondary" href={`${b}/fakturor`}>Tillbaka</Link>
            {inv.status !== 'draft' && <PrintButton />}
          </div>
        </div>
        <Flash searchParams={searchParams} />
        {inv.status === 'draft' && (
          <div className="card actions">
            <Link className="btn secondary" href={`${b}/fakturor/${inv.id}/redigera`}>Redigera</Link>
            <form action={bookInvoice.bind(null, co.id, inv.id)}><button>Bokför faktura</button></form>
            <form action={deleteDraft.bind(null, co.id, inv.id)}><button className="link">Ta bort utkast</button></form>
            <span className="muted small">När fakturan bokförs får den fakturanummer och OCR och kan inte längre ändras.</span>
          </div>
        )}
        {inv.status === 'booked' && (
          <div className="card stack">
            <form action={registerPayment.bind(null, co.id, inv.id)} className="row">
              <label>Betaldatum<input type="date" name="date" defaultValue={t0} required /></label>
              <label>Belopp<input name="amount" defaultValue={(inv.total / 100).toFixed(2).replace('.', ',')} required /></label>
              <label>Bankkonto<select name="bank_account"><option value="1930">1930 Företagskonto</option><option value="1940">1940 Övriga bankkonton</option><option value="1910">1910 Kassa</option></select></label>
              <div style={{ flex: '0 0 auto' }}><button>Registrera inbetalning</button></div>
            </form>
            <form action={creditInvoice.bind(null, co.id, inv.id)} className="row">
              <label>Kreditera per datum<input type="date" name="date" defaultValue={t0} required /></label>
              <div style={{ flex: '0 0 auto' }}><button className="danger">Kreditera hela fakturan</button></div>
            </form>
          </div>
        )}
        {inv.status === 'booked' && !inv.voucher_id && (
          <p className="small muted">Kontantmetoden: fakturan bokförs när betalningen registreras (eller per bokslutsdagen om den är obetald vid årets slut).</p>
        )}
        {(inv.voucher_id || inv.payment_voucher_id) && (
          <p className="small">
            {inv.voucher_id && <>Bokförd: <Link href={`${b}/verifikationer/${inv.voucher_id}`}>verifikation</Link>. </>}
            {inv.payment_voucher_id && <>Betald {inv.paid_date}: <Link href={`${b}/verifikationer/${inv.payment_voucher_id}`}>verifikation</Link>.</>}
          </p>
        )}
      </div>

      <div className="doc">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '2rem' }}>
          <div>
            <h2 style={{ marginTop: 0 }}>{co.name}</h2>
            <div className="small">{co.address}<br />{co.postal_code} {co.city}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ marginTop: 0 }}>{isCredit ? 'KREDITFAKTURA' : 'FAKTURA'}</h2>
            <table className="small" style={{ width: 'auto', marginLeft: 'auto' }}>
              <tbody>
                <tr><td>Fakturanummer</td><td>{inv.invoice_number ?? '–'}</td></tr>
                <tr><td>Fakturadatum</td><td>{inv.invoice_date}</td></tr>
                {!isCredit && <tr><td>Förfallodatum</td><td><b>{inv.due_date}</b></td></tr>}
                <tr><td>Leveransdatum</td><td>{inv.delivery_date || inv.invoice_date}</td></tr>
                {inv.ocr && !isCredit && <tr><td>OCR</td><td className="mono">{inv.ocr}</td></tr>}
                {orig && <tr><td>Krediterar faktura</td><td>{orig.invoice_number}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', margin: '1.5rem 0', gap: '2rem' }}>
          <div className="small">
            {inv.our_reference && <>Vår referens: {inv.our_reference}<br /></>}
            {inv.your_reference && <>Er referens: {inv.your_reference}</>}
          </div>
          <div style={{ minWidth: 240 }}>
            <b>{inv.c_name}</b><br />{inv.c_address}<br />{inv.c_postal} {inv.c_city}{inv.c_country !== 'SE' ? `, ${inv.c_country}` : ''}
            {inv.c_orgnr && <><br /><span className="small">Org.nr {inv.c_orgnr}</span></>}
            {inv.c_vat && <><br /><span className="small">Momsreg.nr {inv.c_vat}</span></>}
          </div>
        </div>
        <table>
          <thead><tr><th>Beskrivning</th><th className="num">Antal</th><th className="num">À-pris</th><th className="num">Moms</th><th className="num">Belopp</th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>{l.description}</td>
                <td className="num">{String(l.quantity).replace('.', ',')} {l.unit}</td>
                <td className="num">{kr(l.unitPrice)}</td>
                <td className="num">{inv.reverse_charge ? '–' : `${l.vatRate} %`}</td>
                <td className="num">{kr(lineNet(l))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table style={{ width: 'auto', marginLeft: 'auto', marginTop: '1rem' }}>
          <tbody>
            <tr><td>Belopp exkl. moms</td><td className="num">{kr(t.net)}</td></tr>
            {Object.entries(t.vatByRate).filter(([r]) => r !== '0').map(([r, v]) => (
              <tr key={r}><td>Moms {r} % (underlag {kr(v.base)})</td><td className="num">{kr(v.vat)}</td></tr>
            ))}
            {t.rounding !== 0 && <tr><td>Öresavrundning</td><td className="num">{kr(t.rounding)}</td></tr>}
            <tr className="sum"><td>{isCredit ? 'Att kreditera' : 'Att betala'} SEK</td><td className="num">{kr(t.total)}</td></tr>
          </tbody>
        </table>
        {inv.reverse_charge && <p><b>Omvänd betalningsskyldighet</b> (Reverse charge, art. 196 Directive 2006/112/EC). Köparens momsreg.nr: {inv.c_vat}</p>}
        {inv.notes && <p>{inv.notes}</p>}
        <hr style={{ margin: '2rem 0 1rem', border: 0, borderTop: '1px solid #ddd' }} />
        <div className="small" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
          <div>{co.name}<br />{co.address}<br />{co.postal_code} {co.city}</div>
          <div>Org.nr {co.orgnr}<br />{co.vat_number && <>Momsreg.nr {co.vat_number}<br /></>}{co.f_skatt ? 'Godkänd för F-skatt' : ''}</div>
          <div>{co.bankgiro && <>Bankgiro {co.bankgiro}<br /></>}{co.plusgiro && <>Plusgiro {co.plusgiro}<br /></>}{co.iban && <>IBAN {co.iban}</>}</div>
          <div>{co.email}<br />{co.phone}</div>
        </div>
        {!isCredit && <p className="small" style={{ marginTop: '1rem' }}>{co.late_interest}</p>}
      </div>
    </>
  );
}
