import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { listContracts } from '@/lib/services/contracts';
import { listAlerts } from '@/lib/services/fraud';
import { add, remove } from './actions';

export const dynamic = 'force-dynamic';
const ST = { expired: ['Har löpt ut', ''], notice_soon: ['Säg upp snart', 'warn'], active: ['Löper', 'ok'], open_ended: ['Tills vidare', ''] } as const;

export default async function SupplierContracts({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'purchasing' });
  const b = `/c/${company.id}`;
  const [contracts, suppliers, alerts] = await Promise.all([listContracts(company.id), sql<{ id: number; name: string }[]>`SELECT id, name FROM suppliers WHERE company_id = ${company.id} ORDER BY name`,
    listAlerts(company.id, 'open')]);
  const prices = alerts.filter((a) => a.kind === 'price_increase');
  const monthly = contracts.filter((c) => c.state !== 'expired').reduce((s, c) => s + (c.monthly_cost ?? 0), 0);
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Leverantörsavtal</h1>
      <p className="muted">Hyra, leasing, abonnemang och serviceavtal på ett ställe: när de löper ut, när de senast måste sägas upp och vad de kostar. Den ansvarige får ett mejl 45 dagar före sista dag att säga upp.</p>
      <Flash searchParams={searchParams} />
      {prices.length > 0 && (
        <div className="card stack price-alerts"><b>Prishöjningar att granska</b>
          {prices.map((p) => <div key={p.id} className="small">📈 {p.title} – {p.detail} <Link href={`${b}/kontroll`}>Granska</Link></div>)}</div>
      )}
      <div className="table-wrap"><table className="contracts">
        <thead><tr><th>Avtal</th><th>Leverantör</th><th>Löper till</th><th>Säg upp senast</th><th className="num">Kostnad/mån</th><th>Status</th><th></th></tr></thead>
        <tbody>{contracts.map((c) => (
          <tr key={c.id} className="contract-row"><td>{c.name}{c.notes && <div className="small muted">{c.notes}</div>}</td><td>{c.supplier ?? '–'}</td>
            <td>{c.current_end ?? 'Tills vidare'}{c.auto_renew && <div className="small muted">förlängs {c.renew_months} mån i taget</div>}</td>
            <td><b>{c.notice_by ?? '–'}</b>{c.notice_months ? <div className="small muted">{c.notice_months} mån uppsägning</div> : null}</td>
            <td className="num">{c.monthly_cost != null ? kr(c.monthly_cost) : ''}</td>
            <td><span className={`badge ${ST[c.state][1]}`}>{ST[c.state][0]}</span></td>
            <td><form action={remove.bind(null, company.id, c.id)}><button className="link">Ta bort</button></form></td></tr>
        ))}{contracts.length === 0 && <tr><td colSpan={7} className="muted">Inga avtal ännu. Lägg upp det första i formuläret nedan.</td></tr>}
          {monthly > 0 && <tr className="sum"><td colSpan={4}>Löpande avtal per månad</td><td className="num">{kr(monthly)}</td><td colSpan={2}></td></tr>}</tbody>
      </table></div>
      <h2>Nytt avtal</h2>
      <form action={add.bind(null, company.id)} className="card stack">
        <div className="row"><label style={{ flex: '2 1 240px' }}>Avtal<input name="name" required placeholder="T.ex. Hyra lokal, Leasing bil, Telefoni" /></label>
          <label>Leverantör<select name="supplier_id"><option value="">–</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
        <div className="row"><label>Start<input type="date" name="start_date" /></label><label>Slut<input type="date" name="end_date" /></label>
          <label>Uppsägningstid (månader)<input name="notice_months" type="number" min={0} max={60} defaultValue={3} /></label></div>
        <div className="row"><label className="check" style={{ flex: '0 0 auto', alignSelf: 'end' }}><input type="checkbox" name="auto_renew" defaultChecked /> Förlängs automatiskt</label>
          <label>med (månader)<input name="renew_months" type="number" min={0} max={120} defaultValue={12} /></label>
          <label>Kostnad per månad (kr)<input name="monthly_cost" inputMode="decimal" /></label></div>
        <label>Anteckningar<input name="notes" /></label>
        <div><button>Spara avtal</button></div>
      </form>
    </div>
  );
}
