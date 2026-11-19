import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/server/auth';
import { isOpsAdmin } from '@/lib/server/monitor';
import { Flash, type SP } from '@/components/ui';
import { integrationStatus } from '@/lib/integrations';
import { runTest } from '../actions';

export const dynamic = 'force-dynamic';

/** Vad som är uppsatt på servern och hur resten sätts upp (för den som driver tjänsten) */
export default async function Integrations({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  if (!(await isOpsAdmin(user))) notFound();
  const list = integrationStatus(process.env);
  const on = list.filter((i) => i.configured).length;
  return (
    <div className="center" style={{ maxWidth: 960 }}>
      <div className="header"><h1>Integrationer</h1><Link className="btn secondary" href="/drift">Tillbaka till driften</Link></div>
      <Flash searchParams={searchParams} />
      <p className="muted">{on} av {list.length} är uppsatta. Funktioner som saknar sin integration är avstängda i appen men fungerar i övrigt. Nycklarna läggs in som miljövariabler i Vercel (Settings → Environment Variables) och börjar gälla vid nästa deploy.</p>
      {list.map((i) => (
        <section key={i.key} id={i.key} className={`card integration ${i.configured ? 'on' : 'off'}`}>
          <div className="header" style={{ marginBottom: '.4rem' }}>
            <h2 style={{ margin: 0 }}>{i.configured ? '✓' : '○'} {i.name}</h2>
            {i.configured ? <span className="badge ok">Uppsatt</span> : <span className="badge warn">Saknas</span>}
          </div>
          <p className="small" style={{ margin: '0 0 .5rem' }}>{i.enables}.</p>
          {!i.configured && (
            <>
              <p className="small" style={{ margin: '0 0 .3rem' }}>Saknade variabler: {i.missing.map((v) => <code key={v} style={{ marginRight: 6 }}>{v}</code>)}</p>
              <ol className="small">{i.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            </>
          )}
          {i.configured && i.missingOptional.length > 0 && <p className="small muted" style={{ margin: 0 }}>Valfritt: {i.missingOptional.join(', ')}</p>}
          {i.configured && i.testable && <form action={runTest.bind(null, i.key)}><button className="secondary">Testa</button></form>}
        </section>
      ))}
    </div>
  );
}
