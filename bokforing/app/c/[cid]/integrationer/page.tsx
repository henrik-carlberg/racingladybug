import Link from 'next/link';
import { headers } from 'next/headers';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { listApiKeys } from '@/lib/server/apikeys';
import { allEventTypes } from '@/lib/server/integrations';
import { allScopes } from '@/lib/api/scopes';
import { Flash, type SP } from '@/components/ui';
import { ApiKeyForm } from '@/components/ApiKeyForm';
import { addApiKey, addWebhook, revokeKey } from './actions';

export const dynamic = 'force-dynamic';

export default async function Integrations({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company, role } = await requireCompany(cid);
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`;
  if (role !== 'owner') {
    return (<><h1>Integrationer</h1><p>Endast bolagets ägare kan hantera API-nycklar och webhooks.</p>
      <p>API-dokumentation: <a href="/api-docs">{origin}/api-docs</a></p></>);
  }
  const keys = await listApiKeys(company.id);
  const hooks = await sql<{ id: number; url: string; description: string; events: string[]; active: boolean; ok: number; failed: number; pending: number }[]>`
    SELECT w.id, w.url, w.description, w.events, w.active,
      count(d.id) FILTER (WHERE d.status = 'succeeded')::int AS ok, count(d.id) FILTER (WHERE d.status = 'failed')::int AS failed,
      count(d.id) FILTER (WHERE d.status = 'pending')::int AS pending
    FROM webhook_endpoints w LEFT JOIN webhook_deliveries d ON d.endpoint_id = w.id AND d.created_at > now() - interval '30 days'
    WHERE w.company_id = ${company.id} GROUP BY w.id ORDER BY w.id`;
  const events = allEventTypes();
  const b = `/c/${company.id}`;
  return (
    <>
      <h1>Integrationer</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Koppla andra system (CRM, ERP, e-handel, BI m.m.) via REST-API och webhooks.
        Dokumentation: <a href="/api-docs">API-dokumentation</a> · <a href="/api/v1/openapi.json">OpenAPI-specifikation</a> · <a href="/utvecklare">Bygg en app (OAuth)</a> · <a href={`/c/${company.id}/installningar/appar`}>Kopplade appar</a>. Bas-URL: <code className="mono">{origin}/api/v1</code></p>

      <h2>API-nycklar</h2>
      <table>
        <thead><tr><th>Namn</th><th>Nyckel</th><th>Behörigheter</th><th>Senast använd</th><th></th></tr></thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id} style={k.revoked_at ? { opacity: 0.5 } : undefined}>
              <td>{k.name}<div className="small muted">Skapad {k.created_at} av {k.created_by}</div></td>
              <td className="mono small">{k.prefix}…</td>
              <td className="small mono">{k.scopes.join(' ')}</td>
              <td className="small">{k.last_used_at ?? 'Aldrig'}</td>
              <td className="num">{k.revoked_at ? <span className="badge">Återkallad</span> :
                <form action={revokeKey.bind(null, company.id, k.id)}><button className="link">Återkalla</button></form>}</td>
            </tr>
          ))}
          {keys.length === 0 && <tr><td colSpan={5} className="muted">Inga API-nycklar.</td></tr>}
        </tbody>
      </table>
      <h3>Ny API-nyckel</h3>
      <ApiKeyForm action={addApiKey.bind(null, company.id)} scopes={allScopes()} />
      <p className="small muted">Ge varje system en egen nyckel med så få behörigheter som möjligt. Allt som görs via en nyckel loggas i behandlingshistoriken med nyckelns namn.
        <span className="mono">:write</span> innefattar <span className="mono">:read</span>.</p>

      <h2>Webhooks</h2>
      <table>
        <thead><tr><th>URL</th><th>Händelser</th><th>Senaste 30 dagarna</th><th></th></tr></thead>
        <tbody>
          {hooks.map((w) => (
            <tr key={w.id}>
              <td><Link href={`${b}/integrationer/webhooks/${w.id}`} className="mono small">{w.url}</Link><div className="small muted">{w.description}</div></td>
              <td className="small mono">{w.events.includes('*') ? 'Alla' : w.events.join(', ')}</td>
              <td className="small">{w.ok} lyckade{w.failed ? `, ${w.failed} misslyckade` : ''}{w.pending ? `, ${w.pending} väntar` : ''}</td>
              <td>{w.active ? <span className="badge ok">Aktiv</span> : <span className="badge">Pausad</span>}</td>
            </tr>
          ))}
          {hooks.length === 0 && <tr><td colSpan={4} className="muted">Inga webhooks.</td></tr>}
        </tbody>
      </table>
      <h3>Ny webhook</h3>
      <form action={addWebhook.bind(null, company.id)} className="card stack">
        <div className="row">
          <label style={{ flex: '3 1 320px' }}>URL (https)<input name="url" type="url" required placeholder="https://example.com/webhooks/bokforing" /></label>
          <label>Beskrivning<input name="description" /></label>
        </div>
        <label className="check"><input type="checkbox" name="events" value="*" /> <b>Alla händelser</b> (även framtida)</label>
        <div className="grid" style={{ gap: '.25rem 1rem' }}>
          {events.map((e) => (
            <label key={e.type} className="check" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" name="events" value={e.type} />
              <span><span className="mono small">{e.type}</span><br /><span className="small muted">{e.description}</span></span>
            </label>
          ))}
        </div>
        <div><button>Skapa webhook</button></div>
      </form>
    </>
  );
}
