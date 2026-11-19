import Link from 'next/link';
import { requireUser } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { requestOrigin } from '@/lib/server/origin';
import { myApps } from '@/lib/services/oauth';
import { CreateAppForm, RotateSecret } from '@/components/DevForms';
import { create, revoke, rotate, sandbox } from './actions';

export const dynamic = 'force-dynamic';

export default async function Developers({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const apps = await myApps(user.id);
  const origin = await requestOrigin();
  return (
    <div className="center" style={{ maxWidth: 960 }}>
      <div className="header"><h1>Utvecklare</h1><div className="actions" style={{ margin: 0 }}><Link className="btn secondary" href="/api-docs">API-dokumentation</Link><Link className="btn secondary" href="/">Mina bolag</Link></div></div>
      <Flash searchParams={searchParams} />
      <p className="muted">Bygg appar som kunderna kopplar till sina bolag. Kunden loggar in, väljer bolag och godkänner vad appen får göra – appen får aldrig lösenord eller API-nycklar.</p>
      <section className="card stack small">
        <b>OAuth 2 (authorization code med PKCE S256)</b>
        <div>Godkännande: <code>{origin}/oauth/authorize?response_type=code&amp;client_id=…&amp;redirect_uri=…&amp;scope=sales:read&amp;state=…&amp;code_challenge=…&amp;code_challenge_method=S256</code></div>
        <div>Token: <code>POST {origin}/oauth/token</code> (grant_type=authorization_code eller refresh_token). Åtkomst gäller en timme, refresh-token 60 dagar och byts vid varje användning.</div>
        <div>Återkalla: <code>POST {origin}/oauth/revoke</code>. Anropa sedan API:et med <code>Authorization: Bearer oat_…</code>.</div>
        <div>Zapier och Make (REST hooks): <code>POST /api/v1/hooks</code> med <code>{'{'} &quot;target_url&quot;, &quot;event&quot; {'}'}</code> och <code>DELETE /api/v1/hooks/:id</code>. Behörigheten <code>hooks:write</code> och läsrätt till händelsens område krävs.</div>
      </section>
      <h2>Mina appar</h2>
      {apps.length === 0 ? <p className="muted">Inga appar än.</p> : (
        <table><thead><tr><th>App</th><th>Klient-id</th><th>Typ</th><th className="num">Kopplade bolag</th><th /></tr></thead>
          <tbody>{apps.map((a) => (
            <tr key={a.id}><td>{a.name}<div className="small muted">{a.redirect_uris.join(', ')}</div></td><td><code>{a.client_id}</code></td><td>{a.confidential ? 'Med hemlighet' : 'Publik'}</td><td className="num">{a.companies}</td>
              <td className="num">{a.revoked ? <span className="badge">Avregistrerad</span> : <>{a.confidential && <RotateSecret action={rotate.bind(null, a.id)} />} <form action={revoke.bind(null, a.id)} style={{ display: 'inline' }}><button className="link">Avregistrera</button></form></>}</td></tr>
          ))}</tbody></table>
      )}
      <h2>Registrera app</h2>
      <CreateAppForm action={create} />
      <h2>Testmiljö</h2>
      <form action={sandbox} className="card row" style={{ alignItems: 'center' }}><span style={{ flex: '1 1 300px' }}>Ett demobolag med exempeldata att testa appen mot. Det räknas inte som ett riktigt bolag.</span><button className="secondary">Skapa testbolag</button></form>
    </div>
  );
}
