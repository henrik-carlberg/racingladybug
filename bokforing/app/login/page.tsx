import Link from 'next/link';
import { login } from '../auth-actions';
import { Flash, type SP } from '@/components/ui';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: { searchParams: SP }) {
  const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM users`;
  return (
    <div className="center">
      <h1>Logga in</h1>
      <Flash searchParams={searchParams} />
      <form action={login} className="card stack">
        <label>E-post<input name="email" type="email" required autoComplete="email" /></label>
        <label>Lösenord<input name="password" type="password" required autoComplete="current-password" /></label>
        <button>Logga in</button>
      </form>
      {count === 0 && <p className="muted">Första gången? <Link href="/register">Skapa ägarkonto</Link></p>}
    </div>
  );
}
