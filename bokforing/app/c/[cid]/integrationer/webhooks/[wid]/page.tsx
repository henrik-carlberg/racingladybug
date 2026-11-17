import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { removeWebhook, retry, rotateSecret, testWebhook, toggleWebhook } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function Webhook({ params, searchParams }: { params: Promise<{ cid: string; wid: string }>; searchParams: SP }) {
  const { cid, wid } = await params;
  const { company } = await requireCompany(cid, { owner: true });
  const [w] = await sql<{ id: number; url: string; description: string; events: string[]; active: boolean; secret: string }[]>`
    SELECT id, url, description, events, active, secret FROM webhook_endpoints WHERE id = ${Number(wid)} AND company_id = ${company.id}`;
  if (!w) notFound();
  const deliveries = await sql<{ id: number; type: string; event_id: string; status: string; attempts: number; code: number | null; error: string | null; at: string | null; next: string }[]>`
    SELECT d.id, e.type, e.public_id AS event_id, d.status, d.attempts, d.last_status_code AS code, d.last_error AS error,
      to_char(d.last_attempt_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI:SS') AS at,
      to_char(d.next_attempt_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS next
    FROM webhook_deliveries d JOIN events e ON e.id = d.event_id WHERE d.endpoint_id = ${w.id} ORDER BY d.id DESC LIMIT 100`;
  const b = `/c/${company.id}`;
  return (
    <>
      <h1>Webhook</h1>
      <Flash searchParams={searchParams} />
      <div className="card stack">
        <div><div className="muted small">URL</div><code className="mono">{w.url}</code></div>
        {w.description && <div><div className="muted small">Beskrivning</div>{w.description}</div>}
        <div><div className="muted small">Händelser</div><span className="mono small">{w.events.includes('*') ? 'Alla händelser' : w.events.join(', ')}</span></div>
        <details>
          <summary>Visa signeringshemlighet</summary>
          <code className="mono" style={{ userSelect: 'all', wordBreak: 'break-all' }}>{w.secret}</code>
          <p className="small muted">Verifiera headern <span className="mono">X-Bokforing-Signature: t=…,v1=…</span> där v1 = HMAC-SHA256(hemlighet, "t.body") i hex. Se <a href="/api-docs#webhooks">dokumentationen</a>.</p>
        </details>
        <div className="actions" style={{ margin: 0 }}>
          <form action={testWebhook.bind(null, company.id, w.id)}><button>Skicka testhändelse</button></form>
          <form action={toggleWebhook.bind(null, company.id, w.id, !w.active)}><button className="secondary">{w.active ? 'Pausa' : 'Aktivera'}</button></form>
          <form action={rotateSecret.bind(null, company.id, w.id)}><button className="secondary">Ny hemlighet</button></form>
          <form action={removeWebhook.bind(null, company.id, w.id)}><button className="danger">Ta bort</button></form>
          <Link href={`${b}/integrationer`}>Tillbaka</Link>
        </div>
      </div>
      <h2>Leveranser</h2>
      <p className="small muted">Misslyckade leveranser försöks igen efter 1 min, 5 min, 30 min, 2 h, 6 h, 12 h och 24 h.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Händelse</th><th>Status</th><th>Försök</th><th>Senaste försök</th><th>Svar</th><th></th></tr></thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id}>
                <td><span className="mono small">{d.type}</span><div className="small muted mono">{d.event_id}</div></td>
                <td>{d.status === 'succeeded' ? <span className="badge ok">Levererad</span> : d.status === 'failed' ? <span className="badge danger">Misslyckad</span> :
                  <span className="badge warn">Väntar{d.attempts ? ` (nästa ${d.next})` : ''}</span>}</td>
                <td className="num">{d.attempts}</td><td className="small">{d.at ?? ''}</td>
                <td className="small">{d.code ?? ''} {d.error && <span style={{ color: 'var(--danger)' }}>{d.error}</span>}</td>
                <td className="num">{d.status !== 'succeeded' && <form action={retry.bind(null, company.id, w.id, d.id)}><button className="link">Skicka igen</button></form>}</td>
              </tr>
            ))}
            {deliveries.length === 0 && <tr><td colSpan={6} className="muted">Inga leveranser ännu.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
