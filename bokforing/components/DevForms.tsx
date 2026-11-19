'use client';
import { useActionState } from 'react';
import type { Created } from '@/app/utvecklare/actions';

export function CreateAppForm({ action }: { action: (prev: Created, fd: FormData) => Promise<Created> }) {
  const [s, run, pending] = useActionState(action, {});
  return (
    <form action={run} className="card stack new-app">
      {s.error && <p className="flash error" role="alert">{s.error}</p>}
      {s.clientId && (
        <div className="flash ok created-app" role="status">
          <b>{s.name} är registrerad.</b><br />Klient-id: <code className="client-id">{s.clientId}</code>
          {s.secret && <><br />Klienthemlighet (visas bara nu): <code className="client-secret">{s.secret}</code></>}
        </div>
      )}
      <div className="row">
        <label style={{ flex: '2 1 240px' }}>Appens namn<input name="name" required /></label>
        <label style={{ flex: '2 1 240px' }}>Webbplats (https)<input name="homepage" placeholder="https://" /></label>
      </div>
      <label>Beskrivning (visas när kunden godkänner)<input name="description" /></label>
      <label>Återkomstadresser (en per rad, https eller http://localhost)<textarea name="redirect_uris" rows={2} required /></label>
      <label className="check"><input type="checkbox" name="public" /> Publik klient utan hemlighet (mobilapp, webbläsare) – PKCE räcker</label>
      <div><button disabled={pending}>Registrera app</button></div>
    </form>
  );
}

export function RotateSecret({ action }: { action: (prev: Created) => Promise<Created> }) {
  const [s, run, pending] = useActionState(action, {});
  return (
    <form action={run} style={{ display: 'inline' }}>
      <button className="link" disabled={pending}>Ny hemlighet</button>
      {s.secret && <div className="small">Ny hemlighet (visas bara nu): <code className="client-secret">{s.secret}</code></div>}
      {s.error && <div className="small" style={{ color: 'var(--danger)' }}>{s.error}</div>}
    </form>
  );
}
