import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { tiersText } from '@/lib/rebates';
import { overview } from '@/lib/services/rebates';
import { accrueAction, addAction, settleAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function CustomerRebates({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const id = company.id;
  const { rows, customers, fys } = await overview(id);
  const t = today();
  const openFys = fys.filter((f) => !f.closed);
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Kundbonus</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Bonus i efterhand på kundens omsättning (exkl. moms) under avtalsperioden. Den högsta nivå som omsättningen når gäller på hela omsättningen.
        Vid bokslut bokförs intjänad men ej reglerad bonus som upplupen kostnad (debet 3730, kredit 2990). När perioden är slut krediteras bonusen med en kreditfaktura, så att momsen sätts ned.</p>
      <table className="rb-list"><thead><tr><th>Kund</th><th>Period</th><th>Trappsteg</th><th className="num">Omsättning</th><th className="num">Bonus</th><th>Nästa steg</th><th className="num">Upplupet</th><th></th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className="rb-row" data-customer={r.party}><td>{r.party}{r.note && <div className="small muted">{r.note}</div>}</td><td>{r.start} – {r.end}</td><td className="small">{tiersText(r.tiers)}</td>
            <td className="num rb-volume">{kr(r.volume)}</td><td className="num rb-amount">{kr(r.amount)}{r.pct ? <div className="small muted">{r.pct / 100} %</div> : null}</td>
            <td className="small">{r.next && !r.ended ? `${kr(r.toNext)} kr kvar till ${r.next.pct / 100} %` : ''}</td><td className="num rb-accrued">{kr(r.accrued)}</td>
            <td>{r.settled_at ? <span className="small">Reglerad {r.settled_at}{r.settled_invoice_id && <> – <Link href={`/c/${id}/fakturor/${r.settled_invoice_id}`}>faktura</Link></>}</span>
              : r.ended ? <form action={settleAction.bind(null, id, r.id)} className="row" style={{ gap: '.25rem' }}><input type="date" name="date" defaultValue={t} /><button className="link">Reglera</button></form>
              : <span className="small muted">Pågår</span>}</td></tr>))}
          {!rows.length && <tr><td colSpan={8} className="muted">Inga bonusavtal.</td></tr>}</tbody></table>
      {openFys.length > 0 && rows.some((r) => !r.settled_at) && (
        <form action={accrueAction.bind(null, id)} className="card row" style={{ alignItems: 'end', marginTop: '1rem' }}>
          <label>Bokslut<select name="fiscal_year_id">{openFys.map((f) => <option key={f.id} value={f.id}>{f.start} – {f.end}</option>)}</select></label>
          <button className="secondary">Bokför upplupen bonus</button>
        </form>)}
      <h2>Nytt bonusavtal</h2>
      <form action={addAction.bind(null, id)} className="card stack">
        <div className="row">
          <label>Kund<select name="customer_id" required>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Från<input type="date" name="start_date" defaultValue={`${t.slice(0, 4)}-01-01`} required /></label>
          <label>Till<input type="date" name="end_date" defaultValue={`${t.slice(0, 4)}-12-31`} required /></label>
          <label>Moms<select name="vat_rate" defaultValue="25"><option>25</option><option>12</option><option>6</option><option>0</option></select></label>
        </div>
        <label>Trappsteg (omsättning i kr från och med : bonus i %)<input name="tiers" placeholder="500000:2; 1000000:3" required /></label>
        <label>Notering<input name="note" maxLength={300} /></label>
        <div><button>Lägg upp avtal</button></div>
      </form>
    </div>
  );
}
