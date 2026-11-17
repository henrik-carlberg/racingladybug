import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today, addDays } from '@/lib/format';
import { fmtHours, weekStart } from '@/lib/time';
import { isModuleEnabled } from '@/lib/modules/enabled';

export const dynamic = 'force-dynamic';

export default async function MyPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company, user, employeeId } = await requireCompany(cid, { employee: true });
  const b = `/c/${company.id}`;
  const week = weekStart(today());
  const [[time], slips, utlagg] = await Promise.all([
    sql<{ minutes: number }[]>`SELECT COALESCE(SUM(minutes), 0)::int AS minutes FROM time_entries WHERE company_id = ${company.id} AND user_id = ${user.id} AND date BETWEEN ${week} AND ${addDays(week, 6)}`,
    employeeId ? sql<{ id: number; period: string; net_pay: number }[]>`SELECT p.id, r.period, p.net_pay::bigint AS net_pay FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
      WHERE p.employee_id = ${employeeId} AND r.status = 'booked' ORDER BY r.period DESC LIMIT 3` : Promise.resolve([]),
    isModuleEnabled(company.id, 'utlagg'),
  ]);
  const claims = utlagg && employeeId ? await sql<{ id: number; title: string; status: string }[]>`SELECT id, title, status FROM exp_claims WHERE employee_id = ${employeeId} AND status IN ('draft', 'submitted', 'rejected', 'approved') ORDER BY id DESC LIMIT 5` : [];
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Hej {user.name.split(' ')[0]}!</h1>
      <Flash searchParams={searchParams} />
      {!employeeId && <div className="flash error">Ditt konto är inte kopplat till en anställd. Be ägaren att bjuda in dig som anställd.</div>}
      <div className="grid">
        <Link href={`${b}/tid`} className="card" style={{ display: 'block', margin: 0, color: 'var(--text)' }}>
          <div style={{ fontSize: '1.4rem' }}>⏱</div><b>Tidrapport</b><div className="small muted">{fmtHours(time.minutes)} denna vecka</div>
        </Link>
        {utlagg && <Link href={`${b}/m/utlagg`} className="card" style={{ display: 'block', margin: 0, color: 'var(--text)' }}>
          <div style={{ fontSize: '1.4rem' }}>🧾</div><b>Utlägg och resor</b><div className="small muted">{claims.length ? `${claims.length} pågående` : 'Kvitton, milersättning, traktamente'}</div>
        </Link>}
        <Link href={`${b}/mitt/lon`} className="card" style={{ display: 'block', margin: 0, color: 'var(--text)' }}>
          <div style={{ fontSize: '1.4rem' }}>💰</div><b>Lönespecifikationer</b><div className="small muted">{slips[0] ? `Senast ${slips[0].period}: ${kr(Number(slips[0].net_pay))} kr` : 'Inga ännu'}</div>
        </Link>
      </div>
      {claims.length > 0 && (<>
        <h2>Mina utlägg</h2>
        <table><tbody>{claims.map((c) => <tr key={c.id}><td><Link href={`${b}/m/utlagg/r/${c.id}`}>{c.title}</Link></td><td className="small">{({ draft: 'Utkast', submitted: 'Väntar på attest', rejected: 'Avslagen', approved: 'Attesterad – betalas ut' } as Record<string, string>)[c.status]}</td></tr>)}</tbody></table>
      </>)}
    </div>
  );
}
