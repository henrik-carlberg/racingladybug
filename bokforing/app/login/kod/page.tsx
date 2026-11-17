import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Flash, type SP } from '@/components/ui';
import { pendingChallenge } from '@/lib/server/mfa';
import { loginCode } from '../../auth-actions';

export const dynamic = 'force-dynamic';

export default async function LoginCode({ searchParams }: { searchParams: SP }) {
  const c = await pendingChallenge();
  if (!c) redirect('/login?error=' + encodeURIComponent('Inloggningen har gått ut – logga in igen'));
  return (
    <div className="center">
      <h1>Tvåstegsverifiering</h1>
      <Flash searchParams={searchParams} />
      <form action={loginCode} className="card stack">
        <p className="muted" style={{ margin: 0 }}>Ange den sexsiffriga koden från autentiseringsappen för {c.email}. Har du inte telefonen? Använd en av dina reservkoder.</p>
        <label>Kod<input name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required /></label>
        <button>Logga in</button>
      </form>
      <p className="small"><Link href="/login">Avbryt</Link></p>
    </div>
  );
}
