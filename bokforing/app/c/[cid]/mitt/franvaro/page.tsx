import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { AbsenceForm } from '@/components/AbsenceForm';
import { today } from '@/lib/format';
import { listAbsences, vacationBalances } from '@/lib/services/absence';
import { remove } from '../../lon/franvaro/actions';

export const dynamic = 'force-dynamic';
const STATUS: Record<string, [string, string]> = { requested: ['Väntar på svar', 'warn'], approved: ['Godkänd', 'ok'], rejected: ['Avslagen', 'danger'] };

export default async function MyAbsence({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company, employeeId } = await requireCompany(cid, { employee: true });
  const year = Number(today().slice(0, 4));
  const [list, balances] = employeeId ? await Promise.all([listAbsences(company.id, { employee_id: employeeId }), vacationBalances(company.id, year)]) : [[], []];
  const me = balances.find((x) => x.id === employeeId);
  const back = `/c/${company.id}/mitt/franvaro`;
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Frånvaro och semester</h1>
      <Flash searchParams={searchParams} />
      {!employeeId ? <p>Ditt konto är inte kopplat till en anställd.</p> : (<>
        {me && <div className="grid"><div className="card stat"><div className="label">Semesterdagar kvar {year}</div><div className="value">{me.left}</div><div className="small muted">av {me.vacation_days}, varav {me.planned} planerade</div></div></div>}
        <h2>Sjukanmälan, VAB eller ledighet</h2>
        <AbsenceForm companyId={company.id} back={back} self />
        <h2>Min frånvaro</h2>
        <table><tbody>{list.map((a) => (
          <tr key={a.id}><td>{a.kind_label}</td><td>{a.from} – {a.to}{a.extent < 100 ? ` (${a.extent} %)` : ''}</td><td><span className={`badge ${STATUS[a.status][1]}`}>{STATUS[a.status][0]}</span></td>
            <td className="num">{a.status === 'requested' && <form action={remove.bind(null, company.id, a.id, back)}><button className="link">Återta</button></form>}</td></tr>
        ))}{list.length === 0 && <tr><td className="muted">Ingen frånvaro.</td></tr>}</tbody></table>
      </>)}
    </div>
  );
}
