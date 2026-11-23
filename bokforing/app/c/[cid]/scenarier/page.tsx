import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { KINDS } from '@/lib/scenarios';
import { overview } from '@/lib/services/scenarios';
import { itemAction, removeAction, scenarioAction } from './actions';

export const dynamic = 'force-dynamic';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

export default async function Scenarios({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const year = Number(sp.year) || Number(today().slice(0, 4)) + 1;
  const o = await overview(id, year);
  const all = [{ name: 'Bas', ...o.base, id: 0 }, ...o.scenarios];
  return (
    <div style={{ maxWidth: 1200 }}>
      <h1>Scenarioplanering</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Bygg scenarier ovanpå {o.base.source === 'budget' ? `budgeten för ${year}` : 'årstakten de senaste tolv månaderna (ingen budget finns för året)'} och jämför resultat och kassa per månad.
        Kassan utgår från dagens saldo på bankkontona ({kr(o.base.openingCash)} kr). Nyanställning räknas med arbetsgivaravgift, investeringar skrivs av över angiven tid och lån amorteras rakt.</p>
      <form method="get" className="row"><label>År<input name="year" type="number" defaultValue={year} style={{ width: '6rem' }} /></label><button className="secondary">Visa</button></form>
      <table className="sn-compare"><thead><tr><th>Scenario</th><th className="num">Årets resultat</th><th className="num">Skillnad mot bas</th><th className="num">Lägsta kassa</th><th>Månad</th><th className="num">Kassa vid årets slut</th></tr></thead>
        <tbody>{all.map((s) => <tr key={s.id} className="sn-row" data-name={s.name}><td>{s.name}</td><td className="num sn-result">{kr(s.result)}</td><td className="num sn-diff">{s.id ? kr(s.result - o.base.result) : ''}</td>
          <td className="num sn-lowest" style={s.lowestCash < 0 ? { color: 'var(--danger)' } : undefined}>{kr(s.lowestCash)}</td><td>{MONTHS[s.lowestMonth - 1]}</td><td className="num">{kr(s.closingCash)}</td></tr>)}</tbody></table>
      <div className="table-wrap"><table className="small sn-months"><thead><tr><th>Kassa per månad</th>{MONTHS.map((m) => <th key={m} className="num">{m}</th>)}</tr></thead>
        <tbody>{all.map((s) => <tr key={s.id}><td>{s.name}</td>{s.rows.map((r) => <td key={r.month} className="num" style={r.cash < 0 ? { color: 'var(--danger)' } : undefined}>{Math.round(r.cash / 100).toLocaleString('sv-SE')}</td>)}</tr>)}</tbody></table></div>
      {o.scenarios.map((s) => (
        <section key={s.id} className="card stack sn-scenario" data-name={s.name}>
          <h2 style={{ margin: 0 }}>{s.name}</h2>
          <table><thead><tr><th>Förändring</th><th>Från</th><th className="num">Påverkan på resultatet</th><th className="num">Påverkan på lägsta kassa</th><th></th></tr></thead>
            <tbody>{s.items.map((it) => { const imp = s.impacts.find((x) => x.label === it.label); return <tr key={it.id} className="sn-item" data-label={it.label}><td>{it.label} <span className="small muted">{KINDS[it.kind]}</span></td><td>{MONTHS[it.from_month - 1]}</td>
              <td className="num sn-impact">{imp ? kr(imp.result) : ''}</td><td className="num">{imp ? kr(imp.lowestCash) : ''}</td>
              <td><form action={removeAction.bind(null, id, it.id)}><input type="hidden" name="year" value={year} /><button className="link">Ta bort</button></form></td></tr>; })}
              {!s.items.length && <tr><td colSpan={5} className="muted">Inga förändringar ännu.</td></tr>}</tbody></table>
          <form action={itemAction.bind(null, id, s.id)} className="row">
            <input type="hidden" name="year" value={year} />
            <label>Typ<select name="kind">{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Beskrivning<input name="label" /></label>
            <label>Från månad<input name="from_month" defaultValue="1" inputMode="numeric" style={{ width: '4rem' }} /></label>
            <label>Procent<input name="pct" inputMode="decimal" style={{ width: '5rem' }} /></label>
            <label>Belopp (kr)<input name="amount" inputMode="decimal" style={{ width: '7rem' }} /></label>
            <label>År<input name="years" inputMode="numeric" style={{ width: '4rem' }} /></label>
            <label>Kund<select name="customer_id"><option value="">–</option>{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <button className="secondary">Lägg till</button>
          </form>
        </section>))}
      <form action={scenarioAction.bind(null, id)} className="row">
        <input type="hidden" name="year" value={year} />
        <label>Nytt scenario<input name="name" required /></label>
        <button>Skapa scenario</button>
      </form>
    </div>
  );
}
