import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { companyFirms } from '@/lib/services/firms';
import { grant, revoke } from './actions';

export const dynamic = 'force-dynamic';

export default async function FirmAccess({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company, role } = await requireCompany(cid);
  const firms = await companyFirms(company.id);
  const owner = role === 'owner';
  return (
    <div style={{ maxWidth: 760 }}>
      <h1>Redovisningsbyrå</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Ge din redovisningsbyrå åtkomst med byråns kod. Byråns konsulter kan då bokföra, stämma av och ställa frågor till dig som redovisningskonsulter, men inte ändra abonnemang, användare eller bolagets inställningar för betalningar.
        Du kan ta bort åtkomsten när som helst.</p>
      {owner && (
        <form action={grant.bind(null, company.id)} className="card row" style={{ alignItems: 'end' }}>
          <label>Byråns kod<input name="code" required placeholder="T.ex. K7Q2M9XA" autoComplete="off" /></label>
          <div style={{ flex: '0 0 auto' }}><button>Ge åtkomst</button></div>
        </form>
      )}
      <h2>Byråer med åtkomst</h2>
      <table><tbody>
        {firms.map((f) => (
          <tr key={f.id}><td><b>{f.name}</b><div className="small muted">{f.orgnr}</div></td><td className="small">Sedan {f.since} · {f.members} konsulter</td>
            <td className="num">{owner && <form action={revoke.bind(null, company.id, f.id)}><button className="link">Ta bort åtkomst</button></form>}</td></tr>
        ))}
        {firms.length === 0 && <tr><td className="muted">Ingen byrå har åtkomst.</td></tr>}
      </tbody></table>
    </div>
  );
}
