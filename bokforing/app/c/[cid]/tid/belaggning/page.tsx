import { requireCompany } from '@/lib/server/auth';
import { type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { fmtHours } from '@/lib/time';
import { lastDay, periodOf } from '@/lib/assets';
import { utilization } from '@/lib/services/time';

export const dynamic = 'force-dynamic';

export default async function Utilization({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const sp = await searchParams;
  const t = today();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(sp.from)) ? String(sp.from) : `${periodOf(t)}-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(sp.to)) ? String(sp.to) : lastDay(periodOf(t));
  const rows = await utilization(company.id, from, to);
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  return (
    <div>
      <h1>Beläggning</h1>
      <form className="card row" style={{ alignItems: 'end' }}>
        <label>Från<input type="date" name="from" defaultValue={from} /></label>
        <label>Till<input type="date" name="to" defaultValue={to} /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Visa</button></div>
      </form>
      <p className="small muted">Beläggningsgrad = debiterbar tid i procent av tillgänglig tid (arbetstid per vecka enligt anställningen, annars 40 timmar, för vardagarna i perioden). Värdet är debiterbar tid × timpris.</p>
      <div className="table-wrap"><table className="utilization">
        <thead><tr><th>Person</th><th className="num">Rapporterat</th><th className="num">Debiterbart</th><th className="num">Tillgängligt</th><th className="num">Beläggning</th><th className="num">Värde</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.user_id}><td>{r.name}</td><td className="num">{fmtHours(r.total)}</td><td className="num">{fmtHours(r.billable)}</td><td className="num">{fmtHours(r.available)}</td>
              <td className="num">{r.utilization == null ? '–' : `${r.utilization.toLocaleString('sv-SE')} %`}</td><td className="num">{kr(r.value)}</td></tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="muted">Ingen rapporterad tid i perioden.</td></tr>}
          {rows.length > 1 && <tr className="sum"><td>Summa</td><td className="num">{fmtHours(sum((r) => r.total))}</td><td className="num">{fmtHours(sum((r) => r.billable))}</td><td className="num">{fmtHours(sum((r) => r.available))}</td>
            <td className="num">{sum((r) => r.available) ? `${(Math.round((sum((r) => r.billable) / sum((r) => r.available)) * 1000) / 10).toLocaleString('sv-SE')} %` : '–'}</td><td className="num">{kr(sum((r) => r.value))}</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
