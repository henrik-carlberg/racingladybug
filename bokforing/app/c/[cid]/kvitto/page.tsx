import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { ReceiptForm } from '@/components/ReceiptForm';
import { kr, today } from '@/lib/format';
import { readReceipt, saveReceipt } from './actions';
import { invoiceAiEnabled } from '@/lib/services/invoice-ai';

export const dynamic = 'force-dynamic';

export default async function Receipt({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const names = Object.fromEntries((await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${company.id}`).map((a) => [a.number, a.name]));
  const recent = await sql<{ id: number; date: string; description: string; amount: number; files: number }[]>`
    SELECT v.id, to_char(v.date,'YYYY-MM-DD') AS date, v.description,
      (SELECT SUM(debit) FROM voucher_lines WHERE voucher_id = v.id)::bigint AS amount,
      (SELECT count(*) FROM attachments WHERE voucher_id = v.id)::int AS files
    FROM vouchers v WHERE v.company_id = ${company.id} AND v.source_type = 'receipt' ORDER BY v.id DESC LIMIT 10`;
  return (
    <div style={{ maxWidth: 820 }}>
      <h1>Nytt kvitto eller utlägg</h1>
      <p className="muted">{invoiceAiEnabled() ? 'Fota kvittot – appen läser av datum, belopp och moms och föreslår vad det gäller. Kontrollera och bokför.' : 'Fota kvittot, välj vad det gäller – appen väljer konto och moms.'} Fakturor från leverantörer med betalning senare registrerar du under <Link href={`/c/${company.id}/leverantorsfakturor/ny`}>Leverantörsfakturor</Link>.</p>
      <Flash searchParams={searchParams} />
      <ReceiptForm action={saveReceipt.bind(null, company.id)} read={invoiceAiEnabled() ? readReceipt.bind(null, company.id) : undefined} today={today()} companyType={company.company_type} accountNames={names} />
      {recent.length > 0 && (
        <>
          <h2>Senaste kvitton</h2>
          <table><tbody>{recent.map((r) => (
            <tr key={r.id}><td>{r.date}</td><td><Link href={`/c/${company.id}/verifikationer/${r.id}`}>{r.description}</Link></td>
              <td className="num">{kr(r.amount)}</td><td>{r.files ? '📎' : <span className="badge warn">Saknar underlag</span>}</td></tr>
          ))}</tbody></table>
        </>
      )}
    </div>
  );
}
