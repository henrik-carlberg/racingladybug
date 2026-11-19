import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { latestIntegrity } from '@/lib/services/integrity';
import { runNow } from './actions';

export const dynamic = 'force-dynamic';

export default async function Integrity({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company, role } = await requireCompany(cid, { perm: 'ledger', allowLocked: true });
  const r = await latestIntegrity(company.id);
  return (
    <div style={{ maxWidth: 860 }}>
      <h1>Integritetskontroll</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Varje natt kontrolleras att alla verifikationer går jämnt ut, att verifikationsnumren saknar luckor, att datumen ligger inom räkenskapsåret, att inget har bokförts i låsta perioder och att underlag finns.</p>
      {r ? (
        <div className={`card status-row ${r.errors ? 'todo' : 'ok'}`}>
          <span className="status-icon" aria-hidden="true">{r.errors ? '!' : '✓'}</span>
          <div style={{ flex: 1 }}><b>{r.errors ? `${r.errors} avvikelser` : 'Inga fel'}{r.warnings ? `, ${r.warnings} att se över` : ''}</b><div className="small muted">Senast kontrollerad {r.run_at}</div></div>
        </div>
      ) : <p className="small muted">Ingen kontroll har körts än.</p>}
      {r?.issues.map((i) => (
        <div key={i.key} className={`check-item ${i.severity === 'error' ? 'error' : 'warn'}`} style={{ marginBottom: '.4rem' }}>
          <span>{i.severity === 'error' ? '⛔' : '⚠️'}</span><span><b>{i.title}</b> – {i.detail} {i.href && <Link href={i.href}>Visa</Link>}</span>
        </div>
      ))}
      {role !== 'auditor' && <form action={runNow.bind(null, company.id)} style={{ marginTop: '1rem' }}><button className="secondary">Kontrollera nu</button></form>}
      <p className="small"><Link href={`/c/${company.id}/installningar/systemdokumentation`}>Systemdokumentation och arkivpaket</Link></p>
    </div>
  );
}
