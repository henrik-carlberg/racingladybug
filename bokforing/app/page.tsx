import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireUser } from '@/lib/server/auth';
import { createCompany } from './company-actions';
import { logout } from './auth-actions';
import { Flash, type SP } from '@/components/ui';
import { ROLE_LABEL } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const companies = await sql<{ id: number; name: string; orgnr: string; role: 'owner' | 'accountant' }[]>`
    SELECT c.id, c.name, c.orgnr, m.role FROM companies c JOIN memberships m ON m.company_id = c.id
    WHERE m.user_id = ${user.id} ORDER BY c.name`;
  const year = new Date().getFullYear();
  return (
    <div className="center" style={{ maxWidth: 720 }}>
      <div className="header">
        <h1>Mina bolag</h1>
        <form action={logout}><button className="secondary">Logga ut ({user.name})</button></form>
      </div>
      <Flash searchParams={searchParams} />
      {companies.length > 0 && (
        <table>
          <thead><tr><th>Bolag</th><th>Org.nr</th><th>Roll</th></tr></thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id}><td><Link href={`/c/${c.id}`}>{c.name}</Link></td><td>{c.orgnr}</td><td>{ROLE_LABEL[c.role]}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Lägg upp nytt bolag</h2>
      <form action={createCompany} className="card stack">
        <label>Företagsnamn<input name="name" required /></label>
        <div className="row">
          <label>Bolagsform
            <select name="company_type"><option value="AB">Aktiebolag</option><option value="EF">Enskild firma</option></select>
          </label>
          <label>Org.nr (AB) / personnummer (EF)<input name="orgnr" required placeholder="556677-8899" /></label>
        </div>
        <div className="row">
          <label>Räkenskapsåret börjar<input name="fy_start" type="date" defaultValue={`${year}-01-01`} required /></label>
          <label>Momsredovisning
            <select name="vat_period" defaultValue="quarter">
              <option value="month">Månad</option><option value="quarter">Kvartal</option><option value="year">År</option>
            </select>
          </label>
        </div>
        <button>Skapa bolag</button>
      </form>
    </div>
  );
}
