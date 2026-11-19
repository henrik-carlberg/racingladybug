import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { EmptyState, Flash, type SP } from '@/components/ui';
import { connectedApps, recentCalls } from '@/lib/services/oauth';
import { disconnectApp } from './actions';

export const dynamic = 'force-dynamic';

export default async function Apps({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { owner: true });
  const [apps, calls] = await Promise.all([connectedApps(ctx.company.id), recentCalls(ctx.company.id)]);
  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="header"><h1>Kopplade appar</h1><Link className="btn secondary" href={`/c/${ctx.company.id}/integrationer`}>API-nycklar och webhooks</Link></div>
      <Flash searchParams={searchParams} />
      <p className="muted">Appar som du (eller en annan ägare) har gett åtkomst till bolaget. Kopplar du bort en app slutar dess åtkomst och prenumerationer att gälla direkt.</p>
      {apps.length === 0 ? <EmptyState icon="puzzle" title="Inga kopplade appar">När du godkänner en app syns den här, med vad den får göra och hur ofta den används.</EmptyState> : apps.map((a) => (
        <section key={a.id} className="card app">
          <div className="header" style={{ marginBottom: '.3rem' }}><b>{a.app}</b><form action={disconnectApp.bind(null, ctx.company.id, a.id)}><button className="secondary">Koppla bort</button></form></div>
          <div className="small muted">Godkänd {a.created}{a.by ? ` av ${a.by}` : ''} · senast använd {a.last_used ?? 'aldrig'} · {a.calls} anrop senaste 30 dagarna · {a.hooks} prenumerationer</div>
          <div className="small">Behörigheter: {a.scopes.map((s) => <code key={s} style={{ marginRight: 6 }}>{s}</code>)}</div>
        </section>
      ))}
      <h2>Senaste anropen</h2>
      {calls.length === 0 ? <p className="muted">Inga anrop än.</p> : (
        <table className="small"><thead><tr><th>Tid</th><th>App eller nyckel</th><th>Anrop</th><th className="num">Status</th></tr></thead>
          <tbody>{calls.map((c, i) => <tr key={i}><td>{c.at}</td><td>{c.who}</td><td className="mono">{c.method} {c.path}</td><td className="num">{c.status}</td></tr>)}</tbody></table>
      )}
    </div>
  );
}
