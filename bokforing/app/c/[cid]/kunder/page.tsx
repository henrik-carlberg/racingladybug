import { customerBehaviors } from '@/lib/services/forecast';
import { translator } from '@/lib/ui-i18n';
import { uiLang } from '@/lib/server/lang';
import Link from 'next/link';
import { Pager, pageOf, pageSql, PAGE_SIZE } from '@/components/Pager';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP, EmptyState } from '@/components/ui';
import { CustomerFields, type CustomerRow } from '@/components/CustomerFields';
import { kr } from '@/lib/format';
import { saveCustomer } from './actions';

export const dynamic = 'force-dynamic';

export default async function Customers({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const L = translator(await uiLang());
  const sp = await searchParams;
  const page = pageOf(sp);
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const all = await sql<(CustomerRow & { open: number })[]>`
    SELECT c.*, COALESCE((SELECT SUM(total) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'booked'), 0)::bigint AS open
    FROM customers c WHERE c.company_id = ${company.id} ${q ? sql`AND (c.name ILIKE ${'%' + q + '%'} OR c.orgnr ILIKE ${'%' + q + '%'} OR c.email ILIKE ${'%' + q + '%'})` : sql``}
    ORDER BY c.name LIMIT ${pageSql(page).limit} OFFSET ${pageSql(page).offset}`;
  const hasMore = all.length > PAGE_SIZE;
  const rows = all.slice(0, PAGE_SIZE);
  const behaviors = await customerBehaviors(company.id);
  return (
    <>
      <h1>{L("Kunder")}</h1>
      <form className="row" style={{ alignItems: 'end', maxWidth: 520 }}><label>{L("Sök kund")}<input name="q" defaultValue={q} placeholder="Namn, org.nr eller e-post" /></label><div style={{ flex: '0 0 auto' }}><button className="secondary">{L("Sök")}</button></div></form>
      <Flash searchParams={searchParams} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>{L("Namn")}</th><th>{L("Org.nr")}</th><th>{L("E-post")}</th><th className="num">{L("Obetalt")}</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}><td><Link href={`/c/${company.id}/kunder/${c.id}`}>{c.name}</Link></td><td>{c.orgnr}</td><td>{c.email}</td><td className="num">{c.open ? kr(c.open) : ''}{(() => { const x = behaviors.get(c.id); return x && x.avgDelay > 5 ? <div className="small" style={{ color: 'var(--warn)' }} title={`Snitt för de ${x.count} senaste betalda fakturorna`}>Betalar i snitt {x.avgDelay} dagar sent</div> : null; })()}</td></tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4}><EmptyState icon="users" title={L('Inga kunder ännu')}>Lägg upp kunden i formuläret ovan, eller importera en lista från ditt gamla program under Inställningar → Import. Sedan kan du fakturera med några klick.</EmptyState></td></tr>}
          </tbody>
        </table>
        <Pager base={`/c/${company.id}/kunder`} sp={sp} page={page} hasMore={hasMore} count={rows.length} />
      </div>
      <h2>{L("Ny kund")}</h2>
      <form action={saveCustomer.bind(null, company.id, null)} className="card stack">
        <CustomerFields />
        <div><button>{L("Spara kund")}</button></div>
      </form>
    </>
  );
}
