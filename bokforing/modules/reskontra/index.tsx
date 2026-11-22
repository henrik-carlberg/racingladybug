import { collectionConfigured } from '@/lib/server/collection';
import { smsConfigured } from '@/lib/server/sms';
import Link from 'next/link';
import type { ModuleDefinition, ModulePageProps } from '@/lib/modules/types';
import { PrintButton } from '@/components/PrintButton';
import { kr, today } from '@/lib/format';
import { mailConfigured } from '@/lib/server/mail';
import { getCustomer } from '@/lib/services/customers';
import * as svc from './service';
import * as a from './actions';
import { BUCKETS } from './calc';

const krIn = (ore: number) => (ore / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');
const ACTION: Record<string, string> = { reminder1: 'Påminnelse 1', reminder2: 'Påminnelse 2', collection: 'Inkasso?' };

function Nav({ basePath }: { basePath: string }) {
  return <p className="small"><Link href={basePath}>Kundreskontra</Link> · <Link href={`${basePath}/paminnelser`}>Skickade påminnelser</Link> · <Link href={`${basePath}/installningar`}>Inställningar</Link></p>;
}

async function Overview({ companyId, basePath }: ModulePageProps) {
  const r = await svc.agingReport(companyId);
  const s = await svc.settings((await import('@/lib/db')).sql, companyId);
  const due = r.open.filter((i) => i.action === 'reminder1' || i.action === 'reminder2');
  const mail = mailConfigured();
  const api = collectionConfigured();
  const cases = await svc.collections(companyId);
  const caseOf = new Map(cases.map((c) => [c.invoice_id, c]));
  return (
    <>
      <h1>Kundreskontra och påminnelser</h1>
      <Nav basePath={basePath} />
      {s.reference_rate == null && <div className="flash error">Ange Riksbankens referensränta under <Link href={`${basePath}/installningar`}>Inställningar</Link> för att räkna dröjsmålsränta.</div>}
      <div className="grid">
        {BUCKETS.map((b) => <div key={b.key} className="card stat"><div className="label">{b.label}</div><div className="value" style={b.key !== 'current' && r.total[b.key] ? { color: 'var(--danger)' } : undefined}>{kr(r.total[b.key])}</div></div>)}
      </div>
      {due.length > 0 && (
        <form action={a.remindAll.bind(null, companyId)} className="card row">
          <span style={{ flex: '3 1 300px' }}><b>{due.length} fakturor ska påminnas</b> enligt era inställningar ({s.first_days} respektive {s.second_days} dagar efter förfallodagen).</span>
          <label className="check"><input type="checkbox" name="email" defaultChecked={mail} disabled={!mail} /> Skicka med e-post{!mail && ' (e-post ej konfigurerad)'}</label>
          <div style={{ flex: '0 0 auto' }}><button>Skapa {due.length} påminnelser</button></div>
        </form>
      )}
      <h2>Per kund</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Kund</th>{BUCKETS.map((b) => <th key={b.key} className="num">{b.label}</th>)}<th className="num">Totalt</th></tr></thead>
        <tbody>{r.customers.map((c) => (
          <tr key={c.customer_id}><td><Link href={`${basePath}/kund/${c.customer_id}`}>{c.customer}</Link></td>{BUCKETS.map((b) => <td key={b.key} className="num">{c[b.key] ? kr(c[b.key]) : ''}</td>)}<td className="num"><b>{kr(c.total)}</b></td></tr>
        ))}{r.customers.length === 0 && <tr><td colSpan={7} className="muted">Inga obetalda fakturor.</td></tr>}</tbody>
      </table></div>
      <h2>Obetalda fakturor</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Faktura</th><th>Kund</th><th>Förföll</th><th className="num">Dagar sen</th><th className="num">Belopp</th><th className="num">Ränta hittills</th><th>Påminnelser</th><th>Nästa steg</th></tr></thead>
        <tbody>{r.open.map((i) => (
          <tr key={i.id}>
            <td><Link href={`/c/${companyId}/fakturor/${i.id}`}>{i.number}</Link></td><td>{i.customer}</td><td>{i.due_date}</td>
            <td className="num" style={i.days_overdue > 0 ? { color: 'var(--danger)' } : undefined}>{i.days_overdue || ''}</td><td className="num">{kr(i.total)}</td>
            <td className="num">{i.interest ? kr(i.interest) : ''}</td>
            <td className="small">{i.disputed ? <span className="badge warn">Tvist – pausad</span> : i.in_collection ? <span className="badge danger">Inkasso</span> : i.levels.length ? `${i.levels.length} st, senast ${i.last_reminder}` : ''}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {!i.disputed && (i.action === 'reminder1' || i.action === 'reminder2' || (i.days_overdue > 0 && !i.in_collection && i.levels.length < 2)) && (
                <form action={a.remind.bind(null, companyId, i.id, basePath)} style={{ display: 'inline' }}>
                  {mail && i.email && <input type="hidden" name="email" value="on" />}
                  <button className="link">{i.levels.includes(1) ? 'Påminnelse 2' : 'Påminnelse 1'}{mail && i.email ? ' (e-post)' : ''}</button>
                </form>
              )}
              {api && !i.disputed && i.days_overdue > 0 && !caseOf.get(i.id)?.case_id && (i.action === 'collection' || i.in_collection) && <form action={a.handOver.bind(null, companyId, i.id)} style={{ display: 'inline', marginLeft: '.5rem' }}><button className="link">Skicka till inkassobolaget</button></form>}
              {i.action === 'collection' && <form action={a.collection.bind(null, companyId, i.id, true)} style={{ display: 'inline', marginLeft: '.5rem' }}><input type="hidden" name="note" value="" /><button className="link">Markera för inkasso</button></form>}
              {i.in_collection && caseOf.get(i.id)?.case_id && !['recalled', 'closed', 'paid'].includes(caseOf.get(i.id)?.status ?? '') && <form action={a.recall.bind(null, companyId, i.id)} style={{ display: 'inline' }}><button className="link">Återkalla</button></form>}
              {i.in_collection && !caseOf.get(i.id)?.case_id && <form action={a.collection.bind(null, companyId, i.id, false)} style={{ display: 'inline' }}><button className="link">Ta bort inkasso</button></form>}
              {!i.action && !i.in_collection && i.days_overdue <= 0 && <span className="small muted">{ACTION[i.action ?? ''] ?? '–'}</span>}
            </td>
          </tr>
        ))}{r.open.length === 0 && <tr><td colSpan={8} className="muted">Alla fakturor är betalda. 🎉</td></tr>}</tbody>
      </table></div>
      {cases.some((c) => c.case_id) && (<>
        <h2>Hos inkassobolaget</h2>
        <div className="table-wrap"><table className="collection-cases">
          <thead><tr><th>Faktura</th><th>Kund</th><th>Lämnad</th><th>Ärende</th><th>Status</th><th className="num">Inbetalt</th></tr></thead>
          <tbody>{cases.filter((c) => c.case_id).map((c) => (
            <tr key={c.invoice_id}><td><Link href={`/c/${companyId}/fakturor/${c.invoice_id}`}>{c.number}</Link></td><td>{c.customer}</td><td>{c.date}</td><td className="small">{c.case_id}</td>
              <td><span className={`badge ${c.status === 'paid' ? 'ok' : c.status === 'recalled' || c.status === 'closed' ? '' : 'warn'}`}>{c.label}</span>{c.status_text && <div className="small muted">{c.status_text}</div>}</td>
              <td className="num">{c.collected != null ? kr(c.collected) : ''}</td></tr>
          ))}</tbody>
        </table></div>
        <form action={a.refreshCases.bind(null, companyId)} className="actions"><button className="secondary">Hämta status från inkassobolaget</button></form>
      </>)}
      {r.open.some((i) => i.in_collection && !caseOf.get(i.id)?.case_id) && (<>
        <h2>Underlag för inkasso</h2>
        <p className="small">Lämna uppgifterna till ert inkassoombud (inkassoverksamhet kräver tillstånd från IMY). Skriv ut sidan eller kopiera tabellen.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>Gäldenär</th><th>Faktura</th><th>Fakturadatum</th><th>Förföll</th><th className="num">Kapital</th><th className="num">Ränta t.o.m. {today()}</th><th>Påminnelser</th></tr></thead>
          <tbody>{r.open.filter((i) => i.in_collection && !caseOf.get(i.id)?.case_id).map((i) => (
            <tr key={i.id}><td>{i.customer}</td><td>{i.number}</td><td>{i.invoice_date}</td><td>{i.due_date}</td><td className="num">{kr(i.total)}</td><td className="num">{kr(i.interest)}</td><td className="small">{i.levels.length} st, senast {i.last_reminder}</td></tr>
          ))}</tbody>
        </table></div>
      </>)}
    </>
  );
}

async function CustomerLedger({ companyId, basePath, params }: ModulePageProps) {
  const id = Number(params.id);
  const [c, ledger, open, rem] = await Promise.all([getCustomer(companyId, id), svc.customerLedger(companyId, id), svc.openInvoices(companyId, { customer_id: id }), svc.remindersFor(companyId)]);
  const uncharged = rem.filter((r) => r.customer === c.name && !r.charge_invoice_id && (Number(r.fee) > 0 || Number(r.interest) > 0));
  return (
    <>
      <h1>{c.name}</h1>
      <Nav basePath={basePath} />
      <div className="grid">
        <div className="card stat"><div className="label">Att få betalt</div><div className="value">{kr(open.reduce((s, i) => s + i.total, 0))}</div><div className="small muted">{open.length} fakturor</div></div>
        <div className="card stat"><div className="label">Varav förfallet</div><div className="value">{kr(open.filter((i) => i.days_overdue > 0).reduce((s, i) => s + i.total, 0))}</div></div>
      </div>
      {uncharged.length > 0 && (
        <form action={a.charge.bind(null, companyId, id)} className="card actions">
          <span>{uncharged.length} påminnelser med avgift/ränta som inte är fakturerade.</span>
          <button className="secondary">Fakturera påminnelseavgift och ränta</button>
        </form>
      )}
      <h2>Reskontra</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Datum</th><th>Händelse</th><th className="num">Belopp</th><th className="num">Saldo</th></tr></thead>
        <tbody>{ledger.map((l, i) => (
          <tr key={i}><td>{l.date}</td><td><Link href={`/c/${companyId}/fakturor/${l.invoice_id}`}>{l.text}</Link></td><td className="num">{kr(l.amount)}</td><td className="num">{kr(l.balance)}</td></tr>
        ))}{ledger.length === 0 && <tr><td colSpan={4} className="muted">Inga transaktioner.</td></tr>}</tbody>
      </table></div>
    </>
  );
}

async function Reminders({ companyId, basePath }: ModulePageProps) {
  const list = await svc.remindersFor(companyId);
  return (
    <>
      <h1>Skickade påminnelser</h1>
      <Nav basePath={basePath} />
      <div className="table-wrap"><table>
        <thead><tr><th>Datum</th><th>Kund</th><th>Faktura</th><th>Nivå</th><th className="num">Avgift</th><th className="num">Ränta</th><th>Skickad</th><th>Fakturerad</th></tr></thead>
        <tbody>{list.map((r) => (
          <tr key={r.id}><td><Link href={`${basePath}/paminnelse/${r.id}`}>{r.date}</Link></td><td>{r.customer}</td><td>{r.number}</td><td>{r.level}</td><td className="num">{kr(Number(r.fee))}</td>
            <td className="num">{kr(Number(r.interest))}</td><td className="small">{r.emailed_to ?? 'Utskrift'}</td><td>{r.charge_invoice_id ? <Link href={`/c/${companyId}/fakturor/${r.charge_invoice_id}`}>Ja</Link> : ''}</td></tr>
        ))}{list.length === 0 && <tr><td colSpan={8} className="muted">Inga påminnelser ännu.</td></tr>}</tbody>
      </table></div>
    </>
  );
}

async function Letter({ companyId, basePath, params }: ModulePageProps) {
  const r = await svc.reminderLetter(companyId, Number(params.id));
  return (
    <>
      <div className="no-print"><div className="header"><h1>Påminnelse {r.level} – faktura {r.invoice.number}</h1><div className="actions" style={{ margin: 0 }}><Link className="btn secondary" href={basePath}>Tillbaka</Link><PrintButton /></div></div></div>
      <div className="doc">
        <p className="small">{r.invoice.customer}<br />{r.invoice.address}<br />{r.invoice.postal} {r.invoice.city}</p>
        <p className="small">{r.date}</p>
        <div style={{ whiteSpace: 'pre-wrap' }}>{r.text}</div>
      </div>
    </>
  );
}

async function Settings({ companyId, basePath }: ModulePageProps) {
  const s = await svc.settings((await import('@/lib/db')).sql, companyId);
  return (
    <>
      <h1>Inställningar för påminnelser</h1>
      <Nav basePath={basePath} />
      <form action={a.saveSettings.bind(null, companyId)} className="card stack">
        <div className="row">
          <label>Påminnelse 1 (dagar efter förfallodag)<input name="first_days" type="number" min={1} defaultValue={s.first_days} /></label>
          <label>Påminnelse 2<input name="second_days" type="number" min={2} defaultValue={s.second_days} /></label>
          <label>Föreslå inkasso efter<input name="collection_days" type="number" min={3} defaultValue={s.collection_days} /></label>
        </div>
        <div className="row">
          <label>Påminnelseavgift (kr, högst 60)<input name="fee" defaultValue={krIn(s.fee)} inputMode="decimal" /></label>
          <label>Riksbankens referensränta (%)<input name="reference_rate" defaultValue={s.reference_rate == null ? '' : String(s.reference_rate).replace('.', ',')} inputMode="decimal" placeholder="T.ex. 2,00" /></label>
          <label>Konto för avgift<input name="fee_account" type="number" defaultValue={s.fee_account} /></label>
          <label>Konto för ränta<input name="interest_account" type="number" defaultValue={s.interest_account} /></label>
        </div>
        <label>Extra text i påminnelsen<input name="message" defaultValue={s.message} placeholder="T.ex. Kontakta oss om ni vill göra en avbetalningsplan." /></label>
        <label className="check"><input type="checkbox" name="sms" defaultChecked={s.sms} disabled={!smsConfigured()} /> Skicka påminnelserna även som SMS med länk till fakturan (kundens mobilnummer){!smsConfigured() && ' – SMS är inte uppsatt på tjänsten'}</label>
        <label className="check"><input type="checkbox" name="auto_remind" defaultChecked={s.auto_remind} /> Skapa och skicka påminnelser automatiskt varje natt (kräver e-post)</label>
        <div><button>Spara</button></div>
        <p className="small muted" style={{ margin: 0 }}>Dröjsmålsränta = referensräntan + 8 procentenheter (räntelagen 6 §); referensräntan fastställs 1 januari och 1 juli på riksbank.se.
          Påminnelseavgift får bara tas ut om den är avtalad i förväg, t.ex. i fakturavillkoren, och högst 60 kr. Avgift och ränta är momsfria.</p>
      </form>
    </>
  );
}

export const reskontra: ModuleDefinition = {
  id: 'reskontra',
  name: 'Kundreskontra och påminnelser',
  version: '0.1.0',
  description: 'Åldersanalys, kundreskontra, betalningspåminnelser i två steg (utskrift eller e-post, även automatiskt), påminnelseavgift och dröjsmålsränta enligt räntelagen och underlag för inkasso.',
  nav: [{ label: 'Kundreskontra', path: '' }, { label: 'Påminnelser', path: 'paminnelser' }, { label: 'Inställningar', path: 'installningar' }],
  pages: { '': Overview, 'kund/:id': CustomerLedger, paminnelser: Reminders, 'paminnelse/:id': Letter, installningar: Settings },
  scopes: [
    { scope: 'reskontra:read', description: 'Läsa åldersanalys, reskontra och påminnelser' },
    { scope: 'reskontra:write', description: 'Skapa påminnelser och avgiftsfakturor' },
  ],
  events: [{ type: 'reskontra.reminder.created', description: 'En betalningspåminnelse har skapats' }, { type: 'reskontra.collection.updated', description: 'Ett inkassoärende har ny status' }],
  api: [
    { method: 'GET', path: '/aging', scope: 'reskontra:read', tag: 'Reskontra', summary: 'Åldersanalys och obetalda fakturor', handler: ({ actor }) => svc.agingReport(actor.companyId) },
    { method: 'GET', path: '/customers/:id/ledger', scope: 'reskontra:read', tag: 'Reskontra', summary: 'Kundreskontra med löpande saldo',
      handler: async ({ actor, params }) => ({ object: 'list', has_more: false, data: await svc.customerLedger(actor.companyId, Number(params.id)) }) },
    { method: 'POST', path: '/invoices/:id/reminders', scope: 'reskontra:write', tag: 'Reskontra', status: 201, summary: 'Skapa påminnelse (email: true skickar e-post)',
      body: { type: 'object', properties: { email: { type: 'boolean' } } }, handler: ({ actor, params, body }) => svc.createReminder(actor, Number(params.id), { email: body.email === true }) },
  ],
};
