import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/franchise';
import { franchiseeAction, fundAction, recognizeAction, reportAction } from './actions';

export const dynamic = 'force-dynamic';
const prevMonth = (d: string) => { const [y, m] = d.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

export default async function Franchise({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const id = company.id;
  const o = await overview(id);
  const t = today();
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Franchise</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Franchisetagarna rapporterar sin omsättning varje månad, och royalty (3041) och marknadsavgift faktureras på den. Marknadsavgifterna går till marknadsföringsfonden (2974), en skuld som minskar när fonden bekostar marknadsföring.
        Inträdesavgiften faktureras mot förutbetalda intäkter (2973) och intäktsförs linjärt över avtalstiden (3042).</p>
      <div className="row">
        <div className="card stat"><div className="label">Marknadsföringsfond</div><div className="value fr-fund">{kr(o.fund)}</div></div>
        <div className="card stat"><div className="label">Ej intäktsförda inträdesavgifter</div><div className="value fr-deferred">{kr(o.deferred)}</div></div>
      </div>
      <table className="fr-list"><thead><tr><th>Franchisetagare</th><th>Avtal</th><th className="num">Royalty / marknad</th><th className="num">Omsättning (12 mån)</th><th className="num">Avgifter (12 mån)</th><th className="num">Inträdesavgift</th><th>Saknade rapporter</th><th></th></tr></thead>
        <tbody>{o.franchisees.map((f) => (
          <tr key={f.id} className="fr-row" data-name={f.name}><td>{f.name}{f.unit && <div className="small muted">{f.unit}</div>}</td><td className="small">{f.start}–{f.end}</td>
            <td className="num">{f.royalty_pct.toLocaleString('sv-SE')} % / {f.marketing_pct.toLocaleString('sv-SE')} %</td><td className="num fr-turnover">{kr(f.turnover12)}</td><td className="num fr-fees">{kr(f.royalty12)}</td>
            <td className="num small">{f.entry_fee ? <>{kr(f.entry_fee)}<div className="fr-recognized">intäktsfört {kr(f.entry_recognized)}</div>{f.entry_status === 'draft' && <div className="muted">faktura ej bokförd</div>}</> : '–'}</td>
            <td className="small fr-missing">{f.missing.length ? <span style={{ color: 'var(--danger)' }}>{f.missing.slice(-6).join(', ')}{f.missing.length > 6 ? ` (+${f.missing.length - 6})` : ''}</span> : 'Inga'}</td>
            <td><form action={reportAction.bind(null, id, f.id)} className="row" style={{ gap: '.25rem' }}><input type="month" name="period" defaultValue={f.missing.at(0) ?? prevMonth(t)} /><input name="turnover" placeholder="Omsättning exkl. moms" inputMode="decimal" style={{ width: '9rem' }} /><button className="link">Registrera rapport</button></form></td></tr>))}
          {!o.franchisees.length && <tr><td colSpan={8} className="muted">Inga franchisetagare ännu.</td></tr>}</tbody></table>
      <div className="row" style={{ alignItems: 'start' }}>
        <form action={recognizeAction.bind(null, id)} className="card stack"><b>Periodisera inträdesavgifter</b><label>Till och med<input type="date" name="date" defaultValue={t} /></label><button className="secondary">Intäktsför inträdesavgifter</button></form>
        <form action={fundAction.bind(null, id)} className="card stack"><b>Använd marknadsföringsfonden</b>
          <label>Vad fonden bekostar<input name="description" required /></label>
          <div className="row"><label>Belopp (kr)<input name="amount" inputMode="decimal" required style={{ width: '7rem' }} /></label><label>Datum<input type="date" name="date" defaultValue={t} /></label></div>
          <button className="secondary">Bokför användning</button></form>
      </div>
      {o.uses.length > 0 && <table className="small"><tbody>{o.uses.map((u, i) => <tr key={i}><td>{u.date}</td><td>{u.description}</td><td className="num">{kr(u.amount)}</td></tr>)}</tbody></table>}
      <h2>Nytt franchiseavtal</h2>
      <form action={franchiseeAction.bind(null, id)} className="card row">
        <label>Franchisetagare (kund)<select name="customer_id">{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Enhet<input name="unit" placeholder="t.ex. Uppsala" /></label>
        <label>Avtalet börjar<input type="date" name="start_date" required /></label>
        <label>Avtalet slutar<input type="date" name="end_date" required /></label>
        <label>Inträdesavgift (kr)<input name="entry_fee" inputMode="decimal" style={{ width: '8rem' }} /></label>
        <label>Royalty %<input name="royalty_pct" inputMode="decimal" required style={{ width: '5rem' }} /></label>
        <label>Marknadsavgift %<input name="marketing_pct" inputMode="decimal" style={{ width: '5rem' }} /></label>
        <button>Lägg upp avtal</button>
      </form>
    </div>
  );
}
