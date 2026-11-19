import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP, EmptyState } from '@/components/ui';
import { EmployeeFields, type EmployeeRow } from '@/components/EmployeeFields';
import { kr } from '@/lib/format';
import { saveEmployee } from './actions';

export const dynamic = 'force-dynamic';

export default async function Employees({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const rows = await sql<EmployeeRow[]>`SELECT * FROM employees WHERE company_id = ${company.id} ORDER BY active DESC, last_name, first_name`;
  return (
    <>
      <h1>Anställda</h1>
      <Flash searchParams={searchParams} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Namn</th><th>Personnummer</th><th className="num">Månadslön</th><th>Skatt</th><th></th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} style={e.active ? undefined : { opacity: 0.5 }}>
                <td><Link href={`/c/${company.id}/lon/anstallda/${e.id}`}>{e.first_name} {e.last_name}</Link></td>
                <td>{e.personal_number.slice(0, 8)}-{e.personal_number.slice(8)}</td>
                <td className="num">{kr(e.monthly_salary)}</td>
                <td>{e.tax_mode === 'table' ? `Tabell ${e.tax_table}, kol ${e.tax_column}` : `${e.tax_percent} %`}</td>
                <td>{!e.active && <span className="badge">Inaktiv</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5}><EmptyState icon="users" title="Inga anställda ännu">Lägg upp den första anställda med personnummer, lön och skattetabell. Du kan också bjuda in personen så att den själv ser sina lönespecar och rapporterar frånvaro.</EmptyState></td></tr>}
          </tbody>
        </table>
      </div>
      <h2>Ny anställd</h2>
      <form action={saveEmployee.bind(null, company.id, null)} className="card stack">
        <EmployeeFields />
        <div><button>Spara</button></div>
      </form>
    </>
  );
}
