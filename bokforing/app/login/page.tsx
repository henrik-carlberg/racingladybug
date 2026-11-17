import Link from 'next/link';
import { login } from '../auth-actions';
import { Flash, type SP } from '@/components/ui';
import { sql } from '@/lib/db';
import { PasskeyLogin } from '@/components/Passkeys';
import { signupOpen } from '@/lib/billing';

export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: { searchParams: SP }) {
  const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM users`;
  return (
    <div className="center">
      <h1>Logga in</h1>
      <Flash searchParams={searchParams} />
      <PasskeyLogin />
      <form action={login} className="card stack">
        <label>E-post<input name="email" type="email" required autoComplete="username webauthn" /></label>
        <label>Lösenord<input name="password" type="password" required autoComplete="current-password" /></label>
        <button>Logga in</button>
      </form>
      {(count === 0 || signupOpen()) && <p className="muted">Ny här? <Link href="/register">Skapa konto och prova gratis</Link></p>}
    </div>
  );
}
