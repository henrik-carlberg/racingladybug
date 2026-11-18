import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { sql } from '@/lib/db';
import { loadLines } from '@/lib/server/invoices';
import { invoiceByToken } from '@/lib/services/invoice-send';
import { listTimeEntries } from '@/lib/services/time';
import { InvoiceDoc, type InvoiceDocData } from '@/components/InvoiceDoc';
import { PrintButton } from '@/components/PrintButton';
import type { Company } from '@/lib/server/auth';
import { canPayByCard } from '@/lib/services/payments';
import { kr } from '@/lib/format';
import { payInvoice } from './actions';
import { PUBLIC, langOf } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false }, title: 'Faktura' };

/** Kundens länk till en skickad faktura – ingen inloggning, men länken är hemlig och slumpad */
export default async function PublicInvoice({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const ref = await invoiceByToken(token);
  if (!ref) notFound();
  const [inv] = await sql<(InvoiceDocData & { status: string; credit_of_id: number | null; paid_date: string | null })[]>`
    SELECT i.*, to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date, to_char(i.due_date,'YYYY-MM-DD') AS due_date, to_char(i.paid_date,'YYYY-MM-DD') AS paid_date,
      c.name AS c_name, c.orgnr AS c_orgnr, c.vat_number AS c_vat, c.address AS c_address, c.postal_code AS c_postal, c.city AS c_city, c.country AS c_country,
      i.reduction_type, i.tax_reduction, i.buyer_pnr, i.property, i.brf_orgnr, i.apartment_no, i.work_type
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${ref.id}`;
  const [co] = await sql<Company[]>`SELECT * FROM companies WHERE id = ${ref.company_id}`;
  const lines = await loadLines(sql, ref.id);
  const [orig] = inv.credit_of_id ? await sql<{ invoice_number: number }[]>`SELECT invoice_number FROM invoices WHERE id = ${inv.credit_of_id}` : [];
  const time = await listTimeEntries(ref.company_id, { invoice_id: ref.id });
  const card = await canPayByCard(ref.id);
  const [{ total }] = await sql<{ total: number }[]>`SELECT (total - paid_amount)::bigint AS total FROM invoices WHERE id = ${ref.id}`;
  const L = PUBLIC[langOf(inv.language)];
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem 16px' }}>
      <div className="no-print header" style={{ marginBottom: '1rem' }}>
        <span>{inv.status === 'paid' ? <span className="badge ok">{L.paid(inv.paid_date ?? '')}</span> : inv.status === 'credited' ? <span className="badge">{L.credited}</span> : null}</span>
        <div className="actions" style={{ margin: 0 }}>
          {card && sp.betalning !== 'klar' && <form action={payInvoice.bind(null, token)}><button>{L.payNow(kr(total))}</button></form>}
          <PrintButton label={L.print} />
        </div>
      </div>
      {sp.betalning === 'klar' && inv.status !== 'paid' && <div className="flash ok no-print">{L.thanks}</div>}
      {sp.betalning === 'fel' && <div className="flash error no-print">{L.payFailed}</div>}
      <InvoiceDoc inv={inv} lines={lines} co={co} orig={orig} isCredit={!!inv.credit_of_id} time={time} />
      <p className="no-print small muted" style={{ marginTop: '1rem' }}>{L.savePdf}</p>
    </main>
  );
}
