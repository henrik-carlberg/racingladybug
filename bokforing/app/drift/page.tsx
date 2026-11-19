import Link from 'next/link';
import { jobStats } from '@/lib/server/jobs';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireUser } from '@/lib/server/auth';
import { isOpsAdmin, CRON_EXPECTED_HOURS } from '@/lib/server/monitor';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { resolveError } from './actions';

export const dynamic = 'force-dynamic';

/** Driftsida för den som driver tjänsten (OPS_ADMIN_EMAILS) */
export default async function Ops({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  if (!(await isOpsAdmin(user))) notFound();
  const [[stats], errors, crons, signups, limits] = await Promise.all([
    sql<{ companies: number; users: number; active: number; trial: number; mrr: number; vouchers: number }[]>`
      SELECT (SELECT count(*)::int FROM companies) AS companies, (SELECT count(*)::int FROM users WHERE email NOT LIKE 'raderad-%') AS users,
        (SELECT count(*)::int FROM subscriptions WHERE status = 'active') AS active, (SELECT count(*)::int FROM subscriptions WHERE status = 'trialing') AS trial,
        COALESCE((SELECT SUM(monthly_amount)::bigint FROM subscriptions WHERE status = 'active'), 0) AS mrr,
        (SELECT count(*)::int FROM vouchers WHERE created_at > now() - interval '7 days') AS vouchers`,
    sql<{ id: number; message: string; path: string; kind: string; count: number; first_seen: string; last_seen: string; stack: string }[]>`
      SELECT id, message, path, kind, count, to_char(first_seen,'YYYY-MM-DD HH24:MI') AS first_seen, to_char(last_seen,'YYYY-MM-DD HH24:MI') AS last_seen, stack
      FROM error_log WHERE resolved_at IS NULL ORDER BY last_seen DESC LIMIT 50`,
    sql<{ job: string; last_ok: string | null; last_started: string | null; last_error: string; hours: number | null }[]>`
      SELECT job, to_char(last_ok,'YYYY-MM-DD HH24:MI') AS last_ok, to_char(last_started,'YYYY-MM-DD HH24:MI') AS last_started, last_error,
        extract(epoch FROM now() - last_ok) / 3600 AS hours FROM cron_runs ORDER BY job`,
    sql<{ day: string; n: number }[]>`SELECT to_char(created_at,'YYYY-MM-DD') AS day, count(*)::int AS n FROM users WHERE created_at > now() - interval '14 days' GROUP BY 1 ORDER BY 1 DESC`,
    sql<{ key: string; count: number }[]>`SELECT split_part(key, ':', 1) AS key, SUM(count)::int AS count FROM rate_limits WHERE window_start > now() - interval '1 hour' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
  ]);
  const jobs = await jobStats();
  const [integ] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM (SELECT DISTINCT ON (company_id) errors FROM integrity_runs ORDER BY company_id, run_at DESC) x WHERE errors > 0`;
  return (
    <div className="center" style={{ maxWidth: 1100 }}>
      <div className="header"><h1>Drift</h1><Link className="btn secondary" href="/drift/installningar">Integrationer</Link></div>
      <Flash searchParams={searchParams} />
      <div className="grid">
        {[['Bolag', stats.companies], ['Användare', stats.users], ['Betalande abonnemang', stats.active], ['Verifikationer senaste 7 dagarna', stats.vouchers]].map(([l, v]) => (
          <div key={String(l)} className="card stat"><div className="label">{l}</div><div className="value">{v}</div></div>
        ))}
        {stats.mrr > 0 && <div className="card stat"><div className="label">Månadsintäkt</div><div className="value">{kr(stats.mrr)}</div></div>}
      </div>
      <h2>Fel ({errors.length})</h2>
      {errors.length === 0 ? <p className="muted">Inga olösta fel.</p> : errors.map((e) => (
        <details key={e.id} className="card small">
          <summary><b>{e.message}</b> <span className="muted">· {e.count} gånger · senast {e.last_seen} · {e.kind} {e.path}</span></summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '.75rem' }}>{e.stack}</pre>
          <form action={resolveError.bind(null, e.id)}><button className="secondary">Markera som åtgärdat</button></form>
        </details>
      ))}
      <h2>Integritetskontroll</h2>
      <p className="small" style={integ.n ? { color: 'var(--danger)' } : undefined}>{integ.n} bolag med avvikelser i senaste kontrollen</p>
      <h2>Jobbkö</h2>
      <p className="small">{jobs.queued} i kö{jobs.oldest ? ` (äldst ${jobs.oldest})` : ''} · <span style={jobs.failed ? { color: 'var(--danger)' } : undefined}>{jobs.failed} misslyckade</span></p>
      <h2>Schemalagda jobb</h2>
      <table className="small"><thead><tr><th>Jobb</th><th>Senast lyckat</th><th>Senast startat</th><th>Fel</th></tr></thead><tbody>
        {crons.map((c) => {
          const stale = c.hours != null && c.hours > (CRON_EXPECTED_HOURS[c.job] ?? 26);
          return <tr key={c.job}><td>{c.job}</td><td style={stale ? { color: 'var(--danger)' } : undefined}>{c.last_ok ?? '–'}</td><td>{c.last_started ?? '–'}</td><td className="muted">{c.last_error}</td></tr>;
        })}
        {crons.length === 0 && <tr><td colSpan={4} className="muted">Inga körningar ännu.</td></tr>}
      </tbody></table>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 300px' }}><h2>Nya konton</h2><table className="small"><tbody>{signups.map((s) => <tr key={s.day}><td>{s.day}</td><td className="num">{s.n}</td></tr>)}</tbody></table></div>
        <div style={{ flex: '1 1 300px' }}><h2>Begränsade anrop senaste timmen</h2><table className="small"><tbody>{limits.map((l) => <tr key={l.key}><td>{l.key}</td><td className="num">{l.count}</td></tr>)}</tbody></table></div>
      </div>
      <p className="small muted">Hälsokontroll för övervakning: <code>/api/health</code> (200 = allt bra, 503 = problem). Larm skickas med e-post till OPS_ADMIN_EMAILS högst en gång i timmen per feltyp.</p>
    </div>
  );
}
