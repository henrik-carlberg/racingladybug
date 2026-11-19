import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { today } from '@/lib/format';
import { ACTIVITIES, tonnes } from '@/lib/climate';
import { climateReport } from '@/lib/services/climate';
import { add, factor, remove } from './actions';

export const dynamic = 'force-dynamic';
const SCOPE = { 1: 'Scope 1 – egna utsläpp (bränsle)', 2: 'Scope 2 – köpt energi', 3: 'Scope 3 – inköp, resor och transporter' } as const;

export default async function Climate({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id, sp = await searchParams;
  const year = Number(sp.ar) || Number(today().slice(0, 4));
  const r = await climateReport(id, year);
  const max = Math.max(1, ...r.months.map((m) => m.total));
  const change = r.previous ? Math.round(((r.total - r.previous) / r.previous) * 100) : null;
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Klimatbokföring {year}</h1>
      <p className="muted">Utsläppen räknas fram ur bokföringen: kostnaderna per konto gånger en schablon i kg CO₂e per krona. Där du har exakta mängder (kWh el, liter bränsle) används de i stället. Ett underlag för hållbarhetsredovisning – inte en certifierad klimatberäkning.</p>
      <Flash searchParams={searchParams} />
      <p className="small">{[year - 1, year].map((y, i) => <span key={y}>{i > 0 && ' · '}{y === year ? <b>{y}</b> : <a href={`?ar=${y}`}>{y}</a>}</span>)} · <a href={`/c/${id}/klimat/csv?ar=${year}`}>Ladda ner som CSV</a></p>
      <div className="grid">
        <div className="card stat"><div className="label">Totalt</div><div className="value climate-total">{tonnes(r.total)} ton</div>
          {change != null && <div className="small muted">{change > 0 ? `+${change}` : change} % mot {year - 1}</div>}</div>
        {([1, 2, 3] as const).map((s) => <div key={s} className="card stat"><div className="label">{SCOPE[s]}</div><div className="value" data-scope={s}>{tonnes(r.byScope[s])} ton</div></div>)}
      </div>
      <h2>Största källorna</h2>
      <div className="table-wrap"><table className="climate-rows"><thead><tr><th>Kategori</th><th>Scope</th><th>Underlag</th><th className="num">kg CO₂e</th><th className="num">Andel</th></tr></thead>
        <tbody>{r.rows.map((x) => <tr key={x.key}><td>{x.label}</td><td>{x.scope}</td><td className="small">{x.source === 'exact' ? 'Mängd' : `Schablon på ${(x.spend / 100).toLocaleString('sv-SE')} kr`}</td>
          <td className="num">{x.kg.toLocaleString('sv-SE')}</td><td className="num">{r.total ? Math.round((x.kg / r.total) * 100) : 0} %</td></tr>)}
          {r.rows.length === 0 && <tr><td colSpan={5} className="muted">Inga kostnader bokförda för året.</td></tr>}</tbody></table></div>
      {r.suppliers.length > 0 && (<>
        <h2>Leverantörer</h2>
        <table className="small suppliers"><tbody>{r.suppliers.map((s) => <tr key={s.name}><td>{s.name}</td><td>{s.category}</td><td className="num">{s.kg.toLocaleString('sv-SE')} kg</td></tr>)}</tbody></table>
      </>)}
      <h2>Per månad</h2>
      <table className="small months"><thead><tr><th>Månad</th><th className="num">Scope 1</th><th className="num">Scope 2</th><th className="num">Scope 3</th><th className="num">Totalt (kg)</th><th style={{ width: '35%' }}></th></tr></thead>
        <tbody>{r.months.map((m) => <tr key={m.period}><td>{m.period}</td><td className="num">{m[1].toLocaleString('sv-SE')}</td><td className="num">{m[2].toLocaleString('sv-SE')}</td><td className="num">{m[3].toLocaleString('sv-SE')}</td>
          <td className="num">{m.total.toLocaleString('sv-SE')}</td><td aria-hidden><span style={{ display: 'block', height: 8, borderRadius: 4, background: 'var(--accent, #3b82f6)', width: `${(m.total / max) * 100}%` }} /></td></tr>)}</tbody></table>

      <h2>Exakta mängder</h2>
      <form action={add.bind(null, id)} className="card row" style={{ alignItems: 'end' }}>
        <label>Vad<select name="kind">{Object.entries(ACTIVITIES).map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}</select></label>
        <label>Mängd<input name="quantity" inputMode="decimal" required /></label><label>Datum<input type="date" name="date" defaultValue={today()} /></label>
        <label style={{ flex: '2 1 200px' }}>Från (t.ex. elräkning)<input name="note" /></label><div style={{ flex: '0 0 auto' }}><button className="secondary">Spara</button></div>
      </form>
      {r.activities.length > 0 && <table className="small activities"><tbody>{r.activities.map((a) => <tr key={a.id}><td>{a.date}</td><td>{ACTIVITIES[a.kind].label}</td><td className="num">{a.quantity.toLocaleString('sv-SE')} {ACTIVITIES[a.kind].unit}</td><td>{a.note}</td>
        <td><form action={remove.bind(null, id, a.id)}><button className="link">Ta bort</button></form></td></tr>)}</tbody></table>}

      <details className="card"><summary>Faktorer per kategori</summary>
        <table className="small"><thead><tr><th>Kategori</th><th>Konton</th><th>Scope</th><th>kg CO₂e per krona</th></tr></thead>
          <tbody>{r.categories.map((c) => <tr key={c.key}><td>{c.label}</td><td>{c.from}–{c.to}</td><td>{c.scope}</td>
            <td><form action={factor.bind(null, id, c.key)} style={{ display: 'flex', gap: '.3rem' }}><input name="factor" defaultValue={String(c.factor).replace('.', ',')} style={{ width: '6rem' }} aria-label={`Faktor ${c.label}`} /><button className="link">Spara</button></form></td></tr>)}</tbody></table>
        <p className="small muted">Lämna fältet tomt för att gå tillbaka till standardvärdet. Byt gärna till leverantörens egna klimatdata.</p>
      </details>
    </div>
  );
}
