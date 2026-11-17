import { acceptInvite } from '../../auth-actions';
import { Flash, type SP } from '@/components/ui';
import { sql } from '@/lib/db';
import { sha256 } from '@/lib/server/auth';
import { ROLE_LABEL } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Invite({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SP }) {
  const { token } = await params;
  const [inv] = await sql<{ email: string; role: 'owner' | 'accountant'; company: string; has_user: boolean }[]>`
    SELECT i.email, i.role, c.name AS company, EXISTS (SELECT 1 FROM users u WHERE u.email = i.email) AS has_user
    FROM invites i JOIN companies c ON c.id = i.company_id
    WHERE i.token_hash = ${sha256(token)} AND i.accepted_at IS NULL AND i.expires_at > now()`;
  if (!inv) return <div className="center"><h1>Inbjudan</h1><p>Inbjudan är ogiltig eller har gått ut.</p></div>;
  return (
    <div className="center">
      <h1>Inbjudan till {inv.company}</h1>
      <p className="muted">Du har bjudits in som <b>{ROLE_LABEL[inv.role]}</b> med e-post {inv.email}.</p>
      <Flash searchParams={searchParams} />
      <form action={acceptInvite} className="card stack">
        <input type="hidden" name="token" value={token} />
        {!inv.has_user && <label>Ditt namn<input name="name" required /></label>}
        <label>{inv.has_user ? 'Ditt befintliga lösenord' : 'Välj lösenord (minst 10 tecken)'}
          <input name="password" type="password" required minLength={inv.has_user ? 1 : 10} /></label>
        <button>Acceptera</button>
      </form>
    </div>
  );
}
