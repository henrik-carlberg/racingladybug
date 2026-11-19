import { Help } from '@/components/Help';
import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { listCostCenters } from '@/lib/services/dimensions';
import { create, update } from './actions';

export const dynamic = 'force-dynamic';

export default async function CostCenters({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const list = await listCostCenters(company.id);
  return (
    <div style={{ maxWidth: 760 }}>
      <h1>Kostnadsställen <Help term="kostnadsstalle" /></h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Kostnadsställen (t.ex. avdelning, butik eller verksamhetsgren) och projekt kan anges på varje verifikationsrad. Projekten är bolagets <Link href={`/c/${company.id}/uppdrag`}>uppdrag</Link>.
        Se resultatet per kostnadsställe eller projekt under <Link href={`/c/${company.id}/rapporter/dimensioner`}>Resultat per dimension</Link>. De följer med i SIE-exporten.</p>
      <form action={create.bind(null, company.id)} className="card row" style={{ alignItems: 'end' }}>
        <label style={{ flex: '0 0 140px' }}>Kod<input name="code" required placeholder="T.ex. 10" /></label>
        <label>Namn<input name="name" required placeholder="T.ex. Butiken Göteborg" /></label>
        <div style={{ flex: '0 0 auto' }}><button>Lägg till</button></div>
      </form>
      <table><tbody>
        {list.map((c) => (
          <tr key={c.id}><td><b>{c.code}</b></td>
            <td><form action={update.bind(null, company.id, c.id)} className="row" style={{ alignItems: 'center' }}>
              <input name="name" defaultValue={c.name} aria-label="Namn" />
              <label className="check" style={{ flex: '0 0 auto' }}><input type="checkbox" name="active" defaultChecked={c.active} /> Aktivt</label>
              <button className="link" style={{ flex: '0 0 auto' }}>Spara</button>
            </form></td></tr>
        ))}
        {list.length === 0 && <tr><td className="muted">Inga kostnadsställen ännu.</td></tr>}
      </tbody></table>
    </div>
  );
}
