import { requireCompany } from '@/lib/server/auth';
import { Flash, EmptyState, type SP } from '@/components/ui';
import { mailConfigured } from '@/lib/server/mail';
import { listSchedules } from '@/lib/services/report-schedules';
import { create, remove, sendNow } from './actions';

export const dynamic = 'force-dynamic';
const CMP: Record<string, string> = { none: 'utan jämförelse', fjol: 'jämfört med förra året', budget: 'jämfört med budget' };

export default async function Schedules({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const list = await listSchedules(company.id);
  const b = `/c/${company.id}`;
  return (
    <div style={{ maxWidth: 860 }}>
      <h1>Schemalagda rapporter</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Resultat- och balansräkningen till och med förra månadens slut skickas som Excel till ägare, bank eller styrelse en bestämd dag varje månad, med omsättning, resultat och kassa i mejlet.</p>
      {!mailConfigured() && <div className="check-item warn">E-post är inte uppsatt på servern, så inget skickas ännu. Du kan ladda ner rapporten här under tiden.</div>}
      {list.length === 0 ? <EmptyState icon="calendar" title="Inga utskick än">Lägg till mottagare och vilken dag i månaden rapporten ska skickas.</EmptyState> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Mottagare</th><th>Dag</th><th>Innehåll</th><th>Senast skickad</th><th></th></tr></thead>
          <tbody>{list.map((s) => (
            <tr key={s.id}><td>{s.recipients.join(', ')}</td><td>den {s.day}:e</td><td className="small">Resultat och balans {CMP[s.compare]}</td><td>{s.last_sent ?? '–'}</td>
              <td className="num"><form action={sendNow.bind(null, company.id, s.id)} style={{ display: 'inline' }}><button className="link small">Skicka nu</button></form>
                <form action={remove.bind(null, company.id, s.id)} style={{ display: 'inline', marginLeft: 8 }}><button className="link small">Ta bort</button></form></td></tr>
          ))}</tbody>
        </table></div>
      )}
      <form action={create.bind(null, company.id)} className="card stack">
        <b>Nytt utskick</b>
        <label>Mottagare (e-post, högst fem)<input name="recipients" required placeholder="styrelsen@exempel.se, banken@exempel.se" /></label>
        <div className="row">
          <label style={{ flex: '0 0 140px' }}>Dag i månaden<input name="day" type="number" min={1} max={28} defaultValue={5} required /></label>
          <label>Jämförelse<select name="compare" defaultValue="fjol"><option value="fjol">Samma period förra året</option><option value="budget">Budget</option><option value="none">Ingen</option></select></label>
        </div>
        <div><button className="secondary">Spara utskick</button></div>
      </form>
      <p className="small"><a href={`${b}/rapporter/xlsx?r=rrbr&jmf=fjol`} download>Ladda ner resultat och balans som Excel nu</a></p>
    </div>
  );
}
