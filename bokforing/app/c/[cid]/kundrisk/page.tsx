import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { RISK_LABEL } from '@/lib/credit';
import { overview } from '@/lib/services/credit';
import { auto, check, limit, monitor } from './actions';

export const dynamic = 'force-dynamic';
const COLOR = { low: 'var(--ok)', medium: 'var(--warn)', high: 'var(--danger)', stop: 'var(--danger)' } as const;

export default async function CustomerRisk({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { perm: 'invoicing' });
  const id = ctx.company.id;
  const o = await overview(id);
  const shown = o.rows.filter((r) => r.orgnr || r.credit_limit != null || r.risk_class || r.open);
  return (
    <div style={{ maxWidth: 1200 }}>
      <h1>Kundrisk och kreditkontroll</h1>
      <p className="muted">Kreditupplysning, kreditgräns och riskklass per kund. Riskklassen väger samman upplysningen med hur kunden har betalat er. En faktura som överskrider gränsen ger varning – eller stoppas, om kunden har policyn Stoppa.</p>
      <Flash searchParams={searchParams} />
      {!o.configured && <div className="card small">Kreditupplysning är inte uppsatt (CREDIT_API_URL och CREDIT_API_KEY). Kreditgränser och riskklass efter betalningshistorik fungerar ändå.</div>}
      {ctx.role === 'owner' && o.configured && <form action={auto.bind(null, id, !o.auto)} className="card row"><span style={{ flex: '1 1 300px' }}>{o.auto ? 'Nya företagskunder kreditkontrolleras automatiskt.' : 'Nya företagskunder kontrolleras inte automatiskt.'}</span><button className="secondary">{o.auto ? 'Stäng av' : 'Kontrollera nya kunder automatiskt'}</button></form>}
      <div className="table-wrap"><table className="credit">
        <thead><tr><th>Kund</th><th>Risk</th><th>Upplysning</th><th className="num">Obetalt</th><th>Kreditgräns</th><th>Betalar</th><th></th></tr></thead>
        <tbody>{shown.map((r) => (
          <tr key={r.id} className="credit-row">
            <td><Link href={`/c/${id}/kunder/${r.id}`}>{r.name}</Link><div className="small muted">{r.orgnr}</div></td>
            <td className="risk">{r.risk_class ? <b style={{ color: COLOR[r.risk_class] }}>{RISK_LABEL[r.risk_class]}</b> : <span className="muted">–</span>}</td>
            <td className="small">{r.checked ? <>{r.rating || `score ${r.score}`}{r.remarks ? `, ${r.remarks} anmärkn.` : ''}{r.status && r.status !== 'active' ? `, ${r.status}` : ''}<div className="muted">{r.checked}{r.monitored ? ' · bevakas' : ''}</div></> : <span className="muted">Ingen</span>}</td>
            <td className="num">{kr(r.open)}{r.utilization != null && <div className={`small util ${r.utilization > 100 ? 'over' : ''}`} style={{ color: r.utilization > 100 ? 'var(--danger)' : undefined }}>{r.utilization} % av gränsen</div>}</td>
            <td><form action={limit.bind(null, id, r.id)} className="row"><input name="credit_limit" inputMode="decimal" defaultValue={r.credit_limit != null ? String(r.credit_limit / 100) : ''} placeholder="ingen" aria-label="Kreditgräns" style={{ width: 100 }} />
              <select name="credit_policy" defaultValue={r.credit_policy} aria-label="Vid överskridande"><option value="warn">Varna</option><option value="block">Stoppa</option></select><button className="secondary">Spara</button></form></td>
            <td className="small">{r.behavior ? `${r.behavior.avgDelay} dagar sent i snitt` : ''}</td>
            <td>{o.configured && r.orgnr && <div className="row">
              <form action={check.bind(null, id, r.id)}><button className="secondary">Ta upplysning</button></form>
              <form action={monitor.bind(null, id, r.id, !r.monitored)}><button className="secondary">{r.monitored ? 'Sluta bevaka' : 'Bevaka'}</button></form></div>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {o.events.length > 0 && (<><h2>Händelser</h2><ul className="credit-events">{o.events.map((e, i) => <li key={i}><span className="muted">{e.at}</span> {e.message}</li>)}</ul></>)}
    </div>
  );
}
