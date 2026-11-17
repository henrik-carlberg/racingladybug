import Link from 'next/link';
import type { ModuleDefinition, ModulePageProps } from '@/lib/modules/types';
import { kr, today } from '@/lib/format';
import { isoWeek } from '@/lib/time';
import * as svc from './service';
import * as a from './actions';
import { CATEGORIES } from './calc';

const krIn = (ore: number) => (ore ? (ore / 100).toFixed(0) : '');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '');

function Nav({ basePath }: { basePath: string }) {
  return <p className="small"><Link href={basePath}>Likviditetsprognos</Link> · <Link href={`${basePath}/budget`}>Budget och utfall</Link></p>;
}

async function Forecast({ companyId, basePath }: ModulePageProps) {
  const [f, s, items] = await Promise.all([svc.forecast(companyId), svc.settings(companyId), svc.items(companyId)]);
  const max = Math.max(1, ...f.weeks.map((w) => Math.abs(w.balance)), Math.abs(f.opening));
  return (
    <>
      <h1>Likviditetsprognos</h1>
      <Nav basePath={basePath} />
      <div className="grid">
        <div className="card stat"><div className="label">Kassa och bank idag</div><div className="value">{kr(f.opening)}</div></div>
        <div className="card stat"><div className="label">Lägsta saldo närmaste 13 veckorna</div><div className="value" style={f.warning ? { color: 'var(--danger)' } : undefined}>{kr(f.lowest.balance)}</div><div className="small muted">vecka {isoWeek(f.lowest.start)}</div></div>
        <div className="card stat"><div className="label">Saldo om 13 veckor</div><div className="value">{kr(f.weeks[f.weeks.length - 1].balance)}</div></div>
      </div>
      {f.warning && <div className="flash error">Saldot väntas gå under {kr(f.minBalance)} kr vecka {isoWeek(f.lowest.start)}. Se över betalningar, skicka påminnelser eller planera finansiering i tid.</div>}
      <div className="table-wrap"><table>
        <thead><tr><th>Vecka</th><th className="num">In</th><th className="num">Ut</th><th className="num">Saldo</th><th style={{ width: '30%' }}></th></tr></thead>
        <tbody>{f.weeks.map((w) => (
          <tr key={w.start}>
            <td><details><summary>v. {isoWeek(w.start)} <span className="small muted">{w.start.slice(5)}–{w.end.slice(5)}</span></summary>
              <table className="small"><tbody>{w.flows.map((x, i) => <tr key={i}><td>{x.date < today() ? 'förfallen' : x.date}</td><td>{x.kind}</td><td>{x.text}</td><td className="num">{kr(x.amount)}</td></tr>)}
                {w.flows.length === 0 && <tr><td className="muted">Inga kända flöden</td></tr>}</tbody></table></details></td>
            <td className="num">{w.inflow ? kr(w.inflow) : ''}</td><td className="num">{w.outflow ? kr(w.outflow) : ''}</td>
            <td className="num" style={w.balance < f.minBalance ? { color: 'var(--danger)', fontWeight: 600 } : { fontWeight: 600 }}>{kr(w.balance)}</td>
            <td><div style={{ height: 8, width: `${(Math.abs(w.balance) / max) * 100}%`, background: w.balance < f.minBalance ? 'var(--danger)' : 'var(--ok)', borderRadius: 4 }} /></td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="small muted">Prognosen bygger på obetalda kund- och leverantörsfakturor (förfallna räknas in i första veckan), avtal, senaste lönekörningen, momsskulden till nästa deadline,
        preliminärskatt och era planerade poster. Kunders betalningar förskjuts med {s.payment_delay} dagar.</p>

      <h2>Planerade in- och utbetalningar</h2>
      <div className="table-wrap"><table>
        <tbody>{items.map((i) => (
          <tr key={i.id}><td>{i.date}</td><td>{i.description}</td><td className="small">{{ none: 'En gång', monthly: 'Varje månad', quarterly: 'Varje kvartal', yearly: 'Varje år' }[i.recurrence]}{i.until ? ` t.o.m. ${i.until}` : ''}</td>
            <td className="num">{kr(Number(i.amount))}</td><td className="num"><form action={a.removeItem.bind(null, companyId, i.id)}><button className="link">Ta bort</button></form></td></tr>
        ))}{items.length === 0 && <tr><td className="muted">T.ex. hyra, lån, investeringar, kapitaltillskott eller förväntade affärer.</td></tr>}</tbody>
      </table></div>
      <form action={a.addItem.bind(null, companyId)} className="card row" style={{ marginTop: '.5rem' }}>
        <label>Typ<select name="direction"><option value="out">Utbetalning</option><option value="in">Inbetalning</option></select></label>
        <label>Datum<input type="date" name="date" defaultValue={today()} required /></label>
        <label style={{ flex: '2 1 200px' }}>Beskrivning<input name="description" required placeholder="T.ex. Lokalhyra" /></label>
        <label>Belopp (kr)<input name="amount" inputMode="decimal" required /></label>
        <label>Upprepas<select name="recurrence"><option value="none">En gång</option><option value="monthly">Varje månad</option><option value="quarterly">Varje kvartal</option><option value="yearly">Varje år</option></select></label>
        <label>till och med<input type="date" name="until" /></label>
        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Lägg till</button></div>
      </form>
      <h2>Inställningar</h2>
      <form action={a.saveSettings.bind(null, companyId)} className="card row">
        <label>Preliminärskatt per månad (kr)<input name="prelskatt_monthly" defaultValue={krIn(s.prelskatt_monthly)} inputMode="decimal" /></label>
        <label>Kunder betalar i snitt (dagar sent)<input name="payment_delay" type="number" min={0} defaultValue={s.payment_delay} /></label>
        <label>Varna under saldo (kr)<input name="min_balance" defaultValue={krIn(s.min_balance)} inputMode="decimal" /></label>
        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Spara</button></div>
      </form>
    </>
  );
}

async function Budget({ companyId, basePath, searchParams }: ModulePageProps) {
  const year = Number(searchParams.ar) || Number(today().slice(0, 4));
  const b = await svc.budget(companyId, year);
  const sum = (f: (m: (typeof b.months)[number]) => number) => b.months.reduce((s, m) => s + f(m), 0);
  const ytdMonth = year < Number(today().slice(0, 4)) ? 12 : year > Number(today().slice(0, 4)) ? 0 : Number(today().slice(5, 7));
  const ytd = (f: (m: (typeof b.months)[number]) => number) => b.months.filter((m) => m.month <= ytdMonth).reduce((s, m) => s + f(m), 0);
  return (
    <>
      <h1>Budget och utfall {year}</h1>
      <Nav basePath={basePath} />
      <p className="small"><Link href={`${basePath}/budget?ar=${year - 1}`}>← {year - 1}</Link> · <Link href={`${basePath}/budget?ar=${year + 1}`}>{year + 1} →</Link></p>
      <div className="grid">
        <div className="card stat"><div className="label">Budgeterat resultat helår</div><div className="value">{kr(sum((m) => m.budgetResult))}</div></div>
        <div className="card stat"><div className="label">Resultat t.o.m. {MONTHS[Math.max(0, ytdMonth - 1)]} – utfall</div><div className="value">{kr(ytd((m) => m.actualResult))}</div>
          <div className="small muted">budget {kr(ytd((m) => m.budgetResult))}</div></div>
        <div className="card stat"><div className="label">Intäkter t.o.m. {MONTHS[Math.max(0, ytdMonth - 1)]}</div><div className="value">{kr(ytd((m) => m.actual.revenue))}</div>
          <div className="small muted">{pct(ytd((m) => m.actual.revenue), ytd((m) => m.budget.revenue))} av budget</div></div>
      </div>
      <h2>Utfall mot budget</h2>
      <div className="table-wrap"><table className="small">
        <thead><tr><th></th>{MONTHS.map((m) => <th key={m} className="num">{m}</th>)}<th className="num">Helår</th></tr></thead>
        <tbody>
          {[...CATEGORIES.map((c) => ({ key: c.key, label: c.label, get: (x: Record<string, number>) => x[c.key] })), { key: 'result', label: 'Resultat', get: null }].map((row) => (
            <tr key={row.key} style={row.key === 'result' ? { fontWeight: 600 } : undefined}>
              <td>{row.label}<div className="muted">budget</div></td>
              {b.months.map((m) => {
                const act = row.get ? row.get(m.actual) : m.actualResult, bud = row.get ? row.get(m.budget) : m.budgetResult;
                const bad = row.key === 'revenue' || row.key === 'result' ? act < bud : act > bud;
                return <td key={m.month} className="num">{m.month <= ytdMonth || act ? <span style={bud && bad ? { color: 'var(--danger)' } : undefined}>{kr(act).replace(/,00$/, '')}</span> : ''}<div className="muted">{bud ? kr(bud).replace(/,00$/, '') : ''}</div></td>;
              })}
              <td className="num">{kr(sum((m) => (row.get ? row.get(m.actual) : m.actualResult))).replace(/,00$/, '')}<div className="muted">{kr(sum((m) => (row.get ? row.get(m.budget) : m.budgetResult))).replace(/,00$/, '')}</div></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <h2>Lägg budget</h2>
      <form action={a.fromLastYear.bind(null, companyId, year)} className="card row">
        <label>Utgå från {year - 1} års utfall, justerat med (%)<input name="percent" inputMode="decimal" defaultValue="5" /></label>
        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Fyll i budget</button></div>
        <span className="small muted" style={{ alignSelf: 'end' }}>Skriver över budgeten nedan.</span>
      </form>
      <form action={a.saveBudget.bind(null, companyId, year)} className="stack">
        <div className="table-wrap"><table className="small">
          <thead><tr><th>Kategori (kr)</th>{MONTHS.map((m) => <th key={m}>{m}</th>)}</tr></thead>
          <tbody>{CATEGORIES.map((c) => (
            <tr key={c.key}><td>{c.label}</td>{b.months.map((m) => (
              <td key={m.month}><input name={`${c.key}_${m.month}`} defaultValue={krIn(m.budget[c.key])} inputMode="decimal" aria-label={`${c.label} ${MONTHS[m.month - 1]}`} style={{ width: '5.5rem', textAlign: 'right', padding: '.25rem' }} /></td>
            ))}</tr>
          ))}</tbody>
        </table></div>
        <div><button>Spara budget</button></div>
        <p className="small muted" style={{ margin: 0 }}>Kategorierna följer BAS-kontoplanen: intäkter 3xxx, varor 4xxx, övriga externa 5–6xxx, personal 70–76xx, avskrivningar 77–78xx och finansiella poster 79–87xx.</p>
      </form>
    </>
  );
}

export const likviditet: ModuleDefinition = {
  id: 'likviditet',
  name: 'Likviditet och budget',
  version: '0.1.0',
  description: 'Likviditetsprognos 13 veckor framåt från fakturor, avtal, lön, moms och skatt plus planerade poster, och budget per kategori och månad mot utfall i bokföringen.',
  nav: [{ label: 'Likviditetsprognos', path: '' }, { label: 'Budget och utfall', path: 'budget' }],
  pages: { '': Forecast, budget: Budget },
  scopes: [
    { scope: 'likviditet:read', description: 'Läsa likviditetsprognos och budget' },
    { scope: 'likviditet:write', description: 'Ändra budget och planerade poster' },
  ],
  api: [
    { method: 'GET', path: '/forecast', scope: 'likviditet:read', tag: 'Likviditet', summary: 'Likviditetsprognos per vecka (13 veckor)', handler: ({ actor }) => svc.forecast(actor.companyId) },
    { method: 'GET', path: '/budget/:year', scope: 'likviditet:read', tag: 'Likviditet', summary: 'Budget och utfall per månad och kategori', handler: ({ actor, params }) => svc.budget(actor.companyId, Number(params.year)) },
  ],
};
