import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { today } from '@/lib/format';
import { KINDS, TEMPLATES } from '@/lib/board-meetings';
import { overview } from '@/lib/services/board-meetings';
import { createAction, decideAction, doneAction, holdAction, itemAction, sendAction } from './actions';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = { planned: 'Planerat', held: 'Hållet – protokoll ej skickat', sent: 'Protokoll skickat för justering' };
const DOC: Record<string, string> = { pending: 'väntar på justering', completed: 'justerat och signerat', declined: 'justering avböjd', cancelled: 'makulerat' };

export default async function BoardMeetings({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const { meetings, decisions, boardMembers } = await overview(id);
  const t = today();
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Styrelsemöten och stämmor</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Planera möten med dagordning, för in beslut med ansvarig och sista dag, och skicka protokollet för e-signering till ordförande och justerare.
        Styrelsen är beslutför när mer än hälften av ledamöterna är närvarande (ledamöterna hämtas från <Link href={`/c/${id}/lon/styrelsearvoden`}>styrelsearvoden</Link>{boardMembers.length ? `: ${boardMembers.join(', ')}` : ''}).
        Årsstämman ska besluta om fastställelse av resultat- och balansräkning, vinstdisposition och ansvarsfrihet.</p>

      {decisions.length > 0 && <><h2>Beslut att följa upp</h2>
        <table className="bm-decisions"><thead><tr><th>Beslut</th><th>Möte</th><th>Ansvarig</th><th>Senast</th><th></th></tr></thead>
          <tbody>{decisions.map((d) => <tr key={d.id} className="bm-decision" data-overdue={d.overdue ? '1' : '0'}><td>{d.title}: {d.decision}</td><td className="small">{KINDS[d.meeting.kind]} {d.meeting.date}</td><td>{d.owner}</td>
            <td className={d.overdue ? 'bm-overdue' : ''}>{d.due_date}{d.overdue && ' (försenat)'}</td><td><form action={doneAction.bind(null, id, d.id)}><button className="link">Genomfört</button></form></td></tr>)}</tbody></table></>}

      {meetings.map((m) => (
        <div key={m.id} className="card stack bm-meeting" data-date={m.date} data-kind={m.kind} data-status={m.status}>
          <div><strong>{KINDS[m.kind]} {m.date}</strong>{m.place && ` · ${m.place}`} · <span className="bm-status">{STATUS[m.status]}{m.doc_status && ` (${DOC[m.doc_status] ?? m.doc_status})`}</span>
            {m.document_id && <> · <Link href={`/c/${id}/dokument/${m.document_id}`}>protokollet</Link></>}</div>
          {m.quorum && m.quorum.members > 0 && <div className="small bm-quorum">{m.status === 'planned' ? `${m.quorum.members} ledamöter – minst ${m.quorum.needed} måste vara närvarande` : `${m.quorum.here} av ${m.quorum.members} ledamöter närvarande`}</div>}
          {m.missing.length > 0 && <div className="small bm-missing">Saknas på dagordningen: {m.missing.map((x) => TEMPLATES[x].toLowerCase()).join(', ')}</div>}
          <ol className="bm-items">{m.items.map((i) => <li key={i.id} data-template={i.template}>{i.title}
            {i.decision && <div className="small bm-item-decision">Beslut: {i.decision}{i.owner && ` · ansvarig ${i.owner}`}{i.due_date && ` · senast ${i.due_date}`}{i.done_on && ` · genomfört ${i.done_on}`}</div>}
            {m.status !== 'sent' && !['open', 'close', 'agenda'].includes(i.template) && <form action={decideAction.bind(null, id, i.id)} className="row" style={{ gap: '.25rem' }}>
              <input name="decision" defaultValue={i.decision} placeholder="Beslut" style={{ width: '20rem' }} /><input name="owner" defaultValue={i.owner} placeholder="Ansvarig" style={{ width: '8rem' }} /><input type="date" name="due_date" defaultValue={i.due_date ?? ''} /><button className="link">Spara</button></form>}</li>)}</ol>
          {m.status !== 'sent' && <form action={itemAction.bind(null, id, m.id)} className="row" style={{ gap: '.25rem' }}>
            <select name="template">{Object.entries(TEMPLATES).filter(([k]) => !['open', 'close', 'agenda'].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><input name="title" placeholder="Egen rubrik (valfri)" /><button className="link">Lägg till punkt</button></form>}
          {m.status === 'planned' && <form action={holdAction.bind(null, id, m.id)} className="row bm-hold" style={{ gap: '.25rem' }}>
            <input name="present" placeholder="Närvarande (kommaseparerat)" defaultValue={m.kind === 'board' ? boardMembers.join(', ') : ''} style={{ width: '20rem' }} />
            <input name="chair" placeholder="Ordförande" /><input name="secretary" placeholder="Protokollförare" /><button>Registrera närvaro</button></form>}
          {m.status === 'held' && <form action={sendAction.bind(null, id, m.id)} className="row bm-send" style={{ gap: '.25rem' }}>
            <input name="signer_name_0" placeholder="Ordförande" defaultValue={m.chair} /><input name="signer_email_0" placeholder="E-post" type="email" />
            <input name="signer_name_1" placeholder="Justerare" /><input name="signer_email_1" placeholder="E-post" type="email" /><button>Skicka protokollet för justering</button></form>}
        </div>))}
      {!meetings.length && <p className="muted">Inga möten.</p>}

      <h2>Nytt möte</h2>
      <form action={createAction.bind(null, id)} className="card row bm-new">
        <label>Typ<select name="kind">{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Datum<input type="date" name="date" defaultValue={t} required /></label>
        <label>Plats<input name="place" maxLength={200} /></label>
        <button>Skapa möte</button>
      </form>
    </div>
  );
}
