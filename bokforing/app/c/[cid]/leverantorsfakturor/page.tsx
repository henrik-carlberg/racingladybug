import { translator } from '@/lib/ui-i18n';
import { uiLang } from '@/lib/server/lang';
import Link from 'next/link';
import { Pager, pageOf, pageSql, PAGE_SIZE } from '@/components/Pager';
import { sql } from '@/lib/db';
import { companyInboxAddress } from '@/lib/services/inbox';
import { requireCompany } from '@/lib/server/auth';
import { Flash, Header, Status, type SP, EmptyState } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { candidates as nettable } from '@/lib/services/netting';

export const dynamic = 'force-dynamic';

export default async function SupplierInvoices({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { perm: 'purchasing' });
  const { company } = ctx;
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
  const [{ none }] = await sql<{ none: boolean }[]>`SELECT NOT EXISTS (SELECT 1 FROM supplier_invoices WHERE company_id = ${company.id}) AS none`;
  const inboxAddr = none ? await companyInboxAddress(company.id) : null;
  return (
    <>
      <Header title={L('Leverantörsfakturor')} help="attest">
        <Link className="btn" href={`${b}/leverantorsfakturor/inkorg`}>Inkorg{inbox > 0 ? ` (${inbox})` : ''}</Link>
        <Link className="btn secondary" href={`${b}/leverantorsfakturor/ny`}>{L("Registrera faktura")}</Link>
        <Link className="btn secondary" href={`${b}/leverantorsfakturor/betalning`}>{L("Betalningsförslag")}</Link>
        <Link className="btn secondary" href={`${b}/leverantorsfakturor/aterkommande`}>Återkommande</Link>
        <Link className="btn secondary" href={`${b}/leverantorsfakturor/kredit`}>Kreditfakturor</Link>
        <Link className="btn secondary" href={`${b}/leverantorsfakturor/forskott`}>Förskott</Link>
        <Link className="btn secondary" href={`${b}/leverantorsfakturor/bonus`}>Bonus</Link>
        <a className="btn secondary" href={`${b}/rapporter/xlsx?r=leverantorsfakturor`} download>Excel</a>
      </Header>
      <Flash searchParams={searchParams} />
      {ctx.can('payments') && await nettable(company.id).then((n) => n.length > 0 && <p className="card kv-reminder">{n.length} motpart{n.length > 1 ? 'er' : ''} har både obetalda kundfakturor och leverantörsfakturor ({n.map((x) => x.name).join(', ')}). <Link href={`/c/${company.id}/kvittning`}>Kvitta</Link></p>)}
      <div className="actions">
        {[['open', 'Obetalda'], ['booked', 'Att attestera'], ['approved', 'Attesterade'], ['paid', 'Betalda'], ['all', 'Alla']].map(([s, l]) => (
          <Link key={s} href={`${b}/leverantorsfakturor?status=${s}`} className={`btn ${status === s ? '' : 'secondary'}`}>{l}</Link>
        ))}
      </div>
      {none ? (
        <EmptyState icon="inbox" title="Inga leverantörsfakturor än" actions={[{ href: `${b}/leverantorsfakturor/ny`, label: 'Registrera en faktura' }, { href: `${b}/leverantorsfakturor/inkorg`, label: 'Öppna inkorgen', secondary: true }]}>
          {inboxAddr ? <>Mejla fakturorna till <b>{inboxAddr}</b> så läses de av automatiskt, eller registrera dem här.</> : 'Registrera fakturor du ska betala. När de är attesterade hamnar de i betalningsförslaget.'}
        </EmptyState>
      ) : <div className="table-wrap">
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
      </div>}
    </>
  );
}
