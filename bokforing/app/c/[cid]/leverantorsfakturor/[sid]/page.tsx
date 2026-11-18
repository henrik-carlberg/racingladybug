import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, Status, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { approve, markPaid } from '../actions';

export const dynamic = 'force-dynamic';

export default async function SupplierInvoice({ params, searchParams }: { params: Promise<{ cid: string; sid: string }>; searchParams: SP }) {
  const { cid, sid } = await params;
  const { company } = await requireCompany(cid);
  const [i] = await sql<{ id: number; paid_amount: number; supplier: string; bankgiro: string; plusgiro: string; bank_account: string; invoice_number: string; invoice_date: string; due_date: string;
    payment_reference: string; description: string; total: number; vat: number; status: string; approved_by: string | null; approved_at: string | null;
    voucher_id: number | null; payment_voucher_id: number | null; paid_date: string | null }[]>`
    SELECT i.*, s.name AS supplier, s.bankgiro, s.plusgiro, s.bank_account, to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date,
      to_char(i.due_date,'YYYY-MM-DD') AS due_date, to_char(i.paid_date,'YYYY-MM-DD') AS paid_date, u.name AS approved_by,
      to_char(i.approved_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS approved_at
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id LEFT JOIN users u ON u.id = i.approved_by
    WHERE i.id = ${Number(sid)} AND i.company_id = ${company.id}`;
  if (!i) notFound();
  const payments = await sql<{ id: number; date: string; amount: number; voucher_id: number | null }[]>`SELECT id, to_char(date,'YYYY-MM-DD') AS date, amount, voucher_id FROM supplier_invoice_payments WHERE supplier_invoice_id = ${i.id} ORDER BY date, id`;
  const files = await sql<{ id: number; filename: string }[]>`SELECT id, filename FROM attachments WHERE supplier_invoice_id = ${i.id}`;
  const b = `/c/${company.id}`;
  return (
    <>
      <h1>{i.supplier} – faktura {i.invoice_number} <Status s={i.status} overdue={i.due_date < today()} /></h1>
      <Flash searchParams={searchParams} />
      <div className="card grid">
        <div><div className="muted small">Fakturadatum</div>{i.invoice_date}</div>
        <div><div className="muted small">Förfallodatum</div>{i.due_date}</div>
        <div><div className="muted small">Att betala</div><b>{kr(i.total)}</b> (moms {kr(i.vat)})</div>
        <div><div className="muted small">Betala till</div>{i.bankgiro ? `BG ${i.bankgiro}` : i.plusgiro ? `PG ${i.plusgiro}` : i.bank_account || '–'}</div>
        <div><div className="muted small">OCR / meddelande</div><span className="mono">{i.payment_reference || '–'}</span></div>
        {i.approved_by && <div><div className="muted small">Attesterad</div>{i.approved_by}, {i.approved_at}</div>}
      </div>
      {i.description && <p>{i.description}</p>}
      <p className="small">
        {i.voucher_id && <>Bokförd: <Link href={`${b}/verifikationer/${i.voucher_id}`}>verifikation</Link>. </>}
        {i.payment_voucher_id && i.status === 'paid' && <>Betald {i.paid_date}: <Link href={`${b}/verifikationer/${i.payment_voucher_id}`}>verifikation</Link>.</>}
        {!i.voucher_id && !i.payment_voucher_id && <span className="muted">Kontantmetoden: fakturan bokförs när den betalas (eller per bokslutsdagen om den är obetald vid årets slut).</span>}
      </p>
      {files.length > 0 && <p>Underlag: {files.map((f) => <a key={f.id} href={`${b}/underlag/${f.id}`} target="_blank">{f.filename} </a>)}</p>}
      {i.status === 'booked' && (
        <form action={approve.bind(null, company.id, i.id)} className="card actions">
          <button>Attestera för betalning</button>
          <span className="muted small">Attesten loggas med ditt namn.</span>
        </form>
      )}
      {payments.length > 0 && (
        <div className="card small">
          <b>Betalningar</b> – betalt {kr(i.paid_amount)} av {kr(i.total)}{Number(i.paid_amount) < Number(i.total) && <>, kvar {kr(Number(i.total) - Number(i.paid_amount))}</>}
          <ul>{payments.map((p) => <li key={p.id}>{p.date}: {kr(p.amount)} {p.voucher_id && <Link href={`${b}/verifikationer/${p.voucher_id}`}>verifikation</Link>}</li>)}</ul>
        </div>
      )}
      {i.status === 'approved' && (
        <form action={markPaid.bind(null, company.id, i.id)} className="card row">
          <label>Betaldatum<input type="date" name="date" defaultValue={today()} required /></label>
          <label>Belopp<input name="amount" defaultValue={((Number(i.total) - Number(i.paid_amount)) / 100).toFixed(2).replace('.', ',')} required /></label>
          <label>Från konto<select name="bank_account"><option value="1930">1930 Företagskonto</option><option value="1940">1940 Övriga bankkonton</option></select></label>
          <div style={{ flex: '0 0 auto' }}><button>Bokför betalning</button></div>
        </form>
      )}
    </>
  );
}
