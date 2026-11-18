import Link from 'next/link';
import { sql } from '@/lib/db';
import type { ModuleDefinition, ModulePageProps } from '@/lib/modules/types';
import { kr, today } from '@/lib/format';
import { BILLING_LABEL, fmtHours } from '@/lib/time';
import * as svc from './service';
import * as a from './actions';
import { STATUS, TASK_STATUS, timelinePos } from './calc';

const krIn = (ore: number) => (ore ? (ore / 100).toFixed(2).replace('.', ',').replace(/,00$/, '') : '');
const pct = (n: number | null) => (n == null ? '–' : `${String(n).replace('.', ',')} %`);
const hrs = (n: number) => `${n.toLocaleString('sv-SE', { maximumFractionDigits: 1 })} h`;
const Badge = ({ s }: { s: string }) => <span className={`badge ${STATUS[s]?.[1] ?? ''}`}>{STATUS[s]?.[0] ?? s}</span>;

function Bar({ value, warn }: { value: number | null; warn?: boolean }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <span style={{ display: 'inline-block', width: 90, height: 8, background: 'var(--border)', borderRadius: 4, verticalAlign: 'middle', marginRight: 6 }}>
      <span style={{ display: 'block', width: `${v}%`, height: 8, borderRadius: 4, background: warn ? 'var(--danger)' : 'var(--ok)' }} />
    </span>
  );
}

function DetailFields({ d, users }: { d: svc.Details; users: { id: number; name: string }[] }) {
  return (<>
    <div className="row">
      <label>Projektledare<select name="manager_user_id" defaultValue={d.manager_user_id ?? ''}><option value="">–</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label>Status<select name="status" defaultValue={d.status}>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label>Start<input type="date" name="start_date" defaultValue={d.start_date ?? ''} /></label>
      <label>Slut<input type="date" name="end_date" defaultValue={d.end_date ?? ''} /></label>
    </div>
    <div className="row">
      <label>Budget timmar<input name="budget_hours" defaultValue={d.budget_hours ? String(d.budget_hours).replace('.', ',') : ''} inputMode="decimal" /></label>
      <label>Budget intäkter (kr)<input name="budget_revenue" defaultValue={krIn(d.budget_revenue)} inputMode="decimal" /></label>
      <label>Budget externa kostnader (kr)<input name="budget_cost" defaultValue={krIn(d.budget_cost)} inputMode="decimal" /></label>
      <label>Intern kostnad per timme (kr)<input name="internal_rate" defaultValue={krIn(d.internal_rate)} inputMode="decimal" placeholder="Lön + sociala avgifter + omkostnader" /></label>
    </div>
    <label>Beskrivning och mål<textarea name="description" rows={2} defaultValue={d.description} /></label>
  </>);
}

// ---------- Portfölj ----------

