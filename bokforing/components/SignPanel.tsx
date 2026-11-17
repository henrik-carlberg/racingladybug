'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { declineAsUser, signPasskey, signPasskeyOptions, signPassword } from '@/app/c/[cid]/dokument/actions';

/** Signering för inloggad undertecknare: passkey (rekommenderas) eller lösenord */
export function SignPanel({ signerId, path, hasPasskey, name }: { signerId: number; path: string; hasPasskey: boolean; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [consent, setConsent] = useState(false);
  const [webauthn, setWebauthn] = useState(false);
  useEffect(() => setWebauthn(browserSupportsWebAuthn()), []);
  const after = (r: { ok: boolean; error?: string }) => { if (!r.ok) setError(r.error ?? 'Fel'); else router.refresh(); setBusy(false); };

  async function withPasskey() {
    setError(null); setBusy(true);
    const o = await signPasskeyOptions(signerId);
    if (!o.ok) { setError(o.error); setBusy(false); return; }
    try {
      const resp = await startAuthentication({ optionsJSON: o.options });
      after(await signPasskey(path, signerId, resp));
    } catch (e) {
      const n = (e as { name?: string }).name;
      if (n !== 'NotAllowedError' && n !== 'AbortError') setError(e instanceof Error ? e.message : 'Fel');
      setBusy(false);
    }
  }

  return (
    <div className="card stack" style={{ borderColor: 'var(--accent)' }}>
      <b>Din signatur behövs ({name})</b>
      {error && <div className="flash error" style={{ margin: 0 }}>{error}</div>}
      <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Jag har läst dokumentet och godkänner innehållet</label>
      <div className="actions" style={{ margin: 0 }}>
        {hasPasskey && webauthn && <button type="button" disabled={!consent || busy} onClick={withPasskey}>🔑 Signera med passkey</button>}
      </div>
      <div className="row">
        <label>{hasPasskey ? 'Eller signera med lösenord' : 'Signera med ditt lösenord'}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
        <div style={{ flex: '0 0 auto' }}><button type="button" className={hasPasskey ? 'secondary' : ''} disabled={!consent || !password || busy}
          onClick={async () => { setError(null); setBusy(true); after(await signPassword(path, signerId, password)); }}>Signera</button></div>
      </div>
      {!hasPasskey && <p className="small muted" style={{ margin: 0 }}>Tips: lägg till en passkey under Mitt konto för starkare signering med biometri.</p>}
      <details>
        <summary className="small">Avböj att signera</summary>
        <div className="row" style={{ marginTop: '.5rem' }}>
          <label>Anledning<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <div style={{ flex: '0 0 auto' }}><button type="button" className="danger" disabled={busy} onClick={async () => { setBusy(true); after(await declineAsUser(path, signerId, reason)); }}>Avböj</button></div>
        </div>
      </details>
    </div>
  );
}
