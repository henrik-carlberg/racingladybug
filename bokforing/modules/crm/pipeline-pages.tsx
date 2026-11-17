import Link from 'next/link';
import { sql } from '@/lib/db';
import type { ModulePageProps } from '@/lib/modules/types';
import { PrintButton } from '@/components/PrintButton';
import { kr, today } from '@/lib/format';
import * as pl from './pipeline';
import * as a from './actions';
import { LOST_REASONS, PIPELINE_TEMPLATES } from './calc';
import { KINDS } from './service';

const krIn = (ore: number) => (ore ? (ore / 100).toFixed(2).replace('.', ',').replace(/,00$/, '') : '');
const pct = (n: number | null) => (n == null ? '–' : `${String(n).replace('.', ',')} %`);
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const KIND_BADGE: Record<string, string> = { open: 'warn', won: 'ok', lost: '' };

export function Nav({ basePath }: { basePath: string }) {
  return <p className="small"><Link href={`${basePath}/pipeline`}>Säljpipeline</Link> · <Link href={`${basePath}/prognos`}>Prognos och analys</Link> · <Link href={basePath}>Kunder</Link> · <Link href={`${basePath}/steg`}>Pipelines och faser</Link></p>;
}

function MoveForm({ companyId, d, stages, back }: { companyId: number; d: pl.DealOut; stages: pl.Stage[]; back?: string }) {
  return (
    <form action={a.moveDeal.bind(null, companyId, d.id, back ?? null)} style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', marginTop: '.4rem' }}>
      <select name="stage_id" defaultValue={d.stage_id} aria-label={`Steg för ${d.title}`} style={{ flex: '1 1 120px', fontSize: '.85rem', padding: '.25rem' }}>
        {[...new Set(stages.map((s) => s.pipeline_id))].map((pid) => {
          const list = stages.filter((s) => s.pipeline_id === pid && (s.active || s.id === d.stage_id));
          return <optgroup key={pid} label={list[0]?.pipeline ?? ''}>{list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>;
        })}
      </select>
      <select name="lost_reason" defaultValue="" aria-label="Förlustorsak" style={{ flex: '1 1 110px', fontSize: '.85rem', padding: '.25rem' }}>
        <option value="">Orsak om förlorad</option>{LOST_REASONS.map((r) => <option key={r}>{r}</option>)}
      </select>
      <button className="secondary" style={{ padding: '.2rem .6rem' }}>Flytta</button>
    </form>
  );
}

function DealFields({ d, customers, users, stages, isNew, pipelineId }: { d?: pl.DealOut; customers: { id: number; name: string }[]; users: { id: number; name: string }[]; stages: pl.Stage[]; isNew?: boolean; pipelineId?: number }) {
  return (<>
    <div className="row">
      <label style={{ flex: '2 1 240px' }}>Affär<input name="title" defaultValue={d?.title} required placeholder="T.ex. Ny webbplats" /></label>
      <label>Kund<select name="customer_id" defaultValue={d?.customer_id ?? ''}><option value="">– Ny kund (prospekt) –</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>eller nytt företag<input name="prospect_name" defaultValue={d?.prospect_name} placeholder="Prospektets namn" /></label>
    </div>
    <div className="row">
      <label>Kontaktperson<input name="contact_name" defaultValue={d?.contact_name} /></label>
      <label>E-post<input name="contact_email" type="email" defaultValue={d?.contact_email} /></label>
      <label>Värde exkl. moms (kr)<input name="value" defaultValue={krIn(d?.value ?? 0)} inputMode="decimal" /></label>
      <label>Förväntat avslut<input type="date" name="expected_close" defaultValue={d?.expected_close ?? ''} /></label>
    </div>
    <div className="row">
      <label>Säljansvarig<select name="owner_user_id" defaultValue={d?.owner_user_id ?? ''}><option value="">Jag</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      {isNew && <input type="hidden" name="pipeline_id" value={pipelineId} />}
      {isNew && <label>Fas<select name="stage_id">{stages.filter((s) => s.kind === 'open' && s.active && s.pipeline_id === pipelineId).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.probability} %)</option>)}</select></label>}
      {!isNew && <label>Egen sannolikhet (%)<input name="probability" defaultValue={d && d.probability !== stages.find((s) => s.id === d.stage_id)?.probability ? d.probability : ''} placeholder="Stegets" inputMode="numeric" /></label>}
      <label>Källa<input name="source" defaultValue={d?.source} placeholder="T.ex. rekommendation, webb, mässa" /></label>
    </div>
    <label>Nästa steg<input name="next_step" defaultValue={d?.next_step} placeholder="T.ex. Boka demo vecka 48" /></label>
  </>);
}

