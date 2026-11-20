import { requireCompany } from '@/lib/server/auth';
import { sql } from '@/lib/db';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { positions } from '@/lib/services/poc';
import { book, create, estimate, part } from './actions';

export const dynamic = 'force-dynamic';
const pct = (g: number) => `${Math.round(g * 1000) / 10} %`.replace('.', ',');

export default async function PercentageOfCompletion({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id;
  const at = /^\d{4}-\d{2}-\d{2}$/.test(String(sp.date)) ? String(sp.date) : today();
  const ps = await positions(id, at);
  const projects = await sql<{ id: number; name: string }[]>`SELECT id, name FROM projects WHERE company_id = ${id} ORDER BY name`;
  const changes = ps.reduce((n, p) => n + p.lines.length, 0);
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Successiv vinstavräkning</h1>
      <p className="muted">Uppdrag till fast pris redovisas i takt med att de utförs: färdigställandegraden är nedlagda kostnader på projektet i förhållande till beräknade totala kostnader. Skillnaden mot det fakturerade bokförs per bokslutsdagen, och en befarad förlust reserveras direkt (K3 kap. 23). Kontrollera att ert regelverk medger metoden.</p>
      <Flash searchParams={searchParams} />
      <form className="row" method="get"><label>Per datum<input type="date" name="date" defaultValue={at} /></label><button className="secondary">Visa</button></form>
      <div className="table-wrap"><table className="poc">
        <thead><tr><th>Uppdrag</th><th className="num">Kontrakt</th><th className="num">Beräknad kostnad</th><th className="num">Nedlagt</th><th className="num">Färdigt</th><th className="num">Upparbetat</th><th className="num">Fakturerat</th><th className="num">Att redovisa</th><th></th></tr></thead>
        <tbody>{ps.map((p) => (
          <tr key={p.id} className="poc-row"><td><b>{p.name}</b>{p.status === 'done' && <div className="small muted">avslutat</div>}{p.expectedLoss > 0 && <div className="small" style={{ color: 'var(--danger)' }}>Befarad förlust {kr(p.expectedLoss)}</div>}</td>
            <td className="num">{kr(p.value)}</td><td className="num">{kr(p.estimated_cost)}</td><td className="num">{kr(p.cost)}</td><td className="num grade">{pct(p.grade)}</td>
            <td className="num earned">{kr(p.earned)}</td><td className="num">{kr(p.invoiced)}</td>
            <td className="num wip">{p.wip >= 0 ? `${kr(p.wip)} tillgång` : `${kr(-p.wip)} skuld`}<div className="small muted">bokfört {kr(p.booked.wip)}</div></td>
            <td><form action={estimate.bind(null, id, p.id)} className="row"><input name="estimated_cost" inputMode="decimal" defaultValue={String(p.estimated_cost / 100)} aria-label="Beräknad kostnad" style={{ width: 110 }} />
              <label className="check"><input type="checkbox" name="done" defaultChecked={p.status === 'done'} /> Avslutat</label><button className="secondary">Spara</button></form>
              {p.status === 'open' && <form action={part.bind(null, id, p.id)} className="row" style={{ marginTop: 4 }}><input name="amount" inputMode="decimal" placeholder="Delfaktura (kr)" aria-label="Delfaktura" style={{ width: 110 }} required /><button className="secondary">Fakturera</button></form>}</td></tr>
        ))}</tbody>
      </table></div>
      <form action={book.bind(null, id)} className="card row"><input type="hidden" name="date" value={at} />
        <span style={{ flex: '1 1 300px' }}>{changes ? `Bokför justeringen per ${at}: upparbetat mot fakturerat (1620/2450 mot 3795) och befarade förluster (4995/2290).` : 'Inga förändringar att bokföra per datumet.'}</span>
        <button disabled={!changes}>Bokför per {at}</button></form>
      <form action={create.bind(null, id)} className="card row">
        <label>Projekt<select name="project_id">{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Benämning<input name="name" /></label><label>Kontraktsvärde exkl. moms (kr)<input name="value" inputMode="decimal" required /></label>
        <label>Beräknade totala kostnader (kr)<input name="estimated_cost" inputMode="decimal" required /></label><button className="secondary">Lägg upp uppdrag</button>
      </form>
      <p className="small muted">Kostnader och intäkter räknas från verifikationsrader som är märkta med projektet. Projekt läggs upp under Uppdrag.</p>
    </div>
  );
}
