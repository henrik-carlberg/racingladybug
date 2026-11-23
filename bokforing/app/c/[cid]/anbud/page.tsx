import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { STATUS } from '@/lib/tenders';
import { overview } from '@/lib/services/tenders';
import { agreementAction, attachAction, extendAction, statusAction, tenderAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function Tenders({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const id = company.id;
  const o = await overview(id);
  const t = today();
  const won = o.tenders.filter((x) => x.status === 'won' && !x.agreement_id);
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Anbud och ramavtal</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Registrera anbud med kalkyl och följ utfallet. Vunna anbud blir ramavtal med takbelopp och avtalsperiod; fakturor som avropar mot avtalet kopplas dit och följs upp mot taket.</p>
      <h2>Ramavtal</h2>
      <table className="fa-list"><thead><tr><th>Avtal</th><th>Kund</th><th>Period</th><th className="num">Tak</th><th className="num">Avropat</th><th className="num">Kvar</th><th></th></tr></thead>
        <tbody>{o.agreements.map((a) => (
          <tr key={a.id} className="fa-row" data-name={a.name}><td>{a.name}<div className="small muted">{a.calls} avrop</div></td><td>{a.customer}</td>
            <td className="small">{a.start}–{a.end}{a.expiring && <div className="fa-expiring" style={{ color: 'var(--danger)' }}>Löper ut snart</div>}</td>
            <td className="num">{kr(a.cap)}</td><td className="num fa-used">{kr(a.used)} <span className="small">({a.pct.toLocaleString('sv-SE')} %)</span>
              {a.level !== 'ok' && <div className="small fa-level" style={{ color: 'var(--danger)' }}>{a.level === 'over' ? 'Taket är nått' : `Över ${a.warn_pct} % av taket`}</div>}</td>
            <td className="num fa-left">{kr(a.left)}</td>
            <td><div className="stack" style={{ gap: '.25rem' }}>
              {a.invoices.length > 0 && <form action={attachAction.bind(null, id, a.id)} className="row" style={{ gap: '.25rem' }}><select name="invoice_id">{a.invoices.map((i) => <option key={i.id} value={i.id}>{i.number} ({kr(i.net)} kr)</option>)}</select><button className="link">Koppla avrop</button></form>}
              <form action={extendAction.bind(null, id, a.id)} className="row" style={{ gap: '.25rem' }}><input type="date" name="end_date" /><button className="link">Förläng</button></form></div></td></tr>))}
          {!o.agreements.length && <tr><td colSpan={7} className="muted">Inga ramavtal.</td></tr>}</tbody></table>
      <form action={agreementAction.bind(null, id)} className="card row">
        <label>Från vunnet anbud<select name="tender_id"><option value="">– fristående –</option>{won.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label>
        <label>eller kund<select name="customer_id"><option value="">–</option>{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Namn<input name="name" /></label>
        <label>Tak (kr)<input name="cap" inputMode="decimal" required style={{ width: '8rem' }} /></label>
        <label>Börjar<input type="date" name="start_date" defaultValue={t} /></label>
        <label>Slutar<input type="date" name="end_date" required /></label>
        <label>Varna vid %<input name="warn_pct" defaultValue="80" style={{ width: '4rem' }} /></label>
        <button>Lägg upp ramavtal</button>
      </form>

      <h2>Anbud</h2>
      <p className="small">Vinstprocent: <span className="tn-winrate">{o.winRate != null ? `${o.winRate.toLocaleString('sv-SE')} %` : '–'}</span></p>
      <table className="tn-list"><thead><tr><th>Upphandling</th><th>Kund</th><th>Sista dag</th><th className="num">Anbud</th><th className="num">Kalkylerat bidrag</th><th>Status</th><th></th></tr></thead>
        <tbody>{o.tenders.map((x) => (
          <tr key={x.id} className="tn-row" data-title={x.title}><td>{x.title}</td><td>{x.customer}</td><td>{x.due_date}{['draft', 'submitted'].includes(x.status) && x.days >= 0 && x.days <= 7 && <div className="small" style={{ color: 'var(--danger)' }}>{x.days} dagar kvar</div>}</td>
            <td className="num">{kr(x.bid)}</td><td className="num">{x.margin.toLocaleString('sv-SE')} %</td><td className="small">{STATUS[x.status]}{x.decided_on && ` ${x.decided_on}`}</td>
            <td><form action={statusAction.bind(null, id, x.id)} className="row" style={{ gap: '.25rem' }}><select name="status" defaultValue={x.status}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><button className="link">Spara</button></form></td></tr>))}
          {!o.tenders.length && <tr><td colSpan={7} className="muted">Inga anbud.</td></tr>}</tbody></table>
      <form action={tenderAction.bind(null, id)} className="card row">
        <label>Upphandling<input name="title" required /></label>
        <label>Kund<select name="customer_id">{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Sista dag<input type="date" name="due_date" required /></label>
        <label>Kalkylerad kostnad<input name="cost" inputMode="decimal" style={{ width: '8rem' }} /></label>
        <label>Anbudssumma<input name="bid" inputMode="decimal" required style={{ width: '8rem' }} /></label>
        <button>Registrera anbud</button>
      </form>
    </div>
  );
}
