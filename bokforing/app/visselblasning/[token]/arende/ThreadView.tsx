'use client';
import { useActionState } from 'react';
import { threadAction, type ThreadState } from '../actions';

export default function ThreadView({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ThreadState, FormData>(threadAction.bind(null, token), {});
  if (!state.thread) return (
    <form action={action} className="card stack wb-lookup">
      {state.error && <p className="flash error" role="alert">{state.error}</p>}
      <label>Ärendekod<input name="code" required autoComplete="off" placeholder="XXXX-XXXX-XXXX-XXXX" /></label>
      <div><button disabled={pending}>Visa ärendet</button></div>
    </form>);
  const t = state.thread;
  return (
    <div className="stack wb-thread" data-status={t.status}>
      {state.error && <p className="flash error" role="alert">{state.error}</p>}
      <p className="small">{t.status === 'closed' ? 'Ärendet är avslutat.' : t.acknowledged ? 'Rapporten är mottagen och utreds.' : 'Rapporten väntar på bekräftelse.'}</p>
      <ul className="stack wb-messages">{t.messages.map((m, i) => <li key={i} className="card small" data-sender={m.sender}><b>{m.sender === 'handler' ? 'Handläggare' : 'Du'}</b> {m.at}<div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div></li>)}
        {!t.messages.length && <li className="muted">Inga meddelanden ännu.</li>}</ul>
      {t.status !== 'closed' && <form action={action} className="stack wb-reply">
        <input type="hidden" name="code" value={state.code} />
        <label>Svara<textarea name="reply" rows={4} required maxLength={10000} /></label>
        <div><button disabled={pending}>Skicka</button></div>
      </form>}
    </div>);
}
