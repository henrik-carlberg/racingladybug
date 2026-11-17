import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { sql } from '@/lib/db';
import { loadLines } from '@/lib/server/invoices';
import { invoiceByToken } from '@/lib/services/invoice-send';
import { listTimeEntries } from '@/lib/services/time';
import { InvoiceDoc, type InvoiceDocData } from '@/components/InvoiceDoc';
import { PrintButton } from '@/components/PrintButton';
import type { Company } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false }, title: 'Faktura' };

/** Kundens länk till en skickad faktura – ingen inloggning, men länken är hemlig och slumpad */
export default async function PublicInvoice({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ref = await invoiceByToken(token);
  if (!ref) notFound();
  const [inv] = await sql<(InvoiceDocData & { status: string; credit_of_id: number | null; paid_date: string | null })[]>`
    SELECT i.*, to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date, to_char(i.due_date,'YYYY-MM-DD') AS due_date, to_char(i.paid_date,'YYYY-MM-DD') AS paid_date,
      c.name AS c_name, c.orgnr AS c_orgnr, c.vat_number AS c_vat, c.address AS c_address, c.postal_code AS c_postal, c.city AS c_city, c.country AS c_country
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${ref.id}`;
  const [co] = await sql<Company[]>`SELECT * FROM companies WHERE id = ${ref.company_id}`;
  const lines = await loadLines(sql, ref.id);
  const [orig] = inv.credit_of_id ? await sql<{ invoice_number: number }[]>`SELECT invoice_number FROM invoices WHERE id = ${inv.credit_of_id}` : [];
  const time = await listTimeEntries(ref.company_id, { invoice_id: ref.id });
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem 16px' }}>
      <div className="no-print header" style={{ marginBottom: '1rem' }}>
        <span>{inv.status === 'paid' ? <span className="badge ok">Betald {inv.paid_date}</span> : inv.status === 'credited' ? <span className="badge">Krediterad</span> : null}</span>
        <PrintButton />
      </div>
      <InvoiceDoc inv={inv} lines={lines} co={co} orig={orig} isCredit={!!inv.credit_of_id} time={time} />
      <p className="no-print small muted" style={{ marginTop: '1rem' }}>Välj ”Skriv ut” och sedan ”Spara som PDF” för att spara fakturan.</p>
    </main>
  );
}
