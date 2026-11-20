import Link from 'next/link';
import { requireUser } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { myLoginLog, mySessions } from '@/lib/services/company-login';
import { deviceLabel } from '@/lib/sso';
import { endSession } from './actions';

export const dynamic = 'force-dynamic';

export default async function MySessions({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sessions = await mySessions(user.id);
  const log = await myLoginLog(user.id);
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 16 }}>
      <div className="header"><h1>Mina sessioner</h1><Link className="btn secondary" href="/konto">Mitt konto</Link></div>
      <Flash searchParams={searchParams} />
      <div className="table-wrap"><table className="my-sessions">
        <thead><tr><th>Enhet</th><th>Inloggad</th><th>Senast aktiv</th><th>IP</th><th></th></tr></thead>
        <tbody>{sessions.map((s) => (
          <tr key={s.ref} className="my-session"><td>{s.device}</td><td>{s.created_at} ({s.method})</td><td>{s.last_seen_at}</td><td>{s.ip ?? ''}</td>
            <td>{s.current ? <span className="muted">Den här enheten</span> : <form action={endSession.bind(null, s.ref)}><button className="secondary">Logga ut</button></form>}</td></tr>
        ))}</tbody>
      </table></div>
      <h2>Senaste inloggningar</h2>
      <div className="table-wrap"><table className="my-log">
        <thead><tr><th>Tid</th><th>Sätt</th><th>Resultat</th><th>IP</th><th>Enhet</th></tr></thead>
        <tbody>{log.map((e, i) => <tr key={i} className={e.success ? 'ok' : 'failed'}><td>{e.at}</td><td>{e.method}</td><td>{e.success ? 'Lyckad' : `Misslyckad ${e.reason}`}</td><td>{e.ip ?? ''}</td><td>{deviceLabel(e.user_agent)}</td></tr>)}</tbody>
      </table></div>
      <p className="small muted">Ser du en inloggning du inte känner igen? Logga ut den, byt lösenord och slå på tvåstegsverifiering under Mitt konto.</p>
    </div>
  );
}
