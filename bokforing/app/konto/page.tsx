import Link from 'next/link';
import { cookies } from 'next/headers';
import QRCode from 'qrcode';
import { sql } from '@/lib/db';
import { otpauthUri } from '@/lib/totp';
import { cancelTotp, confirmTotp, disableTotp, regenerateCodes, startTotp } from '../mfa-actions';
import { requireUser } from '@/lib/server/auth';
import { listPasskeys } from '@/lib/server/passkeys';
import { Flash, type SP } from '@/components/ui';
import { AddPasskey } from '@/components/Passkeys';
import { changePassword, removePasskey } from '../passkey-actions';
import { logout } from '../auth-actions';
import { removeAccount } from '../gdpr-actions';
import { saveDigest } from '../digest-actions';

export const dynamic = 'force-dynamic';

export default async function Account({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const passkeys = await listPasskeys(user.id);
  const [{ digest, monthly_report }] = await sql<{ digest: string; monthly_report: boolean }[]>`SELECT digest, monthly_report FROM users WHERE id = ${user.id}`;
  const [mfa] = await sql<{ secret: string | null; on: string | null; codes: number }[]>`
    SELECT totp_secret AS secret, to_char(totp_enabled_at,'YYYY-MM-DD') AS on, cardinality(backup_codes)::int AS codes FROM users WHERE id = ${user.id}`;
  const setupQr = mfa.secret && !mfa.on ? await QRCode.toString(otpauthUri(mfa.secret, user.email), { type: 'svg', margin: 1, width: 180 }) : null;
  const shown = (await cookies()).get('backup_codes')?.value.split(' ').filter(Boolean) ?? [];
  return (
    <div className="center" style={{ maxWidth: 760 }}>
      <div className="header">
        <h1>Mitt konto</h1>
        <div className="actions" style={{ margin: 0 }}>
          <Link className="btn secondary" href="/">Mina bolag</Link>
          <form action={logout}><button className="secondary">Logga ut</button></form>
        </div>
      </div>
      <p className="muted">{user.name} · {user.email}</p>
      <Flash searchParams={searchParams} />

      <h2>Passkeys</h2>
      <p className="muted small">Med en passkey loggar du in med Face ID, Touch ID, Windows Hello eller en säkerhetsnyckel i stället för lösenord.
        Den är knuten till den här webbplatsen och kan inte nätfiskas. Synkade passkeys (iCloud-nyckelring, Google Lösenordshanteraren m.fl.) fungerar på alla dina enheter.</p>
      {passkeys.length > 0 && (
        <table>
          <thead><tr><th>Namn</th><th>Typ</th><th>Skapad</th><th>Senast använd</th><th></th></tr></thead>
          <tbody>
            {passkeys.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="small">{p.device_type === 'multiDevice' ? 'Synkad' : 'En enhet'}{p.backed_up ? ' (säkerhetskopierad)' : ''}</td>
                <td className="small">{p.created_at}</td>
                <td className="small">{p.last_used_at ?? 'Aldrig'}</td>
                <td className="num"><form action={removePasskey.bind(null, p.id)}><button className="link">Ta bort</button></form></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ marginTop: '1rem' }}><AddPasskey /></div>
      <p className="small muted">Om du tar bort en passkey här, ta gärna bort den även i enhetens lösenordshanterare.</p>

      <h2 id="tvasteg">Tvåstegsverifiering</h2>
      <p className="muted small">Med tvåstegsverifiering krävs både lösenordet och en engångskod från en app i telefonen (t.ex. Microsoft Authenticator, Google Authenticator eller 1Password). Inloggning med passkey räknas redan som tvåstegs.</p>
      {mfa.on ? (
        <div className="card stack">
          <div><span className="badge ok">På</span> sedan {mfa.on} · {mfa.codes} oanvända reservkoder</div>
          {shown.length > 0 && (
            <div className="card" style={{ margin: 0, borderColor: 'var(--accent)' }}>
              <b>Dina reservkoder</b> – spara dem på ett säkert ställe. Varje kod kan användas en gång om du inte har telefonen. De visas bara nu.
              <pre className="backup-codes" style={{ columns: 2, margin: '.5rem 0 0' }}>{shown.join('\n')}</pre>
            </div>
          )}
          <form action={regenerateCodes} className="row">
            <label>Lösenord<input type="password" name="password" required autoComplete="current-password" /></label>
            <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Skapa nya reservkoder</button></div>
          </form>
          <form action={disableTotp} className="row">
            <label>Lösenord<input type="password" name="password" required autoComplete="current-password" /></label>
            <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Stäng av tvåstegsverifiering</button></div>
          </form>
        </div>
      ) : setupQr ? (
        <div className="card stack">
          <div className="row" style={{ alignItems: 'center' }}>
            <div style={{ width: 180, height: 180, flex: '0 0 auto' }} dangerouslySetInnerHTML={{ __html: setupQr }} />
            <div className="small" style={{ flex: '1 1 260px' }}>1. Skanna QR-koden med autentiseringsappen.<br />Går det inte? Ange nyckeln manuellt:<br /><code className="totp-secret">{mfa.secret!.match(/.{1,4}/g)!.join(' ')}</code><br />2. Skriv in koden som appen visar.</div>
          </div>
          <form action={confirmTotp} className="row">
            <label>Kod från appen<input name="code" inputMode="numeric" autoComplete="one-time-code" required /></label>
            <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button>Slå på</button></div>
          </form>
          <form action={cancelTotp}><button className="link">Avbryt</button></form>
        </div>
      ) : (
        <form action={startTotp}><button className="secondary">Slå på tvåstegsverifiering</button></form>
      )}

      <h2 id="sammandrag">Sammandrag via e-post</h2>
      <form action={saveDigest} className="card row" style={{ alignItems: 'end' }}>
        <label>Skicka det som väntar i mina bolag<select name="digest" defaultValue={digest}>
          <option value="weekly">Varje måndag</option><option value="daily">Varje vardagsmorgon</option><option value="off">Aldrig</option>
        </select></label>
        <label className="check"><input type="checkbox" name="monthly_report" defaultChecked={monthly_report} /> Månadsrapport för bolag där jag är ägare</label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Spara</button></div>
        <span className="small muted">Förfallna fakturor, betalningar, attester, frågor från byrån m.m. Skickas bara när något väntar.</span>
      </form>

      <h2>Byt lösenord</h2>
      <form action={changePassword} className="card stack">
        <div className="row">
          <label>Nuvarande lösenord<input type="password" name="current" required autoComplete="current-password" /></label>
          <label>Nytt lösenord (minst 10 tecken)<input type="password" name="password" minLength={10} required autoComplete="new-password" /></label>
        </div>
        <div><button className="secondary">Byt lösenord</button></div>
        <p className="small muted" style={{ margin: 0 }}>Dina andra inloggade sessioner loggas ut.</p>
      </form>

      <h2 id="gdpr">Mina personuppgifter</h2>
      <p className="muted small">Du kan när som helst ladda ner de uppgifter som finns om dig (registerutdrag). Läs mer i <Link href="/integritet">integritetspolicyn</Link>.</p>
      <p><a className="btn secondary" href="/konto/export">Ladda ner mina uppgifter (JSON)</a></p>
      <details className="card">
        <summary>Radera mitt konto</summary>
        <p className="small">Kontot, dina passkeys och inloggningar tas bort och du lämnar alla bolag. Det du har bokfört finns kvar i bolagens bokföring (det kräver bokföringslagen) men visas som "Raderad användare". Är du ensam ägare av ett bolag måste du först bjuda in en ny ägare.</p>
        <form action={removeAccount} className="row">
          <label>Lösenord<input type="password" name="password" required autoComplete="current-password" /></label>
          <label>Skriv RADERA<input name="confirm" required autoComplete="off" /></label>
          <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="danger">Radera kontot</button></div>
        </form>
      </details>
    </div>
  );
}
