import Link from 'next/link';
import { requireUser } from '@/lib/server/auth';
import { listPasskeys } from '@/lib/server/passkeys';
import { Flash, type SP } from '@/components/ui';
import { AddPasskey } from '@/components/Passkeys';
import { changePassword, removePasskey } from '../passkey-actions';
import { logout } from '../auth-actions';

export const dynamic = 'force-dynamic';

export default async function Account({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const passkeys = await listPasskeys(user.id);
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

      <h2>Byt lösenord</h2>
      <form action={changePassword} className="card stack">
        <div className="row">
          <label>Nuvarande lösenord<input type="password" name="current" required autoComplete="current-password" /></label>
          <label>Nytt lösenord (minst 10 tecken)<input type="password" name="password" minLength={10} required autoComplete="new-password" /></label>
        </div>
        <div><button className="secondary">Byt lösenord</button></div>
        <p className="small muted" style={{ margin: 0 }}>Dina andra inloggade sessioner loggas ut.</p>
      </form>
    </div>
  );
}
