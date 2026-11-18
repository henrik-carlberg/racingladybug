import { translator } from '@/lib/ui-i18n';
import { uiLang } from '@/lib/server/lang';
import Link from 'next/link';
import { Pager, pageOf, pageSql, PAGE_SIZE } from '@/components/Pager';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, Header, Status, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function SupplierInvoices({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'purchasing' });
  const L = translator(await uiLang());
  const sp = await searchParams;
  const status = String(sp.status ?? 'open');
  const page = pageOf(sp);
  const all = await sql<{ id: number; supplier: string; invoice_number: string; invoice_date: string; due_date: string; total: number; status: string }[]>`
    SELECT i.id, s.name AS supplier, i.invoice_number, to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date,
      to_char(i.due_date,'YYYY-MM-DD') AS due_date, i.total, i.status
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.company_id = ${company.id}
    ${status === 'open' ? sql`AND i.status <> 'paid'` : status === 'all' ? sql`` : sql`AND i.status = ${status}`}
    ORDER BY i.due_date, i.id LIMIT ${pageSql(page).limit} OFFSET ${pageSql(page).offset}`;
  const hasMore = all.length > PAGE_SIZE;
  const rows = all.slice(0, PAGE_SIZE);
  const [{ inbox }] = await sql<{ inbox: number }[]>`SELECT count(*)::int AS inbox FROM inbox_documents WHERE company_id = ${company.id} AND status IN ('new','ready','failed')`;
  const t = today();
  const b = `/c/${company.id}`;
  return (
    <>
      <Header title={L('Leverantörsfakturor')}>
        <Link className="btn" href={`${b}/leverantorsfakturor/inkorg`}>Inkorg{inbox > 0 ? ` (${inbox})` : ''}</Link>
        <Link className="btn secondary" href={`${b}/leverantorsfakturor/ny`}>{L("Registrera faktura")}</Link>
        <Link className="btn secondary" href={`${b}/leverantorsfakturor/betalning`}>{L("Betalningsförslag")}</Link>
      </Header>
      <Flash searchParams={searchParams} />
      <div className="actions">
        {[['open', 'Obetalda'], ['booked', 'Att attestera'], ['approved', 'Attesterade'], ['paid', 'Betalda'], ['all', 'Alla']].map(([s, l]) => (
          <Link key={s} href={`${b}/leverantorsfakturor?status=${s}`} className={`btn ${status === s ? '' : 'secondary'}`}>{l}</Link>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{L("Leverantör")}</th><th>{L("Fakturanr")}</th><th>{L("Datum")}</th><th>{L("Förfaller")}</th><th className="num">{L("Belopp")}</th><th>{L("Status")}</th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td><Link href={`${b}/leverantorsfakturor/${i.id}`}>{i.supplier}</Link></td><td>{i.invoice_number}</td>
                <td>{i.invoice_date}</td><td>{i.due_date}</td><td className="num">{kr(i.total)}</td>
                <td><Status s={i.status} overdue={i.due_date < t} /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">{L("Inga fakturor.")}</td></tr>}
          </tbody>
        </table>
        <Pager base={`${b}/leverantorsfakturor`} sp={sp} page={page} hasMore={hasMore} count={rows.length} />
      </div>
    </>
  );
}
