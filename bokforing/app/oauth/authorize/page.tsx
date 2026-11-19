import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import { currentUser } from '@/lib/server/auth';
import { allScopes } from '@/lib/api/scopes';
import { checkAuthorize, OAuthError } from '@/lib/services/oauth';
import { decide } from '../actions';

export const dynamic = 'force-dynamic';

/** Samtyckessida: en app ber om åtkomst till ett av användarens bolag */
export default async function Authorize({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])));
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${q.toString()}`)}`);
  let req;
  try { req = await checkAuthorize(q); } catch (e) {
    return <div className="center" style={{ maxWidth: 560 }}><h1>Appen kan inte kopplas</h1><p className="flash error">{e instanceof OAuthError ? e.message : 'Ogiltig begäran'}</p></div>;
  }
  const companies = await sql<{ id: number; name: string; orgnr: string }[]>`SELECT c.id, c.name, c.orgnr FROM companies c JOIN memberships m ON m.company_id = c.id WHERE m.user_id = ${user.id} AND m.role = 'owner' ORDER BY c.name`;
  const desc = new Map(allScopes().map((s) => [s.scope, s.description]));
  const host = new URL(req.redirectUri).host;
  return (
    <div className="center" style={{ maxWidth: 600 }}>
      <h1>Koppla {req.app.name}</h1>
      <p className="muted">{req.app.description || 'En app vill få åtkomst till ett av dina bolag.'}{req.app.homepage && <> · <a href={req.app.homepage} rel="noopener noreferrer" target="_blank">{new URL(req.app.homepage).host}</a></>}</p>
      <section className="card stack consent">
        <b>{req.app.name} får:</b>
        <ul style={{ margin: 0 }}>{req.scopes.map((s) => <li key={s}>{desc.get(s)} <span className="small muted">({s})</span></li>)}</ul>
        <p className="small muted" style={{ margin: 0 }}>Du skickas sedan tillbaka till <b>{host}</b>. Du kan när som helst koppla bort appen under Inställningar → Kopplade appar.</p>
      </section>
      {companies.length === 0 ? <p className="flash error">Du är inte ägare i något bolag. Bara ägare kan koppla appar.</p> : (
        <form action={decide.bind(null, q.toString())} className="card stack">
          <label>Bolag<select name="company_id">{companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.orgnr})</option>)}</select></label>
          <div className="actions" style={{ margin: 0 }}>
            <button name="decision" value="approve">Godkänn</button>
            <button name="decision" value="deny" className="secondary">Avbryt</button>
          </div>
        </form>
      )}
    </div>
  );
}
