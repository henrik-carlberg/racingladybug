import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/terminations';
import { accrueAction, endAction, terminateAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function Terminations({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const id = company.id;
  const o = await overview(id);
  const t = today();
  return (
    <div style={{ maxWidth: 1050 }}>
      <h1>Uppsägning och avgångsvederlag</h1>
      <p className="small"><Link href={`/c/${id}/lon`}>← Lön</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">Uppsägningstiden räknas enligt LAS: en månad när den anställda säger upp sig, och 1–6 månader efter anställningstid när arbetsgivaren säger upp (längre tid enligt kollektivavtal kan anges).
        Lön under uppsägningstiden och slutlön med semesterersättning betalas i lönekörningarna. Avgångsvederlag är ett engångsbelopp med skatteavdrag enligt tabellen för engångsbelopp och full arbetsgivaravgift.
        Är den anställda arbetsbefriad, eller finns ett avgångsvederlag, kan skulden bokföras när beslutet fattas (7210/7510 mot 2910/2940) och lösas upp när anställningen avslutas.</p>
      <table className="tm-list"><thead><tr><th>Anställd</th><th>Uppsagd</th><th>Uppsägningstid</th><th>Sista dag</th><th className="num">Avgångsvederlag</th><th className="num">Skuld att reservera</th><th>Status</th><th></th></tr></thead>
        <tbody>{o.terminations.map((x) => (
          <tr key={x.id} className="tm-row" data-name={x.name}><td>{x.name}<div className="small muted">{kr(x.monthly_salary)} kr/mån</div></td><td className="small">{x.notice_date}<div>{x.initiated_by === 'employer' ? 'av arbetsgivaren' : 'av den anställda'}</div></td>
            <td className="tm-months">{x.notice_months} mån{x.garden_leave ? ' (arbetsbefriad)' : ''}</td><td className="tm-last">{x.last_day}</td>
            <td className="num small">{x.severance ? <>{kr(x.severance)} kr<div>skatt {kr(x.severanceCalc.tax)}, netto <span className="tm-net">{kr(x.severanceCalc.net)}</span></div><div>avgift {kr(x.severanceCalc.fee)} ({x.feeRate.toLocaleString('sv-SE')} %)</div></> : '–'}</td>
            <td className="num tm-obligation">{kr(x.obligation.total)}{x.accrued > 0 && <div className="small">bokförd</div>}</td>
            <td className="small">{x.status === 'ended' ? 'Avslutad' : 'Under uppsägning'}</td>
            <td>{x.status === 'notice' && <div className="stack" style={{ gap: '.25rem' }}>
              {!x.accrued && x.obligation.total > 0 && <form action={accrueAction.bind(null, id, x.id)}><input type="hidden" name="date" value={t} /><button className="link">Bokför skuld</button></form>}
              <form action={endAction.bind(null, id, x.id)}><button className="link">Avsluta anställningen</button></form></div>}</td></tr>))}
          {!o.terminations.length && <tr><td colSpan={8} className="muted">Inga uppsägningar.</td></tr>}</tbody></table>
      {o.employees.length > 0 && <><h2>Ny uppsägning</h2>
        <form action={terminateAction.bind(null, id)} className="card row">
          <label>Anställd<select name="employee_id">{o.employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.employment_start ? ` (anställd ${e.employment_start})` : ''}</option>)}</select></label>
          <label>Uppsagd av<select name="initiated_by"><option value="employer">Arbetsgivaren</option><option value="employee">Den anställda</option></select></label>
          <label>Uppsägningsdag<input type="date" name="notice_date" defaultValue={t} /></label>
          <label>Uppsägningstid (mån, tomt = enligt LAS)<input name="notice_months" inputMode="numeric" style={{ width: '5rem' }} /></label>
          <label className="row"><input type="checkbox" name="garden_leave" /> Arbetsbefriad</label>
          <label>Avgångsvederlag (kr)<input name="severance" inputMode="decimal" style={{ width: '8rem' }} /></label>
          <label>Skatt på engångsbelopp %<input name="severance_tax_pct" defaultValue="30" style={{ width: '4rem' }} /></label>
          <button>Registrera uppsägning</button>
        </form></>}
    </div>
  );
}
