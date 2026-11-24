import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { FREQUENCIES, KINDS } from '@/lib/internal-control';
import { overview } from '@/lib/services/internal-control';
import { controlAction, performAction, riskAction } from './actions';

export const dynamic = 'force-dynamic';
const LEVEL: Record<string, string> = { high: 'Hög', medium: 'Medel', low: 'Låg' };

export default async function InternalControl({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const o = await overview(id);
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Internkontroll och riskregister</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Styrelsen ansvarar för att bolagets organisation är ordnad så att bokföring, medelsförvaltning och ekonomi kontrolleras på ett betryggande sätt (ABL 8 kap. 4 §).
        Bedöm riskerna, koppla kontroller till dem och logga varje utförd kontroll. Sammanställningen kan lämnas till styrelsen och revisorn.</p>
      <div className="card small ic-summary">{o.summary.controls} kontroller · <span className="ic-missing">{o.summary.missing}</span> inte utförda för senaste perioden · <span className="ic-deviations">{o.summary.deviations}</span> avvikelser i år · <span className="ic-uncovered">{o.summary.uncovered}</span> risker (medel eller hög) utan kontroll</div>

      <h2>Riskmatris</h2>
      <table className="small ic-matrix"><thead><tr><th>Sannolikhet \ Konsekvens</th>{[1, 2, 3, 4, 5].map((n) => <th key={n} className="num">{n}</th>)}</tr></thead>
        <tbody>{o.matrix.map((row, i) => <tr key={i}><th>{5 - i}</th>{row.map((n, j) => <td key={j} className="num" data-cell={`${5 - i}-${j + 1}`}>{n || ''}</td>)}</tr>)}</tbody></table>
      <table className="ic-risks"><thead><tr><th>Område</th><th>Risk</th><th className="num">Värde</th><th>Ansvarig</th><th className="num">Kontroller</th></tr></thead>
        <tbody>{o.risks.map((r) => <tr key={r.id} className="ic-risk" data-description={r.description} data-level={r.level}><td>{r.area}</td><td>{r.description}</td><td className="num">{r.score} ({LEVEL[r.level]})</td><td>{r.owner}</td><td className="num">{r.controls}</td></tr>)}
          {!o.risks.length && <tr><td colSpan={5} className="muted">Inga risker.</td></tr>}</tbody></table>
      <form action={riskAction.bind(null, id)} className="card row ic-add-risk">
        <label>Område<input name="area" required maxLength={100} placeholder="Betalningar, lön, lager …" /></label>
        <label>Risk<input name="description" required maxLength={500} /></label>
        <label>Sannolikhet 1–5<input name="likelihood" inputMode="numeric" required style={{ width: '4rem' }} /></label>
        <label>Konsekvens 1–5<input name="impact" inputMode="numeric" required style={{ width: '4rem' }} /></label>
        <label>Ansvarig<input name="owner" maxLength={100} /></label>
        <button>Lägg till risk</button>
      </form>

      <h2>Kontroller</h2>
      {o.controls.map((c) => (
        <div key={c.id} className="card stack small ic-control" data-name={c.name} data-missing={c.missing ? '1' : '0'}>
          <div><strong>{c.name}</strong> · {KINDS[c.kind]} · {FREQUENCIES[c.frequency].toLowerCase()}{c.owner && ` · ${c.owner}`}{c.missing && <span className="ic-late"> · inte utförd för {c.last}</span>}</div>
          {c.runs.length > 0 && <ul className="ic-runs">{c.runs.map((r) => <li key={r.period} data-ok={r.ok ? '1' : '0'}>{r.period}: {r.ok ? 'utan anmärkning' : `avvikelse – ${r.deviation}`} ({r.performed_on})</li>)}</ul>}
          <form action={performAction.bind(null, id, c.id)} className="row" style={{ gap: '.25rem' }}>
            <input name="period" defaultValue={c.missing ? c.last : c.current} style={{ width: '6rem' }} aria-label="Period" />
            <select name="result"><option value="ok">Utan anmärkning</option><option value="deviation">Avvikelse</option></select>
            <input name="deviation" placeholder="Beskriv avvikelsen" style={{ width: '16rem' }} /><button className="link">Registrera utförd kontroll</button></form>
        </div>))}
      {!o.controls.length && <p className="muted">Inga kontroller.</p>}
      <form action={controlAction.bind(null, id)} className="card row ic-add-control">
        <label>Kontroll<input name="name" required maxLength={150} /></label>
        <label>Typ<select name="kind">{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Frekvens<select name="frequency">{Object.entries(FREQUENCIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Risk<select name="risk_id"><option value="">–</option>{o.risks.map((r) => <option key={r.id} value={r.id}>{r.description}</option>)}</select></label>
        <label>Ansvarig<input name="owner" maxLength={100} /></label>
        <label>Från period<input name="start_period" placeholder="t.ex. 2026-01" style={{ width: '6rem' }} /></label>
        <button>Lägg till kontroll</button>
      </form>
    </div>
  );
}
