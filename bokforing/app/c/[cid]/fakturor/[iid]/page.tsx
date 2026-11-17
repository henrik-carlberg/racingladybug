import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { loadLines } from '@/lib/server/invoices';
import { Flash, Status, type SP } from '@/components/ui';
import { today } from '@/lib/format';
import { bookInvoice, creditInvoice, deleteDraft, registerPayment, sendInvoice } from '../actions';
import { PrintButton } from '@/components/PrintButton';
import { InvoiceDoc } from '@/components/InvoiceDoc';
import { listTimeEntries } from '@/lib/services/time';

export const dynamic = 'force-dynamic';

interface Inv {
  id: number; invoice_number: number | null; invoice_date: string; due_date: string; delivery_date: string; status: string; ocr: string | null;
  our_reference: string; your_reference: string; notes: string; reverse_charge: boolean; total: number; rounding: number;
  voucher_id: number | null; payment_voucher_id: number | null; paid_date: string | null; credit_of_id: number | null;
  hour_bank: { period: string; purchased: number; drawn_before: number; used_now: number; drawn: number; overage: number; remaining: number } | null;
  c_email: string; public_token: string | null; sent_local: string | null; sent_to: string | null;
  c_name: string; c_orgnr: string; c_vat: string; c_address: string; c_postal: string; c_city: string; c_country: string;
}

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ cid: string; iid: string }>; searchParams: SP }) {
  const { cid, iid } = await params;
  const { company: co } = await requireCompany(cid);
  const [inv] = await sql<Inv[]>`
    SELECT i.*, to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date, to_char(i.due_date,'YYYY-MM-DD') AS due_date,
      to_char(i.paid_date,'YYYY-MM-DD') AS paid_date,
      c.email AS c_email, to_char(i.sent_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS sent_local,
      c.name AS c_name, c.orgnr AS c_orgnr, c.vat_number AS c_vat, c.address AS c_address, c.postal_code AS c_postal, c.city AS c_city, c.country AS c_country
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${Number(iid)} AND i.company_id = ${co.id}`;
  if (!inv) notFound();
  const lines = await loadLines(sql, inv.id);
  const [orig] = inv.credit_of_id ? await sql<{ id: number; invoice_number: number }[]>`SELECT id, invoice_number FROM invoices WHERE id = ${inv.credit_of_id}` : [];
  const isCredit = !!inv.credit_of_id;
  const time = await listTimeEntries(co.id, { invoice_id: inv.id });
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
        {inv.status !== 'draft' && (
          <form action={sendInvoice.bind(null, co.id, inv.id)} className="card stack">
            <div className="row">
              <label>Skicka till e-post<input name="to" type="email" defaultValue={inv.sent_to ?? inv.c_email} placeholder="kund@exempel.se" /></label>
              <label style={{ flex: '3 1 300px' }}>Meddelande (valfritt)<input name="message" placeholder="Tack för uppdraget!" /></label>
              <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className={inv.sent_local ? 'secondary' : ''}>{inv.sent_local ? 'Skicka igen' : 'Skicka faktura'}</button></div>
            </div>
            <span className="small muted">{inv.sent_local ? `Skickad ${inv.sent_local} till ${inv.sent_to}. ` : ''}Kunden får en länk där fakturan kan visas, skrivas ut och sparas som PDF.
              {inv.public_token && <> Länk: <a href={`/f/${inv.public_token}`} target="_blank">/f/{inv.public_token.slice(0, 8)}…</a></>}</span>
          </form>
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

      <InvoiceDoc inv={inv} lines={lines} co={co} orig={orig} isCredit={isCredit} time={time} />
    </>
  );
}
