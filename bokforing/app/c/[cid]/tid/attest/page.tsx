import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { today } from '@/lib/format';
import { fmtHours } from '@/lib/time';
import { HOUR_FIELDS } from '@/lib/payroll-agreements';
import { draftRuns, overview } from '@/lib/services/time-flow';
import { approval, approve, reopen, toPayroll } from './actions';

export const dynamic = 'force-dynamic';

export default async function TimeApproval({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(cid, { perm: 'payroll' });
  const c = ctx.company;
  const t = today();
  const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const from = iso(sp.from) ?? `${t.slice(0, 7)}-01`, to = iso(sp.to) ?? t;
  const o = await overview(c.id, from, to);
  const runs = await draftRuns(c.id);
  const label = Object.fromEntries(HOUR_FIELDS) as Record<string, string>;
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Attest av tid – till lön och faktura</h1>
      <p className="muted">Tidrapporterna attesteras per person och period. Attesterad tid förs till lönekörningen, där pass med klockslag delas upp i OB (kväll 18–22, natt 22–06, helg och storhelg), tid över 8 timmar per dag blir enkel övertid och restid ersätts enligt den anställdas kollektivavtal. Samma tid faktureras kunden via uppdraget.</p>
      <Flash searchParams={searchParams} />
      {ctx.role === 'owner' && <form action={approval.bind(null, c.id, !o.approval)} className="card row"><span className="small">{o.approval ? 'Attest krävs innan tid faktureras.' : 'Tid kan faktureras utan attest.'}</span><button className="secondary small">{o.approval ? 'Kräv inte attest för fakturering' : 'Kräv attest innan fakturering'}</button></form>}
      <form method="get" className="row"><label>Från<input type="date" name="from" defaultValue={from} /></label><label>Till<input type="date" name="to" defaultValue={to} /></label><button className="secondary">Visa</button></form>
      <div className="table-wrap"><table className="time-people">
        <thead><tr><th>Person</th><th className="num">Att attestera</th><th className="num">Attesterat</th><th className="num">Förd till lön</th><th>OB, övertid och restid (ej överfört)</th><th></th></tr></thead>
        <tbody>{o.people.map((p) => (
          <tr key={p.user_id} className="time-person">
            <td><b>{p.name}</b>{!p.employee_id && <div className="small muted">Inte kopplad till en anställd</div>}</td>
            <td className="num open">{fmtHours(p.open)}</td><td className="num approved">{fmtHours(p.approved)}</td><td className="num">{fmtHours(p.transferred)}</td>
            <td className="small hours">{Object.entries(p.hours).filter(([k, v]) => k !== 'worked' && v).map(([k, v]) => `${label[k] ?? k} ${String(v).replace('.', ',')} h`).join(' · ') || '–'}</td>
            <td className="row">
              {p.open_count > 0 && <form action={approve.bind(null, c.id)}><input type="hidden" name="user_id" value={p.user_id} /><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} /><button className="secondary small">Attestera</button></form>}
              {p.approved > 0 && <form action={reopen.bind(null, c.id)}><input type="hidden" name="user_id" value={p.user_id} /><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} /><button className="link small">Öppna igen</button></form>}
            </td>
          </tr>))}</tbody>
      </table></div>
      <h2>Till lönekörningen</h2>
      {runs.length === 0 ? <p className="small">Skapa en lönekörning under <Link href={`/c/${c.id}/lon`}>Lön</Link> först.</p> : (
        <form action={toPayroll.bind(null, c.id)} className="card row"><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
          <label>Lönekörning<select name="run_id">{runs.map((r) => <option key={r.id} value={r.id}>{r.period}</option>)}</select></label>
          <button>För attesterad tid till lönespecarna</button>
          <span className="small muted">Tid i lönekörningens månad. Timmarna läggs till de OB- och övertidstimmar som redan står på lönespecen.</span></form>)}
    </div>
  );
}