export async function Pipeline({ companyId, basePath, searchParams }: ModulePageProps) {
  const owner = Number(searchParams.saljare) || undefined;
  const pipes = (await pl.pipelines(sql, companyId)).filter((x) => x.active);
  const current = pipes.find((x) => x.id === Number(searchParams.p)) ?? pipes[0];
  const [deals, stages, customers, users] = await Promise.all([
    pl.listDeals(companyId, { kind: 'open', owner, pipeline_id: current.id }), pl.stages(sql, companyId),
    sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name`, pl.users(companyId),
  ]);
  const open = stages.filter((s) => s.kind === 'open' && s.active && s.pipeline_id === current.id);
  const t = today();
  const back = `${basePath}/pipeline?p=${current.id}${owner ? `&saljare=${owner}` : ''}`;
  return (
    <>
      <div className="header"><h1>Säljpipeline: {current.name}</h1></div>
      <Nav basePath={basePath} />
      {pipes.length > 1 && (
        <div className="actions" style={{ marginBottom: '.5rem' }}>
          {pipes.map((x) => <Link key={x.id} className={`btn ${x.id === current.id ? '' : 'secondary'}`} href={`${basePath}/pipeline?p=${x.id}${owner ? `&saljare=${owner}` : ''}`}>{x.name}</Link>)}
        </div>
      )}
      <form className="row" style={{ marginBottom: '.5rem' }}>
        <input type="hidden" name="p" value={current.id} />
        <label style={{ flex: '0 1 240px' }}>Säljare<select name="saljare" defaultValue={owner ?? ''}><option value="">Alla</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Visa</button></div>
        <span className="small muted" style={{ alignSelf: 'end' }}>{deals.length} öppna affärer · {kr(deals.reduce((s, d) => s + d.value, 0))} kr · viktat {kr(deals.reduce((s, d) => s + d.weighted, 0))} kr</span>
      </form>
      <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(230px, 1fr)', gap: '.75rem', overflowX: 'auto', paddingBottom: '.5rem' }}>
        {open.map((s) => {
          const col = deals.filter((d) => d.stage_id === s.id);
          return (
            <div key={s.id} style={{ background: 'var(--bg-soft, #f3f4f6)', borderRadius: 8, padding: '.5rem' }}>
              <div style={{ fontWeight: 600 }}>{s.name} <span className="small muted">{s.probability} %</span></div>
              <div className="small muted" style={{ marginBottom: '.4rem' }}>{col.length} st · {kr(col.reduce((x, d) => x + d.value, 0))} kr</div>
              {col.map((d) => (
                <div key={d.id} className="card" style={{ margin: '0 0 .5rem', padding: '.55rem .65rem' }}>
                  <Link href={`${basePath}/affar/${d.id}`}><b>{d.title}</b></Link>
                  <div className="small">{d.account}</div>
                  <div className="small"><b>{kr(d.value)} kr</b> <span className="muted">· viktat {kr(d.weighted)}</span></div>
                  <div className="small muted">{d.owner ?? ''}{d.expected_close && <> · <span style={d.expected_close < t ? { color: 'var(--danger)' } : undefined}>avslut {d.expected_close}</span></>}</div>
                  {d.next_step && <div className="small">→ {d.next_step}</div>}
                  <MoveForm companyId={companyId} d={d} stages={stages} back={back} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <h2>Ny affär i {current.name}</h2>
      <form action={a.createDeal.bind(null, companyId)} className="card stack">
        <DealFields customers={customers} users={users} stages={stages} isNew pipelineId={current.id} />
        <div><button>Skapa affär</button></div>
      </form>
    </>
  );
}

export async function Deal({ companyId, basePath, params }: ModulePageProps) {
  const d = await pl.getDeal(companyId, Number(params.id));
  const [stages, customers, users, acts] = await Promise.all([
    pl.stages(sql, companyId), sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name`, pl.users(companyId), pl.dealActivities(companyId, d.id),
  ]);
  const [co] = await sql<{ name: string; orgnr: string; address: string; postal_code: string; city: string; email: string; phone: string; f_skatt: boolean }[]>`
    SELECT name, orgnr, address, postal_code, city, email, phone, f_skatt FROM companies WHERE id = ${companyId}`;
  const rows = [...d.lines, ...Array(Math.max(3, 10 - d.lines.length)).fill(null)].slice(0, 10) as (pl.QuoteLine | null)[];
  const editable = d.kind === 'open' && d.document_status !== 'pending';
  return (
    <>
      <div className="no-print">
        <div className="header">
          <h1>{d.title} <span className={`badge ${KIND_BADGE[d.kind]}`}>{d.pipeline}: {d.stage}</span></h1>
          <div className="actions" style={{ margin: 0 }}><Link className="btn secondary" href={`${basePath}/pipeline?p=${d.pipeline_id}`}>Pipeline</Link>{d.lines.length > 0 && <PrintButton />}</div>
        </div>
        <Nav basePath={basePath} />
        <p className="small">{d.customer_id ? <Link href={`${basePath}/kund/${d.customer_id}`}>{d.account}</Link> : <>{d.account} <span className="badge">Prospekt</span></>}
          {d.contact_name && ` · ${d.contact_name}`}{d.contact_email && ` (${d.contact_email})`} · säljare {d.owner ?? '–'}{d.source && ` · källa ${d.source}`}</p>
        <div className="grid">
          <div className="card stat"><div className="label">Värde</div><div className="value">{kr(d.value)}</div><div className="small muted">exkl. moms</div></div>
          <div className="card stat"><div className="label">Sannolikhet</div><div className="value">{d.probability} %</div><div className="small muted">viktat {kr(d.weighted)} kr</div></div>
          <div className="card stat"><div className="label">Förväntat avslut</div><div className="value" style={{ fontSize: '1.2rem' }}>{d.expected_close ?? '–'}</div>{d.closed_at && <div className="small muted">avslutad {d.closed_at}</div>}</div>
        </div>
        {d.kind === 'lost' && <div className="flash error">Förlorad {d.closed_at}: {d.lost_reason}</div>}
        {d.kind === 'won' && (
          <div className="card actions">
            <b>Vunnen {d.closed_at}</b>
            {d.invoice_id ? <Link href={`/c/${companyId}/fakturor/${d.invoice_id}`}>Visa faktura</Link> : <form action={a.invoiceDeal.bind(null, companyId, d.id)}><button>Skapa faktura</button></form>}
            {d.project_id ? <Link href={`/c/${companyId}/uppdrag/${d.project_id}`}>Visa projekt</Link> : <form action={a.projectFromDeal.bind(null, companyId, d.id)}><button className="secondary">Skapa projekt</button></form>}
          </div>
        )}
        <div className="card"><b>Fas</b> <span className="small muted">(välj en fas i en annan pipeline för att flytta affären dit)</span><MoveForm companyId={companyId} d={d} stages={stages} /></div>

        <h2>Offert</h2>
        {d.document_status && <p className="small">Offerten är {d.document_status === 'completed' ? <b>signerad av kunden</b> : d.document_status === 'pending' ? 'skickad och väntar på signering' : d.document_status}.{' '}
          {d.document_id && <Link href={`/c/${companyId}/dokument/${d.document_id}`}>Visa dokument</Link>}</p>}
        <form action={a.saveQuote.bind(null, companyId, d.id)} className="stack">
          <div className="table-wrap"><table>
            <thead><tr><th>Beskrivning</th><th className="num">Antal</th><th>Enhet</th><th className="num">À-pris (kr)</th><th>Moms</th></tr></thead>
            <tbody>{rows.map((l, i) => (
              <tr key={i}>
                <td><input name={`d_${i}`} defaultValue={l?.description} disabled={!editable} aria-label={`Rad ${i + 1} beskrivning`} /></td>
                <td className="num"><input name={`q_${i}`} defaultValue={l ? String(l.quantity).replace('.', ',') : ''} disabled={!editable} inputMode="decimal" style={{ maxWidth: '5rem', textAlign: 'right' }} aria-label={`Rad ${i + 1} antal`} /></td>
                <td><input name={`u_${i}`} defaultValue={l?.unit ?? 'st'} disabled={!editable} style={{ maxWidth: '5rem' }} aria-label={`Rad ${i + 1} enhet`} /></td>
                <td className="num"><input name={`p_${i}`} defaultValue={l ? krIn(l.unit_price) : ''} disabled={!editable} inputMode="decimal" style={{ maxWidth: '8rem', textAlign: 'right' }} aria-label={`Rad ${i + 1} pris`} /></td>
                <td><select name={`v_${i}`} defaultValue={String(l?.vat_rate ?? 25)} disabled={!editable} aria-label={`Rad ${i + 1} moms`}><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option><option value="0">0 %</option></select></td>
              </tr>
            ))}</tbody>
          </table></div>
          {editable && (<div className="row">
            <label>Giltig till<input type="date" name="valid_to" defaultValue={d.quote_valid_to ?? ''} /></label>
            <label style={{ flex: '3 1 300px' }}>Villkor och kommentar<input name="notes" defaultValue={d.quote_notes} placeholder="T.ex. Leverans inom 4 veckor från beställning. Betalning 30 dagar." /></label>
            <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Spara offert</button></div>
          </div>)}
        </form>
        {d.lines.length > 0 && <p className="small">Summa {kr(d.quote.net)} kr exkl. moms, {kr(d.quote.total)} kr inkl. moms. Affärens värde följer offerten.</p>}
        {d.kind === 'open' && d.lines.length > 0 && d.document_status !== 'pending' && (
          <form action={a.sendQuote.bind(null, companyId, d.id)} className="card actions">
            <button>Skicka offert för e-signering{d.contact_name ? ` till ${d.contact_name}` : ''}</button>
            <span className="small muted">När kunden signerar markeras affären som vunnen automatiskt.</span>
          </form>
        )}

        <h2>Aktiviteter</h2>
        <form action={a.dealActivity.bind(null, companyId, d.id)} className="card row">
          <label style={{ flex: '0 0 150px' }}>Typ<select name="kind">{Object.entries(KINDS).filter(([k]) => k !== 'system').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label style={{ flex: '3 1 260px' }}>Rubrik<input name="subject" required /></label>
          <label style={{ flex: '0 0 170px' }}>Datum (uppgift)<input type="date" name="due_date" /></label>
          <label style={{ flex: '3 1 260px' }}>Anteckning<input name="body" /></label>
          <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Spara</button></div>
        </form>
        <table><tbody>{acts.map((x) => (
          <tr key={x.id}><td className="small" style={{ whiteSpace: 'nowrap' }}>{x.created_at}</td><td><span className={`badge ${x.kind === 'system' ? '' : 'ok'}`}>{KINDS[x.kind as keyof typeof KINDS]}</span></td>
            <td><b>{x.subject}</b>{x.body && <div className="small">{x.body}</div>}{x.due_date && <div className="small">Senast {x.due_date}{x.done ? ' · klar' : ''}</div>}</td><td className="small muted">{x.created_by ?? ''}</td></tr>
        ))}{acts.length === 0 && <tr><td className="muted">Inga aktiviteter ännu.</td></tr>}</tbody></table>

        <h2>Uppgifter om affären</h2>
        <form action={a.updateDeal.bind(null, companyId, d.id)} className="card stack">
          <DealFields d={d} customers={customers} users={users} stages={stages} />
          <div><button>Spara</button></div>
        </form>
      </div>
      {d.lines.length > 0 && <div className="doc print-only" dangerouslySetInnerHTML={{ __html: pl.quoteHtml(d, co) }} />}
    </>
  );
}

export async function Forecast({ companyId, basePath, searchParams }: ModulePageProps) {
  const pipes = await pl.pipelines(sql, companyId);
  const pid = Number(searchParams.p) || undefined;
  const r = await pl.report(companyId, 6, pid);
  const max = Math.max(1, ...r.forecast.map((f) => f.value));
  const an = r.analysis;
  return (
    <>
      <h1>Prognos och analys</h1>
      <Nav basePath={basePath} />
      <p className="small">{[{ id: 0, name: 'Alla pipelines' }, ...pipes].map((x, i) => (
        <span key={x.id}>{i > 0 && ' · '}{(pid ?? 0) === x.id ? <b>{x.name}</b> : <Link href={`${basePath}/prognos${x.id ? `?p=${x.id}` : ''}`}>{x.name}</Link>}</span>
      ))}</p>
      <div className="grid">
        <div className="card stat"><div className="label">Öppen pipeline</div><div className="value">{kr(r.pipeline)}</div><div className="small muted">{r.open} affärer</div></div>
        <div className="card stat"><div className="label">Viktad pipeline</div><div className="value">{kr(r.weighted)}</div></div>
        <div className="card stat"><div className="label">Vinstandel (12 mån)</div><div className="value">{pct(an.winRate)}</div><div className="small muted">{an.won} vunna, {an.lost} förlorade</div></div>
        <div className="card stat"><div className="label">Snittaffär / säljcykel</div><div className="value">{an.avgDeal != null ? kr(an.avgDeal) : '–'}</div><div className="small muted">{an.avgCycleDays != null ? `${an.avgCycleDays} dagar i snitt` : ''}</div></div>
      </div>
      <h2>Prognos per månad</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Månad</th><th className="num">Affärer</th><th className="num">Värde</th><th className="num">Viktat</th><th></th></tr></thead>
        <tbody>{r.forecast.map((f) => (
          <tr key={f.month}><td>{MONTHS[Number(f.month.slice(5)) - 1]} {f.month.slice(0, 4)}</td><td className="num">{f.count || ''}</td><td className="num">{kr(f.value)}</td><td className="num"><b>{kr(f.weighted)}</b></td>
            <td style={{ minWidth: 160 }}><div style={{ position: 'relative', height: 10, width: `${(f.value / max) * 100}%`, background: 'var(--border)', borderRadius: 3 }}>
              <div style={{ position: 'absolute', inset: 0, width: `${f.value ? (f.weighted / f.value) * 100 : 0}%`, background: 'var(--ok)', borderRadius: 3 }} /></div></td></tr>
        ))}</tbody>
      </table></div>
      <p className="small muted">Viktat värde = värde × sannolikhet. Affärer med passerat eller saknat avslutsdatum räknas till innevarande månad.</p>
      {(r.overdue.length > 0 || r.stale.length > 0) && (
        <div className="card">
          <b>Behöver uppmärksamhet</b>
          <ul className="small">
            {r.overdue.map((d) => <li key={`o${d.id}`}><Link href={`${basePath}/affar/${d.id}`}>{d.title}</Link> – förväntat avslut {d.expected_close} har passerat</li>)}
            {r.stale.filter((d) => !r.overdue.includes(d)).map((d) => <li key={`s${d.id}`}><Link href={`${basePath}/affar/${d.id}`}>{d.title}</Link> – ingen aktivitet sedan {d.updated_at}</li>)}
          </ul>
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
        <div><h2>Per säljare</h2><div className="table-wrap"><table>
          <thead><tr><th>Säljare</th><th className="num">Vunna</th><th className="num">Förlorade</th><th className="num">Vinstandel</th><th className="num">Vunnet värde</th></tr></thead>
          <tbody>{an.owners.map((o) => <tr key={o.owner}><td>{o.owner}</td><td className="num">{o.won}</td><td className="num">{o.lost}</td><td className="num">{pct(o.winRate)}</td><td className="num">{kr(o.value)}</td></tr>)}
            {an.owners.length === 0 && <tr><td colSpan={5} className="muted">Inga avslutade affärer ännu.</td></tr>}</tbody>
        </table></div></div>
        <div><h2>Förlustorsaker</h2><div className="table-wrap"><table>
          <tbody>{an.reasons.map((x) => <tr key={x.reason}><td>{x.reason}</td><td className="num">{x.n}</td></tr>)}
            {an.reasons.length === 0 && <tr><td className="muted">Inga förlorade affärer.</td></tr>}</tbody>
        </table></div></div>
      </div>
    </>
  );
}

export async function Stages({ companyId, basePath }: ModulePageProps) {
  const [pipes, stages] = await Promise.all([pl.pipelines(sql, companyId), pl.stages(sql, companyId)]);
  const kindLabel = { open: 'Öppen', won: 'Vunnen', lost: 'Förlorad' };
  return (
    <>
      <h1>Pipelines och faser</h1>
      <Nav basePath={basePath} />
      <p className="small">Ha en pipeline per typ av försäljning, till exempel nyförsäljning, merförsäljning, avtalsförnyelse eller upphandlingar, var och en med egna faser.
        Sannolikheten per fas används i den viktade prognosen. Varje pipeline har alltid faserna Vunnen och Förlorad.</p>
      {pipes.map((pp) => (
        <div key={pp.id} className="card stack" style={pp.active ? undefined : { opacity: 0.6 }}>
          <form action={a.savePipeline.bind(null, companyId, pp.id)} className="row" style={{ alignItems: 'center' }}>
            <input name="position" defaultValue={pp.position} inputMode="numeric" aria-label="Ordning" style={{ maxWidth: '5rem' }} />
            <input name="name" defaultValue={pp.name} aria-label="Pipelinens namn" style={{ flex: 2, fontWeight: 600 }} />
            <label className="check"><input type="checkbox" name="active" defaultChecked={pp.active} /> Aktiv</label>
            <button className="link">Spara pipeline</button>
            <Link className="small" href={`${basePath}/pipeline?p=${pp.id}`}>Öppna</Link>
          </form>
          <div className="table-wrap"><table>
            <thead><tr><th>Ordning</th><th>Fas</th><th>Sannolikhet %</th><th>Typ</th><th>Aktiv</th><th></th></tr></thead>
            <tbody>{stages.filter((x) => x.pipeline_id === pp.id).map((x) => (
              <tr key={x.id}><td colSpan={6}>
                <form action={a.saveStage.bind(null, companyId, x.id)} className="row" style={{ alignItems: 'center' }}>
                  <input name="position" defaultValue={x.position} inputMode="numeric" aria-label="Ordning" style={{ maxWidth: '5rem' }} />
                  <input name="name" defaultValue={x.name} aria-label="Fas" style={{ flex: 2 }} />
                  <input name="probability" defaultValue={x.probability} inputMode="numeric" aria-label="Sannolikhet" style={{ maxWidth: '5rem' }} />
                  <span className="small">{kindLabel[x.kind]}</span>
                  <label className="check"><input type="checkbox" name="active" defaultChecked={x.active} disabled={x.kind !== 'open'} /> Aktiv</label>
                  <button className="link">Spara</button>
                </form>
              </td></tr>
            ))}</tbody>
          </table></div>
          <form action={a.saveStage.bind(null, companyId, null)} className="row">
            <input type="hidden" name="pipeline_id" value={pp.id} />
            <label>Ordning<input name="position" inputMode="numeric" defaultValue={35} /></label>
            <label style={{ flex: '2 1 240px' }}>Ny fas i {pp.name}<input name="name" required placeholder="T.ex. Demo genomförd" /></label>
            <label>Sannolikhet (%)<input name="probability" inputMode="numeric" defaultValue={40} /></label>
            <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Lägg till fas</button></div>
          </form>
        </div>
      ))}
      <h2>Ny pipeline</h2>
      <form action={a.createPipeline.bind(null, companyId)} className="card row">
        <label style={{ flex: '2 1 240px' }}>Namn<input name="name" required placeholder="T.ex. Avtalsförnyelse" /></label>
        <label style={{ flex: '2 1 240px' }}>Börja från mall<select name="template">{Object.entries(PIPELINE_TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button>Skapa pipeline</button></div>
      </form>
    </>
  );
}

/** Affärer för en kund (visas på kundsidan) */
export async function CustomerDeals({ companyId, customerId, basePath }: { companyId: number; customerId: number; basePath: string }) {
  const deals = await pl.listDeals(companyId, { customer_id: customerId });
  if (!deals.length) return null;
  return (<>
    <h2>Affärer</h2>
    <table><tbody>{deals.map((d) => (
      <tr key={d.id}><td><Link href={`${basePath}/affar/${d.id}`}>{d.title}</Link></td><td><span className={`badge ${KIND_BADGE[d.kind]}`}>{d.stage}</span></td><td className="num">{kr(d.value)}</td><td className="small">{d.expected_close ?? ''}</td></tr>
    ))}</tbody></table>
  </>);
}
