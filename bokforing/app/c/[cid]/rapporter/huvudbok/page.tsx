import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { fiscalYears, openingBalances } from '@/lib/server/ledger';
import { type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Ledger({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const sp = await searchParams;
  const years = await fiscalYears(company.id);
  const fy = years.find((y) => y.start_date <= today() && today() <= y.end_date) ?? years[0];
  const isoDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
  const from = isoDate(sp.from) ?? fy?.start_date ?? today();
  const to = isoDate(sp.to) ?? fy?.end_date ?? today();
  const accFilter = String(sp.account ?? '');
  const rows = await sql<{ account_number: number; voucher_id: number; label: string; date: string; text: string; debit: number; credit: number }[]>`
    SELECT l.account_number, v.id AS voucher_id, v.series || v.number AS label, to_char(v.date,'YYYY-MM-DD') AS date,
      COALESCE(NULLIF(l.description,''), v.description) AS text, l.debit, l.credit
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${company.id} AND v.date BETWEEN ${from} AND ${to}
      AND v.source_type IS DISTINCT FROM 'opening_balance'
      ${accFilter ? sql`AND l.account_number = ${Number(accFilter)}` : sql``}
    ORDER BY l.account_number, v.date, v.series, v.number, l.id LIMIT 5001`;
  const truncated = rows.length > 5000;
  if (truncated) rows.pop();
  const names = new Map((await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${company.id}`).map((a) => [a.number, a.name]));
  // Ingående saldo: balanskonton från tidigare perioder, resultatkonton från räkenskapsårets början
  const ibBal = await openingBalances(company.id, from);
  const fyStart = years.find((y) => y.start_date <= from && from <= y.end_date)?.start_date ?? from;
  const ibRes = new Map((await sql<{ account_number: number; b: number }[]>`
    SELECT l.account_number, SUM(l.debit - l.credit)::bigint AS b FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${company.id} AND v.date >= ${fyStart} AND v.date < ${from} AND l.account_number >= 3000
      AND v.source_type IS DISTINCT FROM 'opening_balance' GROUP BY 1`).map((r) => [r.account_number, r.b]));
  const groups = new Map<number, (typeof rows)[number][]>();
  for (const r of rows) (groups.get(r.account_number) ?? groups.set(r.account_number, []).get(r.account_number)!).push(r);
  const b = `/c/${company.id}`;
  return (
    <>
      <h1>Huvudbok</h1>
      {truncated && <div className="card small" style={{ borderColor: 'var(--warn)' }}>Huvudboken visar de första 5 000 raderna. Välj ett konto eller en kortare period för att se resten.</div>}
      <form className="card row">
        <label>Från<input type="date" name="from" defaultValue={from} /></label>
        <label>Till<input type="date" name="to" defaultValue={to} /></label>
        <label>Konto (valfritt)<input name="account" defaultValue={accFilter} inputMode="numeric" /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Visa</button></div>
      </form>
      {[...groups].map(([acc, list]) => {
        let bal = (acc < 3000 ? ibBal.get(acc) : ibRes.get(acc)) ?? 0;
        return (
          <div key={acc} style={{ marginBottom: '1.5rem' }}>
            <h2>{acc} {names.get(acc)}</h2>
            <table>
              <thead><tr><th>Ver</th><th>Datum</th><th>Text</th><th className="num">Debet</th><th className="num">Kredit</th><th className="num">Saldo</th></tr></thead>
              <tbody>
                <tr><td colSpan={5} className="muted">Ingående saldo</td><td className="num">{kr(bal)}</td></tr>
                {list.map((r, i) => {
                  bal += r.debit - r.credit;
                  return (
                    <tr key={i}>
                      <td><Link href={`${b}/verifikationer/${r.voucher_id}`}>{r.label}</Link></td><td>{r.date}</td><td>{r.text}</td>
                      <td className="num">{r.debit ? kr(r.debit) : ''}</td><td className="num">{r.credit ? kr(r.credit) : ''}</td><td className="num">{kr(bal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      {groups.size === 0 && <p className="muted">Inga transaktioner i perioden.</p>}
    </>
  );
}
