'use client';
import { useEffect, useRef, useState } from 'react';
import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, startAuthentication, startRegistration, WebAuthnAbortService } from '@simplewebauthn/browser';
import { passkeyLogin, passkeyLoginOptions, passkeyRegister, passkeyRegisterOptions } from '@/app/passkey-actions';

/** Översätter webbläsarens fel till begripliga meddelanden */
function message(e: unknown): string | null {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') return null; // användaren avbröt
  if (name === 'InvalidStateError') return 'Passkeyn finns redan på den här enheten.';
  return e instanceof Error ? e.message : 'Något gick fel';
}

/**
 * Inloggning med passkey: knapp + autofyll (conditional UI) i e-postfältet,
 * så att webbläsaren föreslår sparade passkeys direkt.
 */
export function PasskeyLogin() {
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  async function login(autofill: boolean) {
    setError(null);
    const r = await passkeyLoginOptions();
    if (!r.ok) { setError(r.error); return; }
    try {
      if (!autofill) setBusy(true);
      const response = await startAuthentication({ optionsJSON: r.options, useBrowserAutofill: autofill });
      setBusy(true);
      const res = await passkeyLogin(response);
      if (!res.ok) { setError(res.error); setBusy(false); return; }
      window.location.href = '/';
    } catch (e) {
      const m = message(e);
      if (m) setError(m);
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!browserSupportsWebAuthn()) return;
    setSupported(true);
    if (started.current) return;
    started.current = true;
    browserSupportsWebAuthnAutofill().then((ok) => { if (ok) void login(true); });
    return () => WebAuthnAbortService.cancelCeremony();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!supported) return null;
  return (
    <div className="stack" style={{ marginBottom: '1rem' }}>
      <button type="button" onClick={() => login(false)} disabled={busy}>{busy ? 'Loggar in…' : '🔑 Logga in med passkey'}</button>
      {error && <div className="flash error" style={{ margin: 0 }}>{error}</div>}
    </div>
  );
}

export function AddPasskey() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);

  async function add() {
    setError(null); setOk(false); setBusy(true);
    try {
      const r = await passkeyRegisterOptions();
      if (!r.ok) { setError(r.error); return; }
      const response = await startRegistration({ optionsJSON: r.options });
      const res = await passkeyRegister(response, name || guessDeviceName());
      if (!res.ok) { setError(res.error); return; }
      setOk(true); setName('');
    } catch (e) {
      const m = message(e);
      if (m) setError(m);
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return <p className="muted">Den här webbläsaren stöder inte passkeys.</p>;
  return (
    <div className="card stack">
      {ok && <div className="flash ok" style={{ margin: 0 }}>Passkeyn är tillagd. Nästa gång kan du logga in utan lösenord.</div>}
      {error && <div className="flash error" style={{ margin: 0 }}>{error}</div>}
      <div className="row">
        <label style={{ flex: '2 1 240px' }}>Namn (valfritt)<input value={name} onChange={(e) => setName(e.target.value)} placeholder={guessDeviceName()} maxLength={100} /></label>
        <div style={{ flex: '0 0 auto' }}><button type="button" onClick={add} disabled={busy}>{busy ? 'Väntar på enheten…' : 'Lägg till passkey'}</button></div>
      </div>
    </div>
  );
}

function guessDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Passkey';
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'iPhone/iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Passkey';
}
