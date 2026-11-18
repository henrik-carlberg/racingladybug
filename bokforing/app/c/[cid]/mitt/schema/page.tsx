import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { addDays, today } from '@/lib/format';
import { fmtHours } from '@/lib/time';
import { listLog, listShifts, listSites } from '@/lib/services/staff';
import { selfStamp } from './actions';

export const dynamic = 'force-dynamic';

export default async function MySchedule({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { employee: true });
  const t = today();
  if (!ctx.employeeId) return <><h1>Mitt schema</h1><p className="muted">Ditt konto är inte kopplat till en anställd.</p></>;
  const [shifts, sites, [emp]] = await Promise.all([listShifts(ctx.company.id, t, addDays(t, 20), ctx.employeeId), listSites(ctx.company.id, true),
    sql<{ pnr: string }[]>`SELECT personal_number AS pnr FROM employees WHERE id = ${ctx.employeeId}`]);
  const open = (await listLog(ctx.company.id, { open: true })).filter((e) => e.personal_number === emp.pnr);
  return (
    <div style={{ maxWidth: 680 }}>
      <h1>Mitt schema</h1>
      <Flash searchParams={searchParams} />
      {sites.length > 0 && (
        <div className="card stack">
          <b>Personalliggare</b>
          {open.length > 0 && <div>Instämplad på {open.map((o) => `${o.site} sedan ${o.check_in.slice(11, 16)}`).join(', ')}</div>}
          <div className="actions" style={{ margin: 0 }}>{sites.map((s) => {
            const isIn = open.some((o) => o.site_id === s.id);
            return <form key={s.id} action={selfStamp.bind(null, ctx.company.id, s.id)}><button className={isIn ? 'secondary' : ''}>{isIn ? 'Stämpla ut' : 'Stämpla in'} – {s.name}</button></form>;
          })}</div>
        </div>
      )}
      <h2>Kommande pass</h2>
      <table><tbody>{shifts.map((s) => (
        <tr key={s.id}><td>{s.starts_at.slice(0, 10)}</td><td>{s.starts_at.slice(11, 16)}–{s.ends_at.slice(11, 16)}</td><td>{s.role}</td><td>{s.site}</td><td className="num">{fmtHours(s.minutes)}</td></tr>
      ))}{shifts.length === 0 && <tr><td className="muted">Inga inlagda pass de närmaste tre veckorna.</td></tr>}</tbody></table>
    </div>
  );
}
