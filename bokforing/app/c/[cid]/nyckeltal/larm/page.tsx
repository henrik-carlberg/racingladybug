import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { METRICS, fmtValue, type Metric } from '@/lib/kpi-alerts';
import { overview } from '@/lib/services/kpi-alerts';
import { addAction, toggleAction } from './actions';

export const dynamic = 'force-dynamic';
const dt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

export default async function KpiAlerts({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const o = await overview(id);
  const label = (aid: number) => { const a = o.alerts.find((x) => x.id === aid); return a ? METRICS[a.metric].label : ''; };
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Nyckeltalslarm</h1>
      <p className="small"><Link href={`/c/${id}/nyckeltal`}>← Nyckeltal</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">Sätt egna gränser för nyckeltalen. När ett värde passerar gränsen visas larmet på översikten och i att göra-listan, och ägarna kan få e-post. Larmet hävs automatiskt när värdet är tillbaka inom gränsen.
        Värdena räknas om varje dag och när sidan öppnas.</p>
      <h2>Nuvarande värden</h2>
      <table className="small ka-metrics"><tbody>{(Object.keys(METRICS) as Metric[]).map((m) => <tr key={m} data-metric={m}><td>{METRICS[m].label}</td><td className="num ka-value">{fmtValue(m, o.metrics[m])}</td></tr>)}</tbody></table>
      <h2>Larm</h2>
      <table className="small ka-alerts"><thead><tr><th>Nyckeltal</th><th>Gräns</th><th>Nu</th><th>Status</th><th></th></tr></thead>
        <tbody>{o.alerts.map((a) => <tr key={a.id} className="ka-alert" data-metric={a.metric} data-open={a.open ? '1' : '0'}><td>{METRICS[a.metric].label}{a.email && <span className="muted"> · e-post</span>}</td>
          <td>{a.comparator === 'below' ? 'under' : 'över'} {fmtValue(a.metric, a.threshold)}</td><td>{fmtValue(a.metric, a.value)}</td>
          <td>{!a.active ? 'Avstängt' : a.open ? <strong className="ka-firing">Utlöst {dt(a.open.triggered_at)}</strong> : 'Inom gränsen'}</td>
          <td><form action={toggleAction.bind(null, id, a.id, !a.active)}><button className="link">{a.active ? 'Stäng av' : 'Slå på'}</button></form></td></tr>)}
          {!o.alerts.length && <tr><td colSpan={5} className="muted">Inga larm.</td></tr>}</tbody></table>
      <form action={addAction.bind(null, id)} className="card row ka-add">
        <label>Nyckeltal<select name="metric">{Object.entries(METRICS).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.unit})</option>)}</select></label>
        <label>Larma när värdet är<select name="comparator"><option value="below">under</option><option value="above">över</option></select></label>
        <label>Gränsvärde<input name="threshold" inputMode="decimal" required style={{ width: '8rem' }} /></label>
        <label className="row"><input type="checkbox" name="email" /> E-post till ägarna</label>
        <button>Lägg till larm</button>
      </form>
      <h2>Historik</h2>
      <ul className="small ka-history">{o.events.map((e) => <li key={e.id}>{label(e.alert_id)}: utlöst {dt(e.triggered_at)} ({e.value ?? '–'}){e.cleared_at ? ` · hävt ${dt(e.cleared_at)}${e.cleared_value != null ? ` (${e.cleared_value})` : ''}` : ''}</li>)}
        {!o.events.length && <li className="muted">Inga larm har utlösts.</li>}</ul>
    </div>
  );
}
