import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { requestOrigin } from '@/lib/server/origin';
import { userActor } from '@/lib/services/actor';
import { THRESHOLD } from '@/lib/whistleblowing';
import { overview } from '@/lib/services/whistleblowing';
import { ackAction, closeAction, enableAction, handlerAction, replyAction } from './actions';

export const dynamic = 'force-dynamic';
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '');

export default async function Whistleblowing({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid);
  const id = ctx.company.id;
  const o = await overview(userActor(ctx));
  const owner = ctx.role === 'owner';
  const link = o.settings ? `${await requestOrigin()}/visselblasning/${o.settings.token}` : null;
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Visselblåsarkanal</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Arbetsgivare med minst {THRESHOLD} arbetstagare ska ha en intern kanal för rapportering av missförhållanden (lag 2021:890). Bolaget har {o.employees} aktiva anställda{o.required ? ' och omfattas av kravet' : ''}.
        Den som rapporterar kan vara anonym och följer ärendet med en ärendekod. Mottagandet ska bekräftas inom sju dagar och återkoppling lämnas inom tre månader. Bara utsedda handläggare kan läsa rapporterna,
        och avslutade ärenden gallras automatiskt två år efter avslutet. Rapporter och meddelanden lagras krypterade.</p>

      <h2>Kanal</h2>
      {o.settings?.active ? <p className="wb-link">Publik länk att sprida till anställda och andra: <code>{link}</code></p> : <p className="muted">Kanalen är stängd.</p>}
      {owner && <form action={enableAction.bind(null, id, !o.settings?.active)}><button className={o.settings?.active ? 'secondary' : ''}>{o.settings?.active ? 'Stäng kanalen' : 'Öppna kanalen'}</button></form>}

      <h2>Handläggare</h2>
      <ul className="wb-handlers">{o.handlers.map((h) => <li key={h.user_id}>{h.name}{owner && <form action={handlerAction.bind(null, id)} style={{ display: 'inline' }}><input type="hidden" name="user_id" value={h.user_id} /><input type="hidden" name="on" value="0" /> <button className="link">Ta bort</button></form>}</li>)}
        {!o.handlers.length && <li className="muted">Inga handläggare utsedda.</li>}</ul>
      {owner && <form action={handlerAction.bind(null, id)} className="row"><select name="user_id">{o.members.filter((m) => !o.handlers.some((h) => h.user_id === m.id)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select><input type="hidden" name="on" value="1" /><button className="secondary">Utse handläggare</button></form>}

      <h2>Rapporter</h2>
      {!o.handler ? <p className="muted wb-restricted">{o.open} öppna ärenden. Bara utsedda handläggare kan läsa rapporterna.</p> : <>
        {o.reports.map((r) => (
          <div key={r.id} className="card stack wb-report" data-status={r.status} data-ack-overdue={r.ackOverdue ? '1' : '0'}>
            <div><strong>{r.category}</strong> · mottagen {d(r.received_at)} · {r.status === 'closed' ? `avslutad ${d(r.closed_at)}` : 'öppen'}</div>
            <div className="small">{r.acknowledged_at ? `Bekräftad ${d(r.acknowledged_at)}` : <span className={r.ackOverdue ? 'wb-overdue' : ''}>Bekräfta senast {d(r.ackBy)}</span>}
              {' · '}{r.feedback_at ? `Återkoppling ${d(r.feedback_at)}` : <span className={r.feedbackOverdue ? 'wb-overdue' : ''}>Återkoppling senast {d(r.feedbackBy)}</span>}</div>
            <div className="wb-body" style={{ whiteSpace: 'pre-wrap' }}>{r.body}</div>
            {r.contact && <div className="small">Kontakt: {r.contact}</div>}
            {r.messages.length > 0 && <ul className="small stack wb-messages">{r.messages.map((m, i) => <li key={i} data-sender={m.sender}><b>{m.sender === 'handler' ? 'Handläggare' : 'Rapportör'}</b> {d(m.created_at)}: <span style={{ whiteSpace: 'pre-wrap' }}>{m.body}</span></li>)}</ul>}
            {r.outcome && <div className="small">Utfall: {r.outcome}</div>}
            {r.status === 'open' && <>
              {!r.acknowledged_at && <form action={ackAction.bind(null, id, r.id)}><button>Bekräfta mottagandet</button></form>}
              <form action={replyAction.bind(null, id, r.id)} className="stack wb-handler-reply"><textarea name="body" rows={3} required maxLength={10000} placeholder="Meddelande till den som rapporterat" />
                <label className="small"><input type="checkbox" name="feedback" /> Återkoppling om vilka åtgärder som vidtagits eller planeras</label><div><button className="secondary">Skicka</button></div></form>
              <form action={closeAction.bind(null, id, r.id)} className="row wb-close"><input name="outcome" required maxLength={5000} placeholder="Utfall och åtgärder" style={{ width: '24rem' }} /><button className="secondary">Avsluta ärendet</button></form></>}
          </div>))}
        {!o.reports.length && <p className="muted">Inga rapporter.</p>}</>}
    </div>
  );
}
