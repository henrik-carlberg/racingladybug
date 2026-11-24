import Link from 'next/link';
import { sql } from '@/lib/db';
import type { ModuleDefinition, ModulePageProps } from '@/lib/modules/types';
import { kr, today } from '@/lib/format';
import * as svc from './service';
import { STATUS_LABEL, type ReviewOut } from './service';
import { apply, approve, cancel, create, evenly, letters, reopen, retro, saveAnalysis, saveProposals, setLevel } from './actions';

const pct = (n: number) => `${String(n).replace('.', ',')} %`;
const krInput = (ore: number) => (ore / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');
const DOC: Record<string, string> = { draft: 'Utkast', pending: 'Skickat', completed: 'Bekräftat', declined: 'Avböjt', cancelled: 'Återkallat' };
const badge = (s: string) => (s === 'applied' ? 'ok' : s === 'approved' ? 'warn' : s === 'cancelled' ? '' : '');

function Budget({ r }: { r: ReviewOut }) {
  const s = r.summary;
  return (
    <div className="grid">
      <div className="card stat"><div className="label">Lönesumma per månad</div><div className="value">{kr(s.payroll)}</div><div className="small muted">{r.items.length} medarbetare</div></div>
      <div className="card stat"><div className="label">Utrymme ({pct(r.budget_percent)})</div><div className="value">{kr(s.budget)}</div></div>
      <div className="card stat"><div className="label">Fördelat</div><div className="value">{kr(s.allocated)}</div><div className="small muted">{pct(s.percent)} · {s.raised} får höjning · {pct(s.minPercent)}–{pct(s.maxPercent)}</div></div>
      <div className="card stat"><div className="label">Kvar att fördela</div><div className="value" style={s.left < 0 ? { color: 'var(--danger)' } : undefined}>{kr(s.left)}</div>
        {s.left < 0 && <div className="small" style={{ color: 'var(--danger)' }}>Över budget</div>}</div>
    </div>
  );
}

// ---------- Sidor ----------

async function Overview({ companyId, basePath }: ModulePageProps) {
  const reviews = await svc.listReviews(companyId);
  const history = await svc.salaryHistory(companyId);
  return (
    <>
      <div className="header">
        <h1>Lönerevision</h1>
        <div className="actions" style={{ margin: 0 }}>
          <Link className="btn" href={`${basePath}/ny`}>Ny lönerevision</Link>
          <Link className="btn secondary" href={`${basePath}/kartlaggning`}>Lönekartläggning</Link>
        </div>
      </div>
      <p className="muted small">Planera årets löneöversyn: sätt ett utrymme, lägg förslag per medarbetare, låt ägaren godkänna, skicka lönebesked och för över de nya lönerna till lönen – med retroaktiv lön om revisionen blir klar sent.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Lönerevision</th><th>Gäller från</th><th>Status</th><th className="num">Utrymme</th><th className="num">Fördelat</th><th className="num">Medarbetare</th></tr></thead>
        <tbody>
          {reviews.map((r) => (
            <tr key={r.id}>
              <td><Link href={`${basePath}/revision/${r.id}`}>{r.name}</Link></td><td>{r.effective_date}</td>
              <td><span className={`badge ${badge(r.status)}`}>{STATUS_LABEL[r.status]}</span></td>
              <td className="num">{pct(r.budget_percent)}</td><td className="num">{pct(r.summary.percent)}</td><td className="num">{r.items.length}</td>
            </tr>
          ))}
          {reviews.length === 0 && <tr><td colSpan={6} className="muted">Ingen lönerevision ännu.</td></tr>}
        </tbody>
      </table></div>
      {history.length > 0 && (<>
        <h2>Lönehistorik</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Medarbetare</th><th>Från</th><th className="num">Tidigare</th><th className="num">Ny lön</th><th className="num">Höjning</th><th>Källa</th></tr></thead>
          <tbody>{history.map((h, i) => (
            <tr key={i}><td>{h.employee_name}</td><td>{h.effective_date}</td><td className="num">{kr(h.old_salary)}</td><td className="num">{kr(h.new_salary)}</td>
              <td className="num">{kr(h.new_salary - h.old_salary)}</td><td className="small">{h.review ?? ''}</td></tr>
          ))}</tbody>
        </table></div>
      </>)}
    </>
  );
}

async function NewReview({ companyId }: ModulePageProps) {
  const [{ n, total }] = await sql<{ n: number; total: number }[]>`SELECT count(*)::int AS n, COALESCE(SUM(monthly_salary), 0)::bigint AS total
    FROM employees WHERE company_id = ${companyId} AND active AND monthly_salary > 0`;
  const y = Number(today().slice(0, 4)) + (today().slice(5, 7) > '04' ? 1 : 0);
  return (
    <>
      <h1>Ny lönerevision</h1>
      <form action={create.bind(null, companyId)} className="card stack" style={{ maxWidth: 760 }}>
        <div className="row">
          <label style={{ flex: '2 1 240px' }}>Namn<input name="name" defaultValue={`Lönerevision ${y}`} /></label>
          <label>Nya löner gäller från<input type="date" name="effective_date" defaultValue={`${y}-04-01`} required /></label>
          <label>Utrymme (% av lönesumman)<input name="budget_percent" defaultValue="3,0" inputMode="decimal" required /></label>
        </div>
        <label>Lönekriterier och riktlinjer (valfritt – visas i lönebeskedet)
          <textarea name="criteria" rows={3} placeholder="T.ex. Lönen sätts utifrån ansvar, resultat, kompetens och samarbete." />
        </label>
        <div><button>Skapa lönerevision</button></div>
        <p className="small muted" style={{ margin: 0 }}>{n} aktiva medarbetare med en lönesumma på {kr(Number(total))} kr per månad tas med. Har ni kollektivavtal anger det ofta ett lägsta utrymme och från vilket datum de nya lönerna gäller.</p>
      </form>
    </>
  );
}

async function Review({ companyId, actor, params, basePath }: ModulePageProps) {
  const r = await svc.getReview(companyId, Number(params.id));
  const planning = r.status === 'planning';
  const runs = r.status === 'applied'
    ? await sql<{ id: number; period: string }[]>`SELECT id, period FROM payroll_runs WHERE company_id = ${companyId} AND status = 'draft' ORDER BY period DESC`
    : [];
  const retroTotal = r.items.reduce((s, i) => s + (i.retro_paid_run ? 0 : i.retro_amount), 0);
  const isOwner = actor.role === 'owner';
  const future = r.effective_date > today();
  return (
    <>
      <div className="header">
        <h1>{r.name} <span className={`badge ${badge(r.status)}`}>{STATUS_LABEL[r.status]}</span></h1>
        <div className="actions" style={{ margin: 0 }}><Link className="btn secondary" href={basePath}>Alla lönerevisioner</Link></div>
      </div>
      <p className="small muted">Nya löner gäller från <b>{r.effective_date}</b>. Skapad av {r.created_by}{r.approved_by ? ` · godkänd av ${r.approved_by} ${r.approved_at}` : ''}{r.applied_at ? ` · genomförd ${r.applied_at}` : ''}.</p>
      <Budget r={r} />

      {planning && (
        <form action={evenly.bind(null, companyId, r.id)} className="card row">
          <label>Lägg samma höjning på alla (%)<input name="percent" defaultValue={String(r.budget_percent).replace('.', ',')} inputMode="decimal" /></label>
          <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Fördela</button></div>
          <span className="small muted" style={{ alignSelf: 'end', flex: '2 1 260px' }}>En utgångspunkt – justera sedan individuellt utifrån lönekriterierna.</span>
        </form>
      )}

      <form action={saveProposals.bind(null, companyId, r.id)} className="stack">
        <div className="table-wrap"><table>
          <thead><tr><th>Medarbetare</th><th className="num">Nuvarande</th><th className="num">Ny lön (kr)</th>{planning && <th className="num">eller %</th>}<th className="num">Höjning</th><th>Motivering</th>{!planning && <th>Lönebesked</th>}</tr></thead>
          <tbody>{r.items.map((i) => (
            <tr key={i.employee_id}>
              <td>{i.employee_name}<div className="small muted">{[i.title, i.department].filter(Boolean).join(' · ')}</div>
                <input type="hidden" name="employee_id" value={i.employee_id} /></td>
              <td className="num">{kr(i.current_salary)}</td>
              <td className="num">{planning ? <input name={`new_${i.employee_id}`} defaultValue={krInput(i.new_salary)} inputMode="decimal" aria-label={`Ny lön ${i.employee_name}`} style={{ maxWidth: '8rem', textAlign: 'right' }} /> : kr(i.new_salary)}</td>
              {planning && <td className="num"><input name={`percent_${i.employee_id}`} placeholder="%" inputMode="decimal" aria-label={`Höjning i procent ${i.employee_name}`} style={{ maxWidth: '4.5rem', textAlign: 'right' }} /></td>}
              <td className="num" style={i.increase < 0 ? { color: 'var(--danger)' } : undefined}>{kr(i.increase)}<div className="small muted">{pct(i.percent)}</div></td>
              <td>{planning ? <input name={`comment_${i.employee_id}`} defaultValue={i.comment} aria-label={`Motivering ${i.employee_name}`} /> : <span className="small">{i.comment}</span>}</td>
              {!planning && <td className="small">{i.document_status ? DOC[i.document_status] ?? i.document_status : '–'}</td>}
            </tr>
          ))}</tbody>
        </table></div>
        {planning && (
          <div className="card stack">
            <div className="row">
              <label>Utrymme (% av lönesumman)<input name="budget_percent" defaultValue={String(r.budget_percent).replace('.', ',')} inputMode="decimal" /></label>
              <label style={{ flex: '3 1 300px' }}>Lönekriterier<input name="criteria" defaultValue={r.criteria} /></label>
            </div>
            <div><button>Spara förslag</button></div>
          </div>
        )}
      </form>

      {planning && (
        <div className="card actions">
          {isOwner
            ? <form action={approve.bind(null, companyId, r.id)}><button>Godkänn lönerevisionen</button></form>
            : <span className="small">Ägaren godkänner lönerevisionen när förslagen är klara.</span>}
          <form action={cancel.bind(null, companyId, r.id)}><button className="link">Avbryt revisionen</button></form>
        </div>
      )}

      {r.status === 'approved' && (
        <div className="card stack">
          <b>Nästa steg</b>
          <div className="actions" style={{ margin: 0 }}>
            <form action={letters.bind(null, companyId, r.id)}><button className="secondary">Skicka lönebesked för e-signering</button></form>
            <form action={apply.bind(null, companyId, r.id)}><button>Genomför – för över nya löner till lönen</button></form>
            <form action={reopen.bind(null, companyId, r.id)}><button className="link">Återöppna</button></form>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Lönebeskedet visar ny lön, höjning och motivering och skickas till medarbetarens e-post för bekräftelse.
            {future ? ` Genomför när lönekörningen för ${r.effective_date.slice(0, 7)} ska göras – lönen i lönekörningar ändras direkt.` : ' Har lön redan betalats ut för månader efter att de nya lönerna gäller räknas retroaktiv lön fram.'}</p>
        </div>
      )}

      {r.status === 'applied' && (
        <div className="card stack">
          <b>Retroaktiv lön</b>
          {r.items.some((i) => i.retro_amount > 0) ? (<>
            <div className="table-wrap"><table>
              <thead><tr><th>Medarbetare</th><th className="num">Retroaktiv lön</th><th>Utbetalning</th></tr></thead>
              <tbody>{r.items.filter((i) => i.retro_amount > 0).map((i) => (
                <tr key={i.employee_id}><td>{i.employee_name}</td><td className="num">{kr(i.retro_amount)}</td><td className="small">{i.retro_paid_run ? 'Inlagd i lönekörning' : 'Ej utbetald'}</td></tr>
              ))}</tbody>
            </table></div>
            {retroTotal > 0 && (runs.length ? (
              <form action={retro.bind(null, companyId, r.id)} className="row">
                <label>Lönekörning<select name="run_id">{runs.map((x) => <option key={x.id} value={x.id}>{x.period}</option>)}</select></label>
                <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button>Lägg in retroaktiv lön ({kr(retroTotal)} kr)</button></div>
              </form>
            ) : <p className="small">Skapa en <Link href={`/c/${companyId}/lon`}>lönekörning</Link> och lägg sedan in den retroaktiva lönen här.</p>)}
          </>) : <p className="small">Ingen retroaktiv lön – de nya lönerna gäller från och med nästa lönekörning.</p>}
          <div><form action={letters.bind(null, companyId, r.id)}><button className="link">Skicka lönebesked som inte har skickats</button></form></div>
        </div>
      )}
    </>
  );
}

async function Mapping({ companyId, basePath }: ModulePageProps) {
  const m = await svc.payMapping(companyId);
  const table = (kind: 'equal' | 'equivalent', title: string, groups: typeof m.groups) => <>
    <h2>{title}</h2>
    <div className="table-wrap"><table className={`ps-${kind}`}>
      <thead><tr><th>Grupp</th><th className="num">Kvinnor</th><th className="num">Snittlön kvinnor</th><th className="num">Män</th><th className="num">Snittlön män</th><th className="num">Kvinnors lön av mäns</th><th>Analys</th></tr></thead>
      <tbody>
        {groups.map((g) => (
          <tr key={g.group} className="ps-group" data-key={g.group} data-flag={g.flag ? '1' : '0'}>
            <td>{g.group}</td>
            <td className="num">{g.women}</td><td className="num">{g.women >= 2 || (g.women === 1 && g.men === 0) ? kr(g.avgWomen) : g.women ? '–' : ''}</td>
            <td className="num">{g.men}</td><td className="num">{g.men >= 2 || (g.men === 1 && g.women === 0) ? kr(g.avgMen) : g.men ? '–' : ''}</td>
            <td className="num" style={g.flag ? { color: 'var(--danger)' } : undefined}>{g.ratio != null ? (g.women >= 2 && g.men >= 2 ? pct(g.ratio) : g.flag ? 'skillnad' : '') : ''}</td>
            <td className="small ps-analysis">{g.analysis ? <>{g.analysis.objective ? 'Saklig: ' : 'Osaklig: '}{g.analysis.cause}{g.analysis.action && ` · åtgärd: ${g.analysis.action}`}{g.analysis.due_date && ` senast ${g.analysis.due_date}`}</>
              : g.flag ? <form action={saveAnalysis.bind(null, companyId)} className="stack" style={{ gap: '.25rem' }}>
                <input type="hidden" name="kind" value={kind} /><input type="hidden" name="group_key" value={g.group} />
                <select name="objective"><option value="yes">Skillnaden har sakliga skäl</option><option value="no">Skillnaden är osaklig – åtgärd krävs</option></select>
                <input name="cause" placeholder="Orsak (erfarenhet, marknad, prestation …)" required /><input name="action" placeholder="Åtgärd" /><input type="date" name="due_date" aria-label="Åtgärdad senast" />
                <button className="link">Spara analys</button></form> : ''}</td>
          </tr>
        ))}
        {groups.length === 0 && <tr><td colSpan={7} className="muted">{kind === 'equal' ? 'Inga aktiva anställda med månadslön.' : 'Ange kravnivå per medarbetare nedan.'}</td></tr>}
      </tbody>
    </table></div></>;
  return (
    <>
      <div className="header">
        <h1>Lönekartläggning {m.year}</h1>
        <div className="actions" style={{ margin: 0 }}><Link className="btn secondary" href={basePath}>Lönerevision</Link></div>
      </div>
      <p className="small">Arbetsgivare ska varje år kartlägga och analysera löner för att upptäcka osakliga skillnader mellan kvinnor och män (diskrimineringslagen 3 kap. 8–12 §§).
        Med minst tio anställda ska arbetet dokumenteras. Lika arbete jämförs per befattning (från HR-modulen eller medarbetarens befattning) och likvärdigt arbete per kravnivå 1–6 enligt en arbetsvärdering.
        Skillnader där kvinnors lön är under 95 % av mäns (eller tvärtom) flaggas och ska analyseras: har de sakliga skäl, eller krävs en åtgärd som ska vara genomförd inom tre år?</p>
      {m.open > 0 && <div className="card small ps-open">{m.open} {m.open === 1 ? 'skillnad saknar' : 'skillnader saknar'} analys.</div>}
      {table('equal', 'Lika arbete (befattning)', m.groups)}
      {table('equivalent', 'Likvärdigt arbete (kravnivå)', m.equivalent)}
      <h2>Kravnivå per medarbetare</h2>
      <div className="table-wrap"><table className="small"><tbody>{m.people.map((e) => <tr key={e.id} className="ps-emp" data-name={e.name}><td>{e.name}</td><td>{e.title}</td>
        <td><form action={setLevel.bind(null, companyId, e.id)} className="row" style={{ gap: '.25rem' }}><input name="title" placeholder="Befattning (om HR-modulen inte används)" /><select name="job_level" defaultValue={e.level ?? ''}><option value="">Kravnivå</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select><button className="link">Spara</button></form></td></tr>)}</tbody></table></div>
      <p className="small muted">Snittlön visas bara när gruppen har minst två personer av samma kön, så att enskildas löner inte kan utläsas. Kön hämtas från personnumret.</p>
    </>
  );
}

const P = { type: 'object' } as const;

export const lonerevision: ModuleDefinition = {
  id: 'lonerevision',
  name: 'Lönerevision',
  version: '0.1.0',
  description: 'Årlig lönerevision med utrymme, förslag per medarbetare, godkännande, lönebesked som e-signeras, retroaktiv lön och underlag för lönekartläggning.',
  nav: [
    { label: 'Lönerevision', path: '' },
    { label: 'Lönekartläggning', path: 'kartlaggning' },
  ],
  pages: { '': Overview, ny: NewReview, 'revision/:id': Review, kartlaggning: Mapping },
  scopes: [
    { scope: 'lonerevision:read', description: 'Läsa lönerevisioner, lönehistorik och lönekartläggning' },
    { scope: 'lonerevision:write', description: 'Skapa och ändra lönerevisioner, godkänna (ägarens nyckel) och genomföra' },
  ],
  events: [
    { type: 'lonerevision.approved', description: 'En lönerevision har godkänts' },
    { type: 'lonerevision.applied', description: 'En lönerevision har genomförts och de nya lönerna förts över till lönen' },
  ],
  api: [
    { method: 'GET', path: '/reviews', scope: 'lonerevision:read', tag: 'Lönerevision', summary: 'Lista lönerevisioner',
      handler: async ({ actor }) => ({ object: 'list', has_more: false, data: await svc.listReviews(actor.companyId) }) },
    { method: 'GET', path: '/reviews/:id', scope: 'lonerevision:read', tag: 'Lönerevision', summary: 'Hämta lönerevision med förslag och budget',
      handler: ({ actor, params }) => svc.getReview(actor.companyId, Number(params.id)) },
    { method: 'POST', path: '/reviews', scope: 'lonerevision:write', tag: 'Lönerevision', status: 201, summary: 'Skapa lönerevision (alla aktiva anställda tas med)',
      body: { type: 'object', required: ['effective_date'], properties: { name: { type: 'string' }, effective_date: { type: 'string', format: 'date' }, budget_percent: { type: 'number' }, criteria: { type: 'string' } } },
      handler: ({ actor, body }) => svc.createReview(actor, body) },
    { method: 'POST', path: '/reviews/:id/proposals', scope: 'lonerevision:write', tag: 'Lönerevision', summary: 'Spara förslag (new_salary i öre eller percent)',
      body: { type: 'object', required: ['items'], properties: { budget_percent: { type: 'number' }, criteria: { type: 'string' },
        items: { type: 'array', items: { type: 'object', required: ['employee_id'], properties: { employee_id: { type: 'integer' }, new_salary: { type: 'integer' }, percent: { type: 'number' }, comment: { type: 'string' } } } } } },
      handler: ({ actor, params, body }) => svc.saveProposals(actor, Number(params.id), body) },
    { method: 'POST', path: '/reviews/:id/approve', scope: 'lonerevision:write', tag: 'Lönerevision', summary: 'Godkänn (kräver att nyckeln skapats av ägaren)', body: P,
      handler: async ({ actor, params }) => {
        const [m] = await sql<{ role: string }[]>`SELECT role FROM memberships WHERE company_id = ${actor.companyId} AND user_id = ${actor.userId}`;
        return svc.approveReview({ ...actor, role: m?.role === 'owner' ? 'owner' : actor.role }, Number(params.id));
      } },
    { method: 'POST', path: '/reviews/:id/apply', scope: 'lonerevision:write', tag: 'Lönerevision', summary: 'Genomför: nya löner till lönen och retroaktiv lön', body: P,
      handler: ({ actor, params }) => svc.applyReview(actor, Number(params.id)) },
    { method: 'GET', path: '/pay-mapping', scope: 'lonerevision:read', tag: 'Lönerevision', summary: 'Underlag för lönekartläggning per befattning och kön',
      handler: ({ actor }) => svc.payMapping(actor.companyId) },
  ],
};