async function Portfolio({ companyId, basePath, searchParams }: ModulePageProps) {
  const [projects, customers, users] = await Promise.all([
    svc.listProjects(companyId, { status: searchParams.status }),
    sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name`, svc.members(companyId),
  ]);
  const t = today();
  const sum = (f: (p: svc.ProjectOut) => number) => projects.reduce((s, p) => s + f(p), 0);
  return (
    <>
      <div className="header">
        <h1>Projekt</h1>
        <div className="actions" style={{ margin: 0 }}><Link className="btn secondary" href={`${basePath}/mina-uppgifter`}>Mina uppgifter</Link><Link className="btn" href={`/c/${companyId}/tid`}>⏱ Rapportera tid</Link></div>
      </div>
      <p className="small">{[['', 'Alla'], ['active', 'Pågår'], ['planned', 'Planerade'], ['on_hold', 'Pausade'], ['done', 'Avslutade']].map(([k, l], i) => (
        <span key={k}>{i > 0 && ' · '}{(searchParams.status ?? '') === k ? <b>{l}</b> : <Link href={`${basePath}${k ? `?status=${k}` : ''}`}>{l}</Link>}</span>
      ))}</p>
      <div className="grid">
        <div className="card stat"><div className="label">Projekt</div><div className="value">{projects.length}</div></div>
        <div className="card stat"><div className="label">Intäkter</div><div className="value">{kr(sum((p) => p.economics.revenue))}</div></div>
        <div className="card stat"><div className="label">Resultat</div><div className="value">{kr(sum((p) => p.economics.result))}</div></div>
        <div className="card stat"><div className="label">Rapporterad tid</div><div className="value">{hrs(sum((p) => p.economics.hoursUsed))}</div></div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Projekt</th><th>Kund</th><th>Status</th><th>Projektledare</th><th>Slut</th><th>Färdigt</th><th>Timmar mot budget</th><th className="num">Intäkter</th><th className="num">Resultat</th><th className="num">Marginal</th></tr></thead>
        <tbody>
          {projects.map((p) => {
            const late = p.details.end_date && p.details.end_date < t && p.details.status !== 'done';
            return (
              <tr key={p.id}>
                <td><Link href={`${basePath}/p/${p.id}`}>{p.name}</Link></td><td>{p.customer_name}</td><td><Badge s={p.details.status} /></td>
                <td className="small">{p.details.manager ?? ''}</td>
                <td className="small" style={late ? { color: 'var(--danger)' } : undefined}>{p.details.end_date ?? ''}{late ? ' (sen)' : ''}</td>
                <td className="small"><Bar value={p.progress} />{p.progress} %</td>
                <td className="small">{p.details.budget_hours ? <><Bar value={p.economics.hoursPct} warn={(p.economics.hoursPct ?? 0) > p.progress + 10} />{hrs(p.economics.hoursUsed)} / {hrs(p.details.budget_hours)}</> : hrs(p.economics.hoursUsed)}</td>
                <td className="num">{kr(p.economics.revenue)}</td>
                <td className="num" style={p.economics.result < 0 ? { color: 'var(--danger)' } : undefined}>{kr(p.economics.result)}</td>
                <td className="num">{pct(p.economics.margin)}</td>
              </tr>
            );
          })}
          {projects.length === 0 && <tr><td colSpan={10} className="muted">Inga projekt.</td></tr>}
        </tbody>
      </table></div>

      <h2>Nytt projekt</h2>
      {customers.length === 0 ? <p>Lägg först upp en <Link href={`/c/${companyId}/kunder`}>kund</Link>.</p> : (
        <form action={a.create.bind(null, companyId)} className="card stack">
          <div className="row">
            <label>Kund<select name="customer_id" required>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label style={{ flex: '2 1 260px' }}>Projektnamn<input name="name" required /></label>
            <label>Fakturering<select name="billing" defaultValue="fixed">
              <option value="fixed">Fast pris – faktureras per delmoment</option><option value="hourly">Löpande räkning – arbetad tid</option><option value="hour_bank">Timbank</option>
            </select></label>
            <label>Timpris (kr)<input name="hourly_rate" inputMode="decimal" /></label>
          </div>
          <DetailFields d={{ manager_user_id: null, manager: null, status: 'active', start_date: t, end_date: null, budget_hours: 0, budget_revenue: 0, budget_cost: 0, internal_rate: 0, description: '' }} users={users} />
          <label>Aktiviteter för tidrapportering (en per rad)<textarea name="activities" rows={2} defaultValue={'Projektarbete'} /></label>
          <div><button>Skapa projekt</button></div>
          <p className="small muted" style={{ margin: 0 }}>Projektet blir också ett uppdrag i tidrapporteringen, så att tid och fakturor räknas in automatiskt.</p>
        </form>
      )}
    </>
  );
}

// ---------- Projekt ----------

function TaskCard({ t, companyId, pid, back }: { t: svc.Task; companyId: number; pid: number; back?: string }) {
  const late = t.due_date && t.due_date < today() && t.status !== 'done';
  const moves = (['todo', 'doing', 'done'] as const).filter((s) => s !== t.status);
  return (
    <div className="card" style={{ margin: '0 0 .5rem', padding: '.6rem .75rem' }}>
      <b>{t.title}</b>
      <div className="small muted">{[t.assignee, t.milestone, t.due_date && `senast ${t.due_date}`].filter(Boolean).join(' · ')}{late && <span style={{ color: 'var(--danger)' }}> · försenad</span>}</div>
      {t.description && <div className="small">{t.description}</div>}
      <div className="small">{fmtHours(t.logged_minutes)}{t.estimate_minutes ? ` av ${fmtHours(t.estimate_minutes)}` : ''}</div>
      <div className="small" style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginTop: '.3rem' }}>
        {moves.map((s) => <form key={s} action={a.taskStatus.bind(null, companyId, pid, t.id, s, back)}><button className="link">→ {TASK_STATUS[s]}</button></form>)}
        {!back && <form action={a.deleteTask.bind(null, companyId, pid, t.id)}><button className="link">Ta bort</button></form>}
      </div>
      {t.status !== 'done' && (
        <form action={a.logTime.bind(null, companyId, pid, t.id, back ?? null)} style={{ display: 'flex', gap: '.4rem', marginTop: '.4rem' }}>
          <input name="hours" placeholder="Tid, t.ex. 1,5" aria-label={`Tid på ${t.title}`} inputMode="decimal" style={{ maxWidth: '7rem' }} required />
          <input name="description" placeholder="Vad gjorde du?" aria-label="Beskrivning" />
          <button className="secondary" style={{ whiteSpace: 'nowrap' }}>Rapportera</button>
        </form>
      )}
    </div>
  );
}

async function Project({ companyId, basePath, params }: ModulePageProps) {
  const p = await svc.getProject(companyId, Number(params.id));
  const [users, costs, candidates] = await Promise.all([svc.members(companyId), svc.projectCosts(p.id), svc.costCandidates(companyId, p.id)]);
  const d = p.details, e = p.economics, t = today();
  const hasTimeline = d.start_date && d.end_date;
  return (
    <>
      <div className="header">
        <h1>{p.name} <span className="muted" style={{ fontWeight: 400 }}>· {p.customer_name}</span> <Badge s={d.status} /></h1>
        <div className="actions" style={{ margin: 0 }}><Link className="btn secondary" href={basePath}>Alla projekt</Link><Link className="btn secondary" href={`/c/${companyId}/uppdrag/${p.id}`}>Tid och fakturering</Link></div>
      </div>
      <p className="small muted">{BILLING_LABEL[p.billing]}{d.manager ? ` · projektledare ${d.manager}` : ''}{d.start_date ? ` · ${d.start_date} – ${d.end_date ?? '?'}` : ''}{d.description ? ` · ${d.description}` : ''}</p>

      <div className="grid">
        <div className="card stat"><div className="label">Färdigt</div><div className="value">{p.progress} %</div><div className="small muted">{p.tasks.filter((x) => x.status === 'done').length} av {p.tasks.length} uppgifter</div></div>
        <div className="card stat"><div className="label">Timmar</div><div className="value">{hrs(e.hoursUsed)}</div>
          <div className="small muted">{d.budget_hours ? `av ${hrs(d.budget_hours)} (${pct(e.hoursPct)})` : 'ingen timbudget'}{p.forecast_hours != null && d.budget_hours ? ` · prognos ${hrs(p.forecast_hours)}` : ''}</div></div>
        <div className="card stat"><div className="label">Intäkter</div><div className="value">{kr(e.revenue)}</div><div className="small muted">{d.budget_revenue ? `av ${kr(d.budget_revenue)} (${pct(e.revenuePct)})` : 'fakturerat exkl. moms'}</div></div>
        <div className="card stat"><div className="label">Resultat</div><div className="value" style={e.result < 0 ? { color: 'var(--danger)' } : undefined}>{kr(e.result)}</div>
          <div className="small muted">marginal {pct(e.margin)} · kostnader {kr(e.externalCost)} + intern tid {kr(e.internalCost)}</div></div>
      </div>
      {p.forecast_hours != null && d.budget_hours > 0 && p.forecast_hours > d.budget_hours * 1.1 && (
        <div className="flash error">Prognosen ({hrs(p.forecast_hours)}) ligger mer än 10 % över timbudgeten. Se över planen eller prata med kunden om ändrad omfattning.</div>
      )}

      {hasTimeline && (
        <div className="card">
          <b>Tidslinje</b>
          <div style={{ position: 'relative', height: 44, margin: '1.5rem 0 .5rem', borderTop: '3px solid var(--border)' }}>
            {t >= d.start_date! && t <= d.end_date! && <div title={`Idag ${t}`} style={{ position: 'absolute', left: `${timelinePos(d.start_date!, d.end_date!, t)}%`, top: -14, height: 28, borderLeft: '2px dashed var(--danger)' }} />}
            {p.milestones.filter((m) => m.due_date).map((m) => (
              <div key={m.id} style={{ position: 'absolute', left: `${timelinePos(d.start_date!, d.end_date!, m.due_date!)}%`, top: -9, transform: 'translateX(-50%)', textAlign: 'center' }}>
                <div style={{ width: 14, height: 14, margin: '0 auto', transform: 'rotate(45deg)', background: m.done ? 'var(--ok)' : 'var(--panel)', border: '2px solid var(--ok)' }} />
                <div className="small" style={{ whiteSpace: 'nowrap' }}>{m.name}</div>
              </div>
            ))}
          </div>
          <div className="small muted" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{d.start_date}</span><span>{d.end_date}</span></div>
        </div>
      )}

      <h2 id="uppgifter">Uppgifter</h2>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', alignItems: 'start' }}>
        {(['todo', 'doing', 'done'] as const).map((s) => (
          <div key={s}>
            <div className="small" style={{ fontWeight: 600, marginBottom: '.4rem' }}>{TASK_STATUS[s]} ({p.tasks.filter((x) => x.status === s).length})</div>
            {p.tasks.filter((x) => x.status === s).map((x) => <TaskCard key={x.id} t={x} companyId={companyId} pid={p.id} />)}
          </div>
        ))}
      </div>
      <form action={a.saveTask.bind(null, companyId, p.id, null)} className="card stack">
        <div className="row">
          <label style={{ flex: '3 1 260px' }}>Ny uppgift<input name="title" required /></label>
          <label>Ansvarig<select name="assignee_user_id"><option value="">–</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label>Delmoment<select name="milestone_id"><option value="">–</option>{p.milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        </div>
        <div className="row">
          <label>Uppskattad tid<input name="estimate" placeholder="T.ex. 8" inputMode="decimal" /></label>
          <label>Klart senast<input type="date" name="due_date" /></label>
          <label style={{ flex: '3 1 260px' }}>Beskrivning<input name="description" /></label>
          <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Lägg till uppgift</button></div>
        </div>
      </form>

      <h2 id="delmoment">Delmoment</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Delmoment</th><th>Datum</th><th className="num">Att fakturera</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {p.milestones.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td><td style={!m.done && m.due_date && m.due_date < t ? { color: 'var(--danger)' } : undefined}>{m.due_date ?? ''}</td>
              <td className="num">{m.amount ? kr(m.amount) : ''}</td>
              <td>{m.done ? <span className="badge ok">Klart {m.done_at}</span> : <span className="badge">Ej klart</span>}
                {m.invoice_id && <> <Link className="small" href={`/c/${companyId}/fakturor/${m.invoice_id}`}>{m.invoice_status === 'draft' ? 'Fakturautkast' : 'Fakturerat'}</Link></>}</td>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>
                {!m.invoice_id && <form action={a.milestoneDone.bind(null, companyId, p.id, m.id, !m.done)} style={{ display: 'inline' }}><button className="link">{m.done ? 'Öppna igen' : 'Markera klart'}</button></form>}
                {m.done && m.amount > 0 && !m.invoice_id && <form action={a.invoiceMilestone.bind(null, companyId, p.id, m.id)} style={{ display: 'inline', marginLeft: '.6rem' }}><button className="link">Fakturera</button></form>}
              </td>
            </tr>
          ))}
          {p.milestones.length === 0 && <tr><td colSpan={5} className="muted">Inga delmoment ännu.</td></tr>}
        </tbody>
      </table></div>
      <form action={a.saveMilestone.bind(null, companyId, p.id, null)} className="card row" style={{ marginTop: '.5rem' }}>
        <label style={{ flex: '2 1 240px' }}>Nytt delmoment<input name="name" required placeholder="T.ex. Förstudie klar" /></label>
        <label>Datum<input type="date" name="due_date" /></label>
        <label>Fakturera vid klart (kr exkl. moms)<input name="amount" inputMode="decimal" placeholder="0" /></label>
        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Lägg till</button></div>
      </form>

      <h2 id="kostnader">Kostnader</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Datum</th><th>Beskrivning</th><th>Källa</th><th className="num">Belopp</th><th></th></tr></thead>
        <tbody>
          {costs.map((c) => (
            <tr key={c.id}><td>{c.date}</td><td>{c.description}</td>
              <td className="small">{c.voucher_id ? <Link href={`/c/${companyId}/verifikationer/${c.voucher_id}`}>Verifikation, konto {c.account}</Link> : 'Manuell'}</td>
              <td className="num">{kr(Number(c.amount))}</td><td className="num"><form action={a.removeCost.bind(null, companyId, p.id, c.id)}><button className="link">Ta bort</button></form></td></tr>
          ))}
          {costs.length === 0 && <tr><td colSpan={5} className="muted">Inga externa kostnader kopplade.</td></tr>}
        </tbody>
      </table></div>
      {candidates.length > 0 && (
        <details className="card" style={{ marginTop: '.5rem' }}>
          <summary className="small"><b>Koppla bokförda kostnader</b> ({candidates.length} under projektperioden, konton 4000–6999)</summary>
          <div className="table-wrap"><table><tbody>{candidates.map((x) => (
            <tr key={`${x.voucher_id}-${x.account}`}><td>{x.date}</td><td>{x.ref}</td><td>{x.description}</td><td className="small">konto {x.account}</td><td className="num">{kr(Number(x.amount))}</td>
              <td className="num"><form action={a.linkCost.bind(null, companyId, p.id, x.voucher_id, x.account)}><button className="link">Koppla</button></form></td></tr>
          ))}</tbody></table></div>
        </details>
      )}
      <form action={a.addCost.bind(null, companyId, p.id)} className="card row" style={{ marginTop: '.5rem' }}>
        <label>Datum<input type="date" name="date" defaultValue={t} /></label>
        <label style={{ flex: '2 1 240px' }}>Annan kostnad<input name="description" required placeholder="T.ex. del av licens, resa" /></label>
        <label>Belopp exkl. moms (kr)<input name="amount" inputMode="decimal" required /></label>
        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Lägg till</button></div>
      </form>

      {p.team.length > 0 && (<>
        <h2>Tid per person</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Person</th><th className="num">Tid</th>{d.internal_rate > 0 && <th className="num">Intern kostnad</th>}</tr></thead>
          <tbody>{p.team.map((m) => <tr key={m.user_id}><td>{m.name}</td><td className="num">{fmtHours(m.minutes)}</td>{d.internal_rate > 0 && <td className="num">{kr(Math.round((m.minutes / 60) * d.internal_rate))}</td>}</tr>)}</tbody>
        </table></div>
      </>)}

      <h2>Projektplan</h2>
      <form action={a.saveDetails.bind(null, companyId, p.id)} className="card stack">
        <DetailFields d={d} users={users} />
        <div><button>Spara</button></div>
      </form>
    </>
  );
}

async function MyTasks({ companyId, actor, basePath }: ModulePageProps) {
  const tasks = await svc.myTasks(companyId, actor.userId);
  const back = `${basePath}/mina-uppgifter`;
  return (
    <>
      <div className="header"><h1>Mina uppgifter</h1><div className="actions" style={{ margin: 0 }}><Link className="btn secondary" href={basePath}>Alla projekt</Link></div></div>
      {tasks.length === 0 && <p className="muted">Du har inga öppna uppgifter.</p>}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
        {tasks.map((t) => (
          <div key={t.id}>
            <div className="small"><Link href={`${basePath}/p/${t.project_id}`}>{t.project}</Link></div>
            <TaskCard t={t} companyId={companyId} pid={t.project_id} back={back} />
          </div>
        ))}
      </div>
    </>
  );
}

/** Budget mot utfall för alla projekt: intäkter, kostnader, timmar och resultat med avvikelser */
async function BudgetVsActual({ companyId, basePath, searchParams }: ModulePageProps) {
  const projects = (await svc.listProjects(companyId, { status: searchParams.status })).filter((p) => p.details.budget_revenue || p.details.budget_cost || p.details.budget_hours);
  const row = (p: svc.ProjectOut) => {
    const d = p.details, e = p.economics;
    const budgetCost = d.budget_cost + Math.round(d.budget_hours * d.internal_rate);
    const cost = e.externalCost + e.internalCost;
    return { p, budgetRevenue: d.budget_revenue, revenue: e.revenue, budgetCost, cost, budgetResult: d.budget_revenue - budgetCost, result: e.result, budgetHours: d.budget_hours, hours: e.hoursUsed };
  };
  const rows = projects.map(row);
  const dev = (actual: number, budget: number, higherIsGood: boolean) => {
    const d = actual - budget;
    const bad = higherIsGood ? d < 0 : d > 0;
    return <span style={{ color: d === 0 ? undefined : bad ? 'var(--danger)' : 'var(--ok)' }}>{d > 0 ? '+' : ''}{kr(d)}</span>;
  };
  const tot = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  return (
    <>
      <h1>Budget mot utfall</h1>
      <p className="muted small">Utfall = fakturerat på projektet, kostnader som bokförts med projektet som dimension eller kopplats till det, och rapporterad tid × internt timpris. Endast projekt med budget visas.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Projekt</th><th className="num">Intäkt budget</th><th className="num">Intäkt utfall</th><th className="num">Avvikelse</th>
          <th className="num">Kostnad budget</th><th className="num">Kostnad utfall</th><th className="num">Avvikelse</th><th className="num">Resultat budget</th><th className="num">Resultat utfall</th><th className="num">Timmar</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.p.id}>
              <td><Link href={`${basePath}/p/${r.p.id}`}>{r.p.name}</Link></td>
              <td className="num">{kr(r.budgetRevenue)}</td><td className="num">{kr(r.revenue)}</td><td className="num">{dev(r.revenue, r.budgetRevenue, true)}</td>
              <td className="num">{kr(r.budgetCost)}</td><td className="num">{kr(r.cost)}</td><td className="num">{dev(r.cost, r.budgetCost, false)}</td>
              <td className="num">{kr(r.budgetResult)}</td><td className="num">{kr(r.result)}</td>
              <td className="num small">{hrs(r.hours)} / {hrs(r.budgetHours)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={10} className="muted">Inga projekt med budget.</td></tr>}
          {rows.length > 1 && (
            <tr className="sum"><td><b>Summa</b></td><td className="num">{kr(tot((r) => r.budgetRevenue))}</td><td className="num">{kr(tot((r) => r.revenue))}</td><td className="num">{dev(tot((r) => r.revenue), tot((r) => r.budgetRevenue), true)}</td>
              <td className="num">{kr(tot((r) => r.budgetCost))}</td><td className="num">{kr(tot((r) => r.cost))}</td><td className="num">{dev(tot((r) => r.cost), tot((r) => r.budgetCost), false)}</td>
              <td className="num">{kr(tot((r) => r.budgetResult))}</td><td className="num">{kr(tot((r) => r.result))}</td><td /></tr>
          )}
        </tbody>
      </table></div>
    </>
  );
}

export const projekt: ModuleDefinition = {
  id: 'projekt',
  name: 'Projekt',
  version: '0.1.0',
  description: 'Projektplan med budget, delmoment som faktureras, uppgifter på en tavla med tid, kostnader från bokföringen och lönsamhet per projekt. Bygger på uppdragen i tidrapporteringen.',
  nav: [{ label: 'Projekt', path: '' }, { label: 'Budget mot utfall', path: 'budget' }, { label: 'Mina uppgifter', path: 'mina-uppgifter' }],
  pages: { '': Portfolio, 'p/:id': Project, budget: BudgetVsActual, 'mina-uppgifter': MyTasks },
  scopes: [
    { scope: 'projekt:read', description: 'Läsa projekt, uppgifter, delmoment och lönsamhet' },
    { scope: 'projekt:write', description: 'Skapa och ändra projekt, uppgifter och delmoment' },
  ],
  events: [
    { type: 'projekt.task.done', description: 'En uppgift i ett projekt är klar' },
    { type: 'projekt.milestone.done', description: 'Ett delmoment i ett projekt är klart' },
  ],
  api: [
    { method: 'GET', path: '/projects', scope: 'projekt:read', tag: 'Projekt', summary: 'Lista projekt med framdrift och lönsamhet', query: [{ name: 'status', description: 'planned, active, on_hold, done' }],
      handler: async ({ actor, query }) => ({ object: 'list', has_more: false, data: await svc.listProjects(actor.companyId, { status: query.get('status') ?? undefined }) }) },
    { method: 'GET', path: '/projects/:id', scope: 'projekt:read', tag: 'Projekt', summary: 'Hämta projekt med uppgifter, delmoment och ekonomi',
      handler: ({ actor, params }) => svc.getProject(actor.companyId, Number(params.id)) },
    { method: 'POST', path: '/projects/:id/tasks', scope: 'projekt:write', tag: 'Projekt', status: 201, summary: 'Lägg till uppgift',
      body: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, description: { type: 'string' }, assignee_user_id: { type: 'integer' },
        milestone_id: { type: 'integer' }, estimate: { type: 'string', description: 'T.ex. "8" eller "1:30"' }, due_date: { type: 'string', format: 'date' } } },
      handler: async ({ actor, params, body }) => { const id = await svc.saveTask(actor, Number(params.id), null, body); return { id, object: 'projekt.task' }; } },
    { method: 'POST', path: '/projects/:id/tasks/:task/status', scope: 'projekt:write', tag: 'Projekt', summary: 'Flytta uppgift (todo, doing, done)',
      body: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['todo', 'doing', 'done'] } } },
      handler: async ({ actor, params, body }) => { await svc.setTaskStatus(actor, Number(params.id), Number(params.task), body.status as 'todo'); return svc.getProject(actor.companyId, Number(params.id)); } },
  ],
};
