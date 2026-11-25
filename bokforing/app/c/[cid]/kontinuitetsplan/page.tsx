import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { PERMISSIONS } from '@/lib/permissions';
import { overview } from '@/lib/services/continuity';
import { contactAction, planAction, removeContactAction, removeTaskAction, standardAction, taskAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function Continuity({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { owner: true });
  const o = await overview(company.id);
  const id = company.id, b = `/c/${id}`;
  const people = (name: string, v: number | null) => <select name={name} defaultValue={v ? String(v) : ''}><option value="">–</option>{o.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>;
  const perms = (v: string | null) => <select name="permission" defaultValue={v ?? ''}><option value="">Ingen särskild</option>{Object.entries(PERMISSIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Kontinuitetsplan</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Vad händer om någon blir sjuk, slutar eller inte går att nå? Lista de kritiska uppgifterna med ansvarig och ersättare. Planen jämförs med användarnas behörigheter och med registrerade fullmakter
        så att ensamberoenden och ersättare utan behörighet syns. Gå igenom planen minst en gång om året.</p>
      <div className={`card ${o.count ? 'warn' : ''} ct-summary`}><strong className="ct-count">{o.count}</strong> brister · {o.reviewDue ? <span className="ct-review-due">Årlig genomgång behövs{o.plan.reviewed_on ? ` (senast ${o.plan.reviewed_on})` : ''}</span> : <span>Genomgången {o.plan.reviewed_on}{o.plan.reviewer && ` av ${o.plan.reviewer}`}</span>}</div>

      <h2>Kritiska uppgifter</h2>
      <table className="ct-tasks"><thead><tr><th>Uppgift</th><th>Behörighet</th><th>Ansvarig</th><th>Ersättare</th><th>Brister</th><th></th></tr></thead>
        <tbody>{o.tasks.map((t) => <tr key={t.id} className="ct-row" data-name={t.name} data-keys={t.findings.map((f) => f.key).join(' ')}>
          <td colSpan={4}><form action={taskAction.bind(null, id, t.id)} className="row" style={{ gap: '.25rem' }}><input name="name" defaultValue={t.name} required style={{ flex: '2 1 160px' }} />{perms(t.permission)}{people('responsible_id', t.responsible_id)}{people('substitute_id', t.substitute_id)}
            <input name="routine" defaultValue={t.routine} placeholder="Rutin (var finns instruktioner, inloggningar m.m.)" style={{ flex: '3 1 200px' }} /><button className="link">Spara</button></form></td>
          <td className="small">{t.findings.length ? t.findings.map((f) => <div key={f.key} className={f.level}>{f.level === 'danger' ? '⛔' : '⚠️'} {f.text}</div>) : '✅'}</td>
          <td><form action={removeTaskAction.bind(null, id, t.id)}><button className="link">Ta bort</button></form></td></tr>)}
          {!o.tasks.length && <tr><td colSpan={6} className="muted">Inga uppgifter ännu.</td></tr>}</tbody></table>
      <div className="row">
        <form action={standardAction.bind(null, id)}><button className="secondary">Lägg till standarduppgifter</button></form>
        <form action={taskAction.bind(null, id, null)} className="row card" style={{ flex: '1 1 auto' }}><label>Ny uppgift<input name="name" required maxLength={200} /></label><label>Behörighet{perms(null)}</label><label>Ansvarig{people('responsible_id', null)}</label><label>Ersättare{people('substitute_id', null)}</label><div><button>Lägg till</button></div></form>
      </div>

      <h2>Ensamberoenden</h2>
      {o.single.length || o.powerSingles.length ? <ul className="ct-single">{o.single.map((s) => <li key={s.permission} data-permission={s.permission}>{s.label}: {s.holders.length ? `bara ${s.holders[0]}` : 'ingen användare'} har behörigheten</li>)}
        {o.powerSingles.map((p) => <li key={p.counterparty} className="ct-power" data-counterparty={p.counterparty}>Fullmakt hos {p.counterparty}: {p.holder ? `bara ${p.holder}` : 'ingen namngiven innehavare'} ({p.names.join(', ')})</li>)}</ul>
        : <p className="muted small">Inga ensamberoenden bland behörigheter och fullmakter.</p>}
      <p className="small"><Link href={`${b}/installningar`}>Användare och behörigheter</Link> · <Link href={`${b}/fullmakter`}>Fullmakter och tillstånd</Link> ({o.powers} aktiva fullmakter)</p>

      <h2>Kontakter vid kris</h2>
      <table className="small ct-contacts"><tbody>{o.contacts.map((c) => <tr key={c.id} data-name={c.name}><td>{c.role}</td><td>{c.name}</td><td>{c.phone}</td><td>{c.email}</td><td>{c.notes}</td><td><form action={removeContactAction.bind(null, id, c.id)}><button className="link">Ta bort</button></form></td></tr>)}
        {!o.contacts.length && <tr><td className="muted">Inga kontakter – lägg till bank, redovisningskonsult, revisor, IT-leverantör och försäkringsbolag.</td></tr>}</tbody></table>
      <form action={contactAction.bind(null, id)} className="row card">
        <label>Roll<input name="role" placeholder="Bank, revisor, IT …" /></label><label>Namn<input name="name" required /></label><label>Telefon<input name="phone" /></label><label>E-post<input name="email" type="email" /></label><label>Anteckning<input name="notes" /></label>
        <div><button>Lägg till kontakt</button></div>
      </form>

      <h2>Krisrutin och årlig genomgång</h2>
      <form action={planAction.bind(null, id)} className="card stack">
        <label>Krisrutin<textarea name="crisis_routine" rows={5} defaultValue={o.plan.crisis_routine} maxLength={5000} placeholder="Vem kontaktas först, var finns lösenord och dosor, hur betalas löner om ordinarie person inte kan, vem informerar kunder …" /></label>
        <div className="row"><button name="review" value="0" className="secondary">Spara krisrutin</button><button name="review" value="1">Spara och markera planen som genomgången</button></div>
      </form>
    </div>
  );
}
