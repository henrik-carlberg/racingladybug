import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { importTables } from './actions';

export const dynamic = 'force-dynamic';

export default async function TaxTables({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const rows = await sql<{ year: number; table_no: number; n: number }[]>`
    SELECT year, table_no, count(*)::int AS n FROM tax_table_rows GROUP BY year, table_no ORDER BY year DESC, table_no`;
  const needed = await sql<{ tax_table: number }[]>`
    SELECT DISTINCT tax_table FROM employees WHERE company_id = ${company.id} AND active AND tax_mode = 'table' AND tax_table IS NOT NULL ORDER BY 1`;
  const year = new Date().getFullYear();
  return (
    <>
      <h1>Skattetabeller</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Skattetabellerna för månadslön hämtas direkt från Skatteverkets öppna data. De delas av alla bolag i appen. Hämta nya tabeller inför varje år (publiceras i december).</p>
      <form action={importTables.bind(null, company.id)} className="card row">
        <label style={{ flex: '0 0 120px' }}>År<input name="year" type="number" defaultValue={year} required /></label>
        <label>Tabeller<input name="tables" defaultValue={needed.map((n) => n.tax_table).join(', ') || '32'} placeholder="t.ex. 32 eller 29-42" required /></label>
        <div style={{ flex: '0 0 auto' }}><button>Hämta från Skatteverket</button></div>
      </form>
      {needed.length > 0 && <p className="small muted">Era anställda använder tabell {needed.map((n) => n.tax_table).join(', ')}.</p>}
      <table>
        <thead><tr><th>År</th><th>Tabell</th><th className="num">Rader</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={`${r.year}-${r.table_no}`}><td>{r.year}</td><td>{r.table_no}</td><td className="num">{r.n}</td></tr>)}
          {rows.length === 0 && <tr><td colSpan={3} className="muted">Inga tabeller hämtade ännu.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
