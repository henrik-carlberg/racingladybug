import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { enabledModules } from '@/lib/modules/enabled';
import { MODULES } from '@/modules/registry';
import { Flash, type SP } from '@/components/ui';
import { toggleModule } from '../integrationer/actions';

export const dynamic = 'force-dynamic';

export default async function Modules({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company, role } = await requireCompany(cid);
  const enabled = new Set((await enabledModules(company.id)).map((m) => m.id));
  return (
    <>
      <h1>Moduler</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Tilläggsmoduler bygger på bokföringens data och händelser. De kan aktiveras per bolag och har egna sidor, API-endpoints och webhook-händelser.</p>
      <div className="grid">
        {MODULES.map((m) => {
          const on = enabled.has(m.id);
          return (
            <div key={m.id} className="card stack">
              <div className="header" style={{ margin: 0 }}>
                <h2 style={{ margin: 0 }}>{m.name}</h2>
                {on ? <span className="badge ok">Aktiv</span> : <span className="badge">Inaktiv</span>}
              </div>
              <p style={{ margin: 0 }}>{m.description}</p>
              <div className="small muted">
                Version {m.version}
                {m.api?.length ? <> · {m.api.length} API-endpoints under <span className="mono">/api/v1/m/{m.id}</span></> : null}
                {m.events?.length ? <> · händelser: <span className="mono">{m.events.map((e) => e.type).join(', ')}</span></> : null}
              </div>
              <div className="actions" style={{ margin: 0 }}>
                {on && <Link className="btn secondary" href={`/c/${company.id}/m/${m.id}`}>Öppna</Link>}
                {role === 'owner' && (
                  <form action={toggleModule.bind(null, company.id, m.id, !on)}><button className={on ? 'link' : ''}>{on ? 'Avaktivera' : 'Aktivera'}</button></form>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {role !== 'owner' && <p className="small muted">Endast ägaren kan aktivera och avaktivera moduler.</p>}
      <p className="small muted">Avaktivering döljer modulen men raderar inte dess data.</p>
    </>
  );
}
