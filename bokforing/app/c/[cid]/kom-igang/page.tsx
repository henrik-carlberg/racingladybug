import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { getSetup } from '@/lib/services/setup';
import { Flash, type SP } from '@/components/ui';
import { setHasEmployees, skipStep } from './actions';

export const dynamic = 'force-dynamic';

export default async function GettingStarted({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid);
  const { steps, flags, done, total } = await getSetup(ctx.company.id, ctx.user.id);
  const pct = Math.round((done / total) * 100);
  return (
    <div style={{ maxWidth: 820 }}>
      <h1>Kom igång med {ctx.company.name}</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Gå igenom stegen i din egen takt. Det mesta bockas av automatiskt när det är gjort.</p>
      <div className="learned small">Byter du från Fortnox, Visma, Bokio eller ett annat program? <Link href={`/c/${ctx.company.id}/kom-igang/flytt`}>Flytta bokföringen, kunderna och de obetalda fakturorna →</Link></div>
      <div style={{ background: 'var(--border)', borderRadius: 6, height: 10, margin: '1rem 0' }}>
        <div style={{ width: `${pct}%`, background: 'var(--ok)', height: 10, borderRadius: 6 }} />
      </div>
      <p className="small">{done} av {total} klara</p>
      {steps.map((s, i) => {
        const finished = s.done || s.skipped;
        return (
          <div key={s.key} className="card" style={finished ? { opacity: 0.65 } : { borderColor: 'var(--accent)' }}>
            <div className="header" style={{ marginBottom: '.25rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{s.done ? '✅' : s.skipped ? '⏭️' : `${i + 1}.`} {s.title}{s.optional && <span className="badge" style={{ marginLeft: 8 }}>Valfritt</span>}</h2>
              {!s.done && (
                <div className="actions" style={{ margin: 0 }}>
                  {s.key === 'payroll' && flags.has_employees === undefined ? (
                    <>
                      <form action={setHasEmployees.bind(null, ctx.company.id, true)}><button>Ja, lägg upp anställda</button></form>
                      <form action={setHasEmployees.bind(null, ctx.company.id, false)}><button className="secondary">Nej, inga anställda</button></form>
                    </>
                  ) : (
                    <Link className="btn" href={s.href}>{s.action}</Link>
                  )}
                  <form action={skipStep.bind(null, ctx.company.id, s.key, !s.skipped)}>
                    <button className="link small">{s.skipped ? 'Ångra hoppa över' : 'Hoppa över'}</button>
                  </form>
                </div>
              )}
            </div>
            <p className="small" style={{ margin: 0 }}>{s.description}</p>
          </div>
        );
      })}
      <div className="card">
        <b>Sedan då?</b>
        <ul className="small" style={{ marginBottom: 0 }}>
          <li><Link href={`/c/${ctx.company.id}/kvitto`}>Registrera kvitton</Link> löpande – fota direkt med mobilen.</li>
          <li><Link href={`/c/${ctx.company.id}/fakturor/ny`}>Skicka fakturor</Link> och stäm av inbetalningar mot banken.</li>
          <li>Håll koll på <Link href={`/c/${ctx.company.id}/deadlines`}>deadlines</Link> för moms, arbetsgivardeklaration och bokslut.</li>
        </ul>
      </div>
    </div>
  );
}
