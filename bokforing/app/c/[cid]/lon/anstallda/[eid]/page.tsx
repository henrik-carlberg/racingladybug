import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { EmployeeFields, type EmployeeRow } from '@/components/EmployeeFields';
import { saveEmployee } from '../actions';

export const dynamic = 'force-dynamic';

export default async function Employee({ params, searchParams }: { params: Promise<{ cid: string; eid: string }>; searchParams: SP }) {
  const { cid, eid } = await params;
  const { company } = await requireCompany(cid);
  const [e] = await sql<EmployeeRow[]>`
    SELECT *, to_char(employment_start,'YYYY-MM-DD') AS employment_start, to_char(employment_end,'YYYY-MM-DD') AS employment_end
    FROM employees WHERE id = ${Number(eid)} AND company_id = ${company.id}`;
  if (!e) notFound();
  return (
    <>
      <h1>{e.first_name} {e.last_name}</h1>
      <p className="small"><Link href={`/c/${company.id}/lon/anstallda/${e.id}/intyg`}>Underlag för arbetsgivarintyg</Link></p>
      <Flash searchParams={searchParams} />
      <form action={saveEmployee.bind(null, company.id, e.id)} className="card stack">
        <EmployeeFields e={e} />
        <div><button>Spara</button></div>
      </form>
    </>
  );
}
