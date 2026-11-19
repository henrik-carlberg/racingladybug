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
import { payInvoice, swish, swishCheck } from './actions';
import { installments, swishAvailable, swishStatusFor } from '@/lib/services/paid-faster';
import { requestOrigin } from '@/lib/server/origin';
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
  const sw = await swishAvailable(ref.id);
  const instr = typeof sp.swish === 'string' && /^[0-9A-F]{32}$/.test(sp.swish) ? sp.swish : null;
  const swSt = instr ? await swishStatusFor(token, instr) : null;
  const appLink = typeof sp.st === 'string' ? `swish://paymentrequest?token=${encodeURIComponent(sp.st)}&callbackurl=${encodeURIComponent(`${await requestOrigin()}/f/${token}?swish=${instr}`)}` : null;
  const plan = await installments(ref.id);
  const paidSoFar = Number((inv as unknown as { paid_amount: number }).paid_amount ?? 0);
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
      {typeof sp.swishfel === 'string' && <div className="flash error no-print">{sp.swishfel}</div>}
      {swSt && swSt.status === 'paid' && <div className="flash ok no-print swish-paid">Tack! Swish-betalningen på {kr(swSt.amount)} kr är mottagen.</div>}
      {swSt && ['declined', 'error', 'cancelled'].includes(swSt.status) && <div className="flash error no-print">Swish-betalningen genomfördes inte{swSt.message ? `: ${swSt.message}` : ''}. Försök igen.</div>}
      {swSt && swSt.status === 'created' && (
        <div className="card stack no-print swish-wait">
          <b>Öppna Swish och godkänn betalningen på {kr(swSt.amount)} kr</b>
          {appLink && <a className="btn" href={appLink}>Öppna Swish</a>}
          <form action={swishCheck.bind(null, token, instr!)}><button className="secondary">Jag har godkänt – kontrollera</button></form>
        </div>
      )}
      {sw && !(swSt && swSt.status === 'created') && inv.status !== 'paid' && (
        <form action={swish.bind(null, token)} className="card row no-print swish-form" style={{ alignItems: 'end' }}>
          <label>Betala {kr(sw.amount)} kr med Swish – ditt mobilnummer<input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="Lämna tomt på mobilen" /></label>
          <div style={{ flex: '0 0 auto' }}><button>Betala med Swish</button></div>
        </form>
      )}
      {plan.length > 0 && (
        <div className="card no-print installments"><b>Delbetalning</b>
          <table className="small"><tbody>{plan.reduce<{ rows: React.ReactNode[]; cum: number }>((acc, p) => {
            acc.cum += p.amount;
            acc.rows.push(<tr key={p.n}><td>Del {p.n}</td><td>{p.due}</td><td className="num">{kr(p.amount)}</td><td>{acc.cum <= paidSoFar ? <span className="badge ok">Betald</span> : ''}</td></tr>);
            return acc;
          }, { rows: [], cum: 0 }).rows}</tbody></table></div>
      )}
      <InvoiceDoc inv={inv} lines={lines} co={co} orig={orig} isCredit={!!inv.credit_of_id} time={time} />
      <p className="no-print small muted" style={{ marginTop: '1rem' }}>{L.savePdf}</p>
    </main>
  );
}
