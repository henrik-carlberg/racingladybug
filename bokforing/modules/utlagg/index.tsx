import Link from 'next/link';
import { sql } from '@/lib/db';
import type { ModuleDefinition, ModulePageProps } from '@/lib/modules/types';
import { kr, today } from '@/lib/format';
import { RECEIPT_CATEGORIES } from '@/lib/receipts';
import * as svc from './service';
import * as a from './actions';

const krIn = (ore: number) => (ore / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');
const STATUS: Record<string, [string, string]> = { draft: ['Utkast', ''], submitted: ['Väntar på attest', 'warn'], approved: ['Attesterad', 'ok'], rejected: ['Avslagen', 'danger'], paid: ['Utbetald', 'ok'] };
const KIND: Record<string, string> = { receipt: 'Kvitto', mileage: 'Milersättning', allowance: 'Traktamente' };

function Nav({ basePath }: { basePath: string }) {
  return <p className="small"><Link href={basePath}>Utläggsräkningar</Link> · <Link href={`${basePath}/installningar`}>Ersättningar och konton</Link></p>;
}

async function Overview({ companyId, basePath, searchParams }: ModulePageProps) {
  const [claims, emps] = await Promise.all([
    svc.listClaims(companyId, { status: searchParams.status }),
    sql<{ id: number; name: string }[]>`SELECT id, first_name || ' ' || last_name AS name FROM employees WHERE company_id = ${companyId} AND active ORDER BY last_name`,
  ]);
  const waiting = claims.filter((c) => c.status === 'submitted');
  return (
    <>
      <h1>Utlägg och reseräkningar</h1>
      <Nav basePath={basePath} />
      {waiting.length > 0 && <div className="flash ok">{waiting.length} räkningar väntar på attest ({kr(waiting.reduce((s, c) => s + c.total, 0))} kr).</div>}
      <p className="small">{[['', 'Alla'], ['draft', 'Utkast'], ['submitted', 'Väntar på attest'], ['approved', 'Att betala ut'], ['paid', 'Utbetalda']].map(([k, l], i) => (
        <span key={k}>{i > 0 && ' · '}{(searchParams.status ?? '') === k ? <b>{l}</b> : <Link href={`${basePath}${k ? `?status=${k}` : ''}`}>{l}</Link>}</span>
      ))}</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Anställd</th><th>Räkning</th><th>Skapad</th><th>Status</th><th className="num">Att ersätta</th></tr></thead>
        <tbody>{claims.map((c) => (
          <tr key={c.id}><td>{c.employee}</td><td><Link href={`${basePath}/r/${c.id}`}>{c.title}</Link></td><td>{c.created_at}</td>
            <td><span className={`badge ${STATUS[c.status][1]}`}>{STATUS[c.status][0]}</span></td><td className="num">{kr(c.total)}</td></tr>
        ))}{claims.length === 0 && <tr><td colSpan={5} className="muted">Inga utläggsräkningar.</td></tr>}</tbody>
      </table></div>
      <h2>Ny utläggsräkning</h2>
      {emps.length === 0 ? <p>Lägg först upp anställda under <Link href={`/c/${companyId}/lon/anstallda`}>Lön → Anställda</Link>. Egna utlägg som ägare i en enskild firma registrerar du som <Link href={`/c/${companyId}/kvitto`}>kvitto</Link>.</p> : (
        <form action={a.create.bind(null, companyId)} className="card row">
          <label>Anställd<select name="employee_id">{emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label style={{ flex: '2 1 240px' }}>Rubrik<input name="title" placeholder={`T.ex. Resa Göteborg ${today().slice(0, 7)}`} /></label>
          <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button>Skapa</button></div>
        </form>
      )}
    </>
  );
}

async function Claim({ companyId, actor, basePath, params }: ModulePageProps) {
  const c = await svc.getClaim(companyId, Number(params.id));
  const s = await svc.settings(sql, companyId);
  const editable = c.status === 'draft' || c.status === 'rejected';
  const runs = c.status === 'approved' ? await sql<{ id: number; period: string }[]>`SELECT id, period FROM payroll_runs WHERE company_id = ${companyId} AND status = 'draft' ORDER BY period DESC` : [];
  return (
    <>
      <div className="header">
        <h1>{c.title} <span className={`badge ${STATUS[c.status][1]}`}>{STATUS[c.status][0]}</span></h1>
        <div className="actions" style={{ margin: 0 }}><Link className="btn secondary" href={basePath}>Alla räkningar</Link></div>
      </div>
      <p className="small">{c.employee} · skapad {c.created_at} av {c.created_by}{c.submitted_at && ` · inskickad ${c.submitted_at}`}{c.approved_by && ` · attesterad av ${c.approved_by} ${c.approved_at}`}
        {c.voucher_id && <> · <Link href={`/c/${companyId}/verifikationer/${c.voucher_id}`}>verifikation</Link></>}</p>
      {c.status === 'rejected' && c.comment && <div className="flash error">Avslagen: {c.comment}</div>}
      <div className="table-wrap"><table>
        <thead><tr><th>Datum</th><th>Typ</th><th>Beskrivning</th><th className="num">Moms</th><th className="num">Belopp</th><th>Kvitto</th><th></th></tr></thead>
        <tbody>
          {c.lines.map((l) => (
            <tr key={l.id}><td>{l.date}</td><td>{KIND[l.kind]}</td>
              <td>{l.description}<div className="small muted">{l.km ? `${String(l.km).replace('.', ',')} km` : ''}{l.kind === 'allowance' ? `${l.days_full} hela, ${l.days_half} halva dagar, ${l.nights} nätter` : ''} · konto {l.account}</div></td>
              <td className="num">{l.vat ? kr(l.vat) : ''}</td><td className="num">{kr(l.amount)}</td>
              <td>{l.attachment_id ? <a href={`/c/${companyId}/underlag/${l.attachment_id}`} target="_blank">Visa</a> : l.kind === 'receipt' ? <span className="small" style={{ color: 'var(--danger)' }}>Saknas</span> : ''}</td>
              <td className="num">{editable && <form action={a.removeLine.bind(null, companyId, c.id, l.id)}><button className="link">Ta bort</button></form>}</td></tr>
          ))}
          <tr className="sum"><td colSpan={3}>Att ersätta</td><td className="num">{kr(c.vat)}</td><td className="num"><b>{kr(c.total)}</b></td><td colSpan={2}></td></tr>
        </tbody>
      </table></div>

      {editable && (<>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
          <form action={a.addLine.bind(null, companyId, c.id, 'receipt')} className="card stack">
            <b>📷 Kvitto</b>
            <label>Vad gällde det?<select name="category">{RECEIPT_CATEGORIES.filter((x) => !x.representation).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
            <div className="row"><label>Datum<input type="date" name="date" defaultValue={today()} /></label><label>Belopp inkl. moms<input name="amount" inputMode="decimal" required /></label></div>
            <label>Beskrivning<input name="description" /></label>
            <label>Kvitto (bild eller PDF)<input type="file" name="file" accept="image/*,application/pdf" capture="environment" required /></label>
            <div><button className="secondary">Lägg till kvitto</button></div>
          </form>
          <form action={a.addLine.bind(null, companyId, c.id, 'mileage')} className="card stack">
            <b>🚗 Resa med egen bil</b>
            <div className="row"><label>Datum<input type="date" name="date" defaultValue={today()} /></label><label>Kilometer<input name="km" inputMode="decimal" required /></label></div>
            <label>Från – till och syfte<input name="description" placeholder="T.ex. Kontoret – kund i Borås, möte" required /></label>
            <p className="small muted" style={{ margin: 0 }}>Skattefritt {krIn(s.mileage_rate)} kr per mil.</p>
            <div><button className="secondary">Lägg till resa</button></div>
          </form>
          <form action={a.addLine.bind(null, companyId, c.id, 'allowance')} className="card stack">
            <b>🧳 Traktamente</b>
            <div className="row"><label>Avresedag<input type="date" name="date" defaultValue={today()} /></label></div>
            <div className="row"><label>Hela dagar<input name="days_full" type="number" min={0} defaultValue={0} /></label><label>Halva dagar<input name="days_half" type="number" min={0} defaultValue={0} /></label><label>Nätter<input name="nights" type="number" min={0} defaultValue={0} /></label></div>
            <label>Resmål och syfte<input name="description" required placeholder="T.ex. Stockholm, mässa" /></label>
            <p className="small muted" style={{ margin: 0 }}>Kräver övernattning minst 50 km från vanliga verksamhetsstället. {krIn(s.allowance_full)} kr hel dag, {krIn(s.allowance_half)} kr halv dag (avresa efter 12 eller hemkomst före 19), {krIn(s.allowance_night)} kr natt.</p>
            <div><button className="secondary">Lägg till traktamente</button></div>
          </form>
        </div>
        <form action={a.submit.bind(null, companyId, c.id)} className="card actions"><button>Skicka in för attest</button><span className="small muted">Alla kvitton måste ha en bild.</span></form>
      </>)}

      {c.status === 'submitted' && actor.role === 'owner' && (
        <div className="card actions">
          <form action={a.approve.bind(null, companyId, c.id)}><button>Attestera och bokför</button></form>
          <form action={a.reject.bind(null, companyId, c.id)} style={{ display: 'flex', gap: '.4rem' }}><input name="comment" placeholder="Orsak" aria-label="Orsak" /><button className="secondary">Avslå</button></form>
        </div>
      )}
      {c.status === 'submitted' && actor.role !== 'owner' && <p className="small">Väntar på att ägaren attesterar.</p>}
      {c.status === 'approved' && (
        <div className="card stack">
          <b>Betala ut {kr(c.total)} kr</b>
          {runs.length > 0 && (
            <form action={a.payPayroll.bind(null, companyId, c.id)} className="row">
              <label>Med lönekörning<select name="run_id">{runs.map((r) => <option key={r.id} value={r.id}>{r.period}</option>)}</select></label>
              <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button>Lägg till i lönen</button></div>
            </form>
          )}
          <form action={a.payDirect.bind(null, companyId, c.id)} className="row">
            <label>Eller direkt från banken, datum<input type="date" name="date" defaultValue={today()} /></label>
            <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Bokför utbetalning</button></div>
          </form>
        </div>
      )}
      {c.status === 'paid' && <p className="small">Utbetald{c.payroll_run_id ? <> med <Link href={`/c/${companyId}/lon/${c.payroll_run_id}`}>lönekörningen</Link></> : c.paid_voucher_id ? <> – <Link href={`/c/${companyId}/verifikationer/${c.paid_voucher_id}`}>verifikation</Link></> : ''}.</p>}
    </>
  );
}

async function Settings({ companyId, basePath }: ModulePageProps) {
  const s = await svc.settings(sql, companyId);
  return (
    <>
      <h1>Ersättningar och konton</h1>
      <Nav basePath={basePath} />
      <form action={a.saveSettings.bind(null, companyId)} className="card stack">
        <div className="row">
          <label>Milersättning egen bil (kr per mil)<input name="mileage_rate" defaultValue={krIn(s.mileage_rate)} inputMode="decimal" /></label>
          <label>Traktamente hel dag (kr)<input name="allowance_full" defaultValue={krIn(s.allowance_full)} inputMode="decimal" /></label>
          <label>Halv dag (kr)<input name="allowance_half" defaultValue={krIn(s.allowance_half)} inputMode="decimal" /></label>
          <label>Natt (kr)<input name="allowance_night" defaultValue={krIn(s.allowance_night)} inputMode="decimal" /></label>
        </div>
        <div className="row">
          <label>Skuld till anställda<input name="liability_account" type="number" defaultValue={s.liability_account} /></label>
          <label>Konto milersättning<input name="mileage_account" type="number" defaultValue={s.mileage_account} /></label>
          <label>Konto traktamente<input name="allowance_account" type="number" defaultValue={s.allowance_account} /></label>
        </div>
        <div><button>Spara</button></div>
        <p className="small muted" style={{ margin: 0 }}>Standardvärdena är Skatteverkets skattefria belopp för 2026 (egen bil 25 kr/mil, inrikes traktamente 300 kr hel dag, 150 kr halv dag och 150 kr natt) – kontrollera på skatteverket.se inför varje år.
          Ersättning över de skattefria beloppen ska beskattas som lön och läggs in i lönekörningen för hand.</p>
      </form>
    </>
  );
}

export const utlagg: ModuleDefinition = {
  id: 'utlagg',
  name: 'Utlägg och reseräkningar',
  version: '0.1.0',
  description: 'Anställdas kvitton, milersättning och traktamente med skattefria belopp, attest av ägaren, bokföring mot skuld till anställda och utbetalning via lönen eller banken.',
  nav: [{ label: 'Utläggsräkningar', path: '' }, { label: 'Ersättningar', path: 'installningar' }],
  pages: { '': Overview, 'r/:id': Claim, installningar: Settings },
  scopes: [
    { scope: 'utlagg:read', description: 'Läsa utläggsräkningar' },
    { scope: 'utlagg:write', description: 'Skapa och skicka in utläggsräkningar' },
  ],
  events: [{ type: 'utlagg.claim.approved', description: 'En utläggsräkning har attesterats och bokförts' }],
  api: [
    { method: 'GET', path: '/claims', scope: 'utlagg:read', tag: 'Utlägg', summary: 'Lista utläggsräkningar', query: [{ name: 'status', description: 'draft, submitted, approved, rejected, paid' }],
      handler: async ({ actor, query }) => ({ object: 'list', has_more: false, data: await svc.listClaims(actor.companyId, { status: query.get('status') ?? undefined }) }) },
    { method: 'GET', path: '/claims/:id', scope: 'utlagg:read', tag: 'Utlägg', summary: 'Hämta utläggsräkning', handler: ({ actor, params }) => svc.getClaim(actor.companyId, Number(params.id)) },
  ],
};
