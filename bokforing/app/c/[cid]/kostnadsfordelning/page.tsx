import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, monthEnd, today } from '@/lib/format';
import { overview, report } from '@/lib/services/allocation';
import { charge, key, run, stop } from './actions';

export const dynamic = 'force-dynamic';

export default async function CostAllocation({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id;
  const period = /^\d{4}-\d{2}$/.test(String(sp.period)) ? String(sp.period) : today().slice(0, 7);
  const o = await overview(id);
  const r = await report(id, `${period}-01`, monthEnd(period));
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Kostnadsfördelning och internfakturering</h1>
      <p className="muted">Gemensamma kostnader fördelas på avdelningarna (kostnadsställen) med fördelningsnycklar, till exempel lokalkostnad efter yta eller IT efter antal anställda. Interna debiteringar belastar en avdelning och avlastar en annan. Bolagets resultat påverkas inte.</p>
      <Flash searchParams={searchParams} />
      <form className="row" method="get"><label>Månad<input name="period" defaultValue={period} pattern="\d{4}-\d{2}" /></label><button className="secondary">Visa</button></form>

      <h2>Resultat per avdelning {period}</h2>
      <div className="table-wrap"><table className="dept">
        <thead><tr><th>Avdelning</th><th className="num">Intäkter</th><th className="num">Rörliga kostnader</th><th className="num">Täckningsbidrag</th><th className="num">TB %</th><th className="num">Övriga kostnader</th><th className="num">Interna</th><th className="num">Fördelat</th><th className="num">Resultat</th></tr></thead>
        <tbody>{r.map((d) => (
          <tr key={String(d.id)} className="dept-row"><td>{d.label}</td><td className="num">{kr(d.revenue)}</td><td className="num">{kr(d.variable)}</td><td className="num tb">{kr(d.contribution)}</td>
            <td className="num">{d.tbPct == null ? '–' : `${d.tbPct.toLocaleString('sv-SE')} %`}</td><td className="num">{kr(d.other)}</td><td className="num internal">{kr(d.internal)}</td><td className="num allocated">{kr(d.allocated)}</td><td className="num result">{kr(d.result)}</td></tr>
        ))}</tbody>
      </table></div>
      <form action={run.bind(null, id)} className="card row"><input type="hidden" name="period" value={period} /><span style={{ flex: '1 1 300px' }}>Bokför månadens fördelningar och interna debiteringar (en gång per månad).</span><button>Bokför {period}</button></form>

      <h2>Fördelningsnycklar</h2>
      {o.keys.map((k) => (
        <div key={k.id} className="card row alloc-key"><span style={{ flex: '1 1 300px' }}><b>{k.name}</b> {k.basis && <span className="muted">({k.basis})</span>}<br /><span className="small">Konto {k.account_from}–{k.account_to} från {k.source ?? 'kostnader utan kostnadsställe'} → {o.weights.filter((w) => w.key_id === k.id).map((w) => `${w.label} ${w.weight.toLocaleString('sv-SE')}`).join(', ')}</span></span>
          {k.active ? <form action={stop.bind(null, id, 'key', k.id)}><button className="secondary">Avsluta</button></form> : <span className="muted">Avslutad</span>}</div>
      ))}
      {o.costCenters.length < 2 ? <p className="muted">Lägg upp minst två kostnadsställen under Inställningar → Kostnadsställen.</p> : (
        <form action={key.bind(null, id)} className="card stack">
          <div className="row"><label>Namn<input name="name" required placeholder="Lokalkostnader" /></label><label>Grund<input name="basis" placeholder="kvm" /></label>
            <label>Från konto<input name="account_from" inputMode="numeric" defaultValue="5000" required /></label><label>Till konto<input name="account_to" inputMode="numeric" defaultValue="5099" required /></label>
            <label>Källa<select name="source_cost_center_id"><option value="">Utan kostnadsställe</option>{o.costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label></div>
          <div className="row">{o.costCenters.map((c) => <label key={c.id}>{c.code} {c.name}<input name={`weight_${c.id}`} inputMode="decimal" placeholder="vikt" style={{ width: 90 }} /></label>)}</div>
          <div><button className="secondary">Spara fördelningsnyckel</button></div>
        </form>)}

      <h2>Interna debiteringar</h2>
      <ul className="charges">{o.charges.map((c) => <li key={c.id} className="charge">{c.description}: {c.from} → {c.to} {kr(c.amount)} {c.recurring ? `varje månad från ${c.start_period}` : c.start_period}
        {c.active && <form action={stop.bind(null, id, 'charge', c.id)} style={{ display: 'inline' }}><button className="secondary">Avsluta</button></form>}</li>)}</ul>
      {o.costCenters.length >= 2 && <form action={charge.bind(null, id)} className="card row">
        <label>Från (levererar)<select name="from_cost_center_id">{o.costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>
        <label>Till (betalar)<select name="to_cost_center_id">{o.costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>
        <label>Beskrivning<input name="description" required /></label><label>Belopp (kr)<input name="amount" inputMode="decimal" required /></label>
        <label>Från månad<input name="start_period" defaultValue={period} pattern="\d{4}-\d{2}" /></label><label className="check"><input type="checkbox" name="recurring" /> Varje månad</label>
        <button className="secondary">Spara</button></form>}
    </div>
  );
}
