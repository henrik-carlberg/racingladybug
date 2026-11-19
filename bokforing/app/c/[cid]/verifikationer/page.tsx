import { translator } from '@/lib/ui-i18n';
import { uiLang } from '@/lib/server/lang';
import Link from 'next/link';
import { Pager, pageOf, pageSql, PAGE_SIZE } from '@/components/Pager';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { fiscalYears } from '@/lib/server/ledger';
import { Header, type SP, EmptyState } from '@/components/ui';
import { kr } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Vouchers({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const L = translator(await uiLang());
  const sp = await searchParams;
  const years = await fiscalYears(company.id);
  const fy = years.find((y) => String(y.id) === sp.fy) ?? years[0];
  const q = String(sp.q ?? '');
  const page = pageOf(sp);
  const rows = fy ? await sql<{ id: number; series: string; number: number; date: string; description: string; amount: number; source_type: string; corrects_id: number | null; files: number }[]>`
    SELECT v.id, v.series, v.number, to_char(v.date,'YYYY-MM-DD') AS date, v.description, v.source_type, v.corrects_id,
      (SELECT SUM(debit) FROM voucher_lines WHERE voucher_id = v.id)::bigint AS amount,
      (SELECT count(*) FROM attachments WHERE voucher_id = v.id)::int AS files
    FROM vouchers v WHERE v.company_id = ${company.id} AND v.fiscal_year_id = ${fy.id}
      ${q ? sql`AND (v.description ILIKE ${'%' + q + '%'} OR v.number::text = ${q})` : sql``}
    ORDER BY v.series, v.number DESC LIMIT ${pageSql(page).limit} OFFSET ${pageSql(page).offset}` : [];
  const hasMore = rows.length > PAGE_SIZE;
  const shown = rows.slice(0, PAGE_SIZE);
  const b = `/c/${company.id}`;
  return (
    <>
      <Header title={L('Verifikationer')}><Link className="btn" href={`${b}/verifikationer/ny`}>{L("Ny verifikation")}</Link></Header>
      <form className="row card">
        <label>Räkenskapsår
          <select name="fy" defaultValue={fy?.id}>{years.map((y) => <option key={y.id} value={y.id}>{y.start_date} – {y.end_date}</option>)}</select>
        </label>
        <label>{L("Sök")}<input name="q" defaultValue={q} placeholder="Text eller nummer" /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">{L("Visa")}</button></div>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{L("Nr")}</th><th>{L("Datum")}</th><th>{L("Beskrivning")}</th><th className="num">{L("Belopp")}</th><th></th></tr></thead>
          <tbody>
            {shown.map((v) => (
              <tr key={v.id}>
                <td><Link href={`${b}/verifikationer/${v.id}`}>{v.series}{v.number}</Link></td>
                <td>{v.date}</td>
                <td>{v.description} {v.source_type === 'reversal' && <span className="badge danger">{L("Rättelse")}</span>}</td>
                <td className="num">{kr(v.amount)}</td>
                <td className="small muted">{v.files > 0 ? `📎 ${v.files}` : ''}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5}><EmptyState icon="ledger" title={L('Inga verifikationer')} actions={[{ href: `${b}/kvitto`, label: 'Bokför ett kvitto' }, { href: `${b}/verifikationer/ny`, label: 'Ny verifikation', secondary: true }]}>Det mesta bokförs automatiskt när du fakturerar, registrerar leverantörsfakturor och stämmer av banken. Här ser du allt som har bokförts.</EmptyState></td></tr>}
          </tbody>
        </table>
      </div>
      <Pager base={`${b}/verifikationer`} sp={sp} page={page} hasMore={hasMore} count={shown.length} />
    </>
  );
}
