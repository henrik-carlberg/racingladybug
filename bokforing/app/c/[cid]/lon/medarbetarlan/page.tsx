import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { benefitRate } from '@/lib/employee-loans';
import { overview } from '@/lib/services/employee-loans';
import { addLoan, applyToRun } from './actions';

export const dynamic = 'force-dynamic';

/** Lån till anställda med amortering på nettolönen och ränteförmån */
export default async function EmployeeLoans({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const o = await overview(company.id);
  const year = Number(today().slice(0, 4));
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Medarbetarlån</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Lån till anställda bokförs som fordran (1610). Amortering och avtalad ränta dras på nettolönen. Är räntan lägre än förmånsräntan,
        statslåneräntan plus en procentenhet ({benefitRate(year)} % för {year}), blir skillnaden en skattepliktig ränteförmån som redovisas på lönespecen och i AGI.
        Lån till ägare och närstående i fåmansföretag omfattas av låneförbudet, se Lån till ägare.</p>
      <table className="el-list"><thead><tr><th>Anställd</th><th>Utbetalt</th><th className="num">Lånebelopp</th><th className="num">Ränta</th><th className="num">Amortering/mån</th><th className="num">Saldo</th><th /></tr></thead>
        <tbody>{o.loans.map((l) => (
          <tr key={l.id} className="el-row" data-name={l.name}><td>{l.name}</td><td>{l.loan_date}</td><td className="num">{kr(l.principal)}</td><td className="num">{l.agreed_rate} %</td>
            <td className="num">{kr(l.installment)}</td><td className="num el-balance">{kr(l.balance)}</td>
            <td>{(() => { const runs = o.runs.filter((r) => !l.applied.includes(r.id)); return l.balance > l.pending && runs.length > 0 && <form action={applyToRun.bind(null, company.id, l.id)} className="row" style={{ gap: '.25rem' }}>
              <select name="run_id">{runs.map((r) => <option key={r.id} value={r.id}>{r.period}</option>)}</select><button className="secondary">Dra på lönen</button></form>; })()}</td></tr>
        ))}</tbody></table>
      <form action={addLoan.bind(null, company.id)} className="card row" style={{ marginTop: '1rem' }}>
        <label>Anställd<select name="employee_id" required>{o.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label>Lånebelopp (kr)<input name="principal" required style={{ width: '8rem' }} /></label>
        <label>Avtalad ränta %<input name="agreed_rate" defaultValue="0" style={{ width: '5rem' }} /></label>
        <label>Amortering per månad (kr)<input name="installment" required style={{ width: '8rem' }} /></label>
        <label>Utbetalningsdag<input type="date" name="loan_date" defaultValue={today()} /></label>
        <div style={{ flex: '0 0 auto' }}><button>Bokför lånet</button></div>
      </form>
    </div>
  );
}
