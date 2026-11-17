import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { markManyPaid } from '../actions';

export const dynamic = 'force-dynamic';

export default async function Payments({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const rows = await sql<{ id: number; supplier: string; to: string; invoice_number: string; due_date: string; reference: string; total: number }[]>`
    SELECT i.id, s.name AS supplier, COALESCE(NULLIF('BG ' || NULLIF(s.bankgiro,''), ''), NULLIF('PG ' || NULLIF(s.plusgiro,''), ''), s.bank_account) AS to,
      i.invoice_number, to_char(i.due_date,'YYYY-MM-DD') AS due_date, i.payment_reference AS reference, i.total
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id
    WHERE i.company_id = ${company.id} AND i.status = 'approved' ORDER BY i.due_date`;
  const [{ n: waiting }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM supplier_invoices WHERE company_id = ${company.id} AND status = 'booked'`;
  const b = `/c/${company.id}`;
  const sum = rows.reduce((s, r) => s + r.total, 0);
  return (
    <>
      <h1>Betalningsförslag</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Attesterade, obetalda leverantörsfakturor. Lägg in betalningarna i internetbanken (eller ladda ner listan) och bokför dem sedan här.
        {waiting > 0 && <> {waiting} faktura(or) <Link href={`${b}/leverantorsfakturor?status=booked`}>väntar på attest</Link>.</>}</p>
      <form action={markManyPaid.bind(null, company.id)} className="stack">
        <div className="table-wrap">
          <table>
            <thead><tr><th></th><th>Förfaller</th><th>Leverantör</th><th>Till</th><th>OCR / meddelande</th><th className="num">Belopp</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><input type="checkbox" name="ids" value={r.id} defaultChecked /></td>
                  <td>{r.due_date}</td><td><Link href={`${b}/leverantorsfakturor/${r.id}`}>{r.supplier}</Link> <span className="small muted">({r.invoice_number})</span></td>
                  <td>{r.to}</td><td className="mono">{r.reference}</td><td className="num">{kr(r.total)}</td>
                </tr>
              ))}
              {rows.length === 0 ? <tr><td colSpan={6} className="muted">Inga attesterade fakturor att betala.</td></tr> :
                <tr className="sum"><td colSpan={5}>Summa</td><td className="num">{kr(sum)}</td></tr>}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && (
          <div className="card row">
            <label>Betaldatum<input type="date" name="date" defaultValue={today()} required /></label>
            <label>Från konto<select name="bank_account"><option value="1930">1930 Företagskonto</option><option value="1940">1940 Övriga bankkonton</option></select></label>
            <div style={{ flex: '0 0 auto' }}><button>Bokför valda som betalda</button></div>
            <div style={{ flex: '0 0 auto' }}><a className="btn secondary" href={`${b}/leverantorsfakturor/betalning/fil`}>Ladda ner betalningslista (CSV)</a></div>
          </div>
        )}
      </form>
    </>
  );
}
