'use client';
import { useActionState } from 'react';

type State = { error?: string; token?: string } | undefined;

export function ApiKeyForm({ action, scopes }: {
  action: (s: State, fd: FormData) => Promise<State>;
  scopes: { scope: string; description: string; module?: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <>
      {state?.token && (
        <div className="flash ok">
          <b>Kopiera nyckeln nu – den visas inte igen.</b><br />
          <code className="mono" style={{ wordBreak: 'break-all', userSelect: 'all' }}>{state.token}</code>
        </div>
      )}
      {state?.error && <div className="flash error">{state.error}</div>}
      <form action={formAction} className="card stack">
        <label>Namn (t.ex. vilket system som använder nyckeln)<input name="name" required placeholder="CRM-integration" /></label>
        <div className="grid" style={{ gap: '.25rem 1rem' }}>
          {scopes.map((s) => (
            <label key={s.scope} className="check" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" name="scopes" value={s.scope} />
              <span><span className="mono small">{s.scope}</span>{s.module && <span className="badge" style={{ marginLeft: 4 }}>{s.module}</span>}<br />
                <span className="small muted">{s.description}</span></span>
            </label>
          ))}
        </div>
        <div><button disabled={pending}>Skapa API-nyckel</button></div>
      </form>
    </>
  );
}
