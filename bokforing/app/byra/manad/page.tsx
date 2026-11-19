import Link from 'next/link';
import { requireUser } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { today } from '@/lib/format';
import { myFirms } from '@/lib/services/firms';
import { firmMonth, prevPeriod } from '@/lib/services/firm-close';
import { markClose, remind } from '../actions';

export const dynamic = 'force-dynamic';

/** Månadsbokslut för alla klienter: vilka som är klara, väntar på kunden eller har något kvar */
export default async function MonthClose({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const firms = await myFirms(user.id);
  const firm = firms.find((f) => String(f.id) === sp.f) ?? firms[0];
  if (!firm) return <div className="center"><p>Du är inte med i någon byrå. <Link href="/byra">Skapa en byrå</Link></p></div>;
  const period = /^\d{4}-\d{2}$/.test(String(sp.period)) ? String(sp.period) : prevPeriod(today());
  const rows = await firmMonth(user.id, firm.id, period);
  const shift = (n: number) => { const d = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const doneN = rows.filter((r) => r.done).length, waitingN = rows.filter((r) => !r.done && r.waiting).length;
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem 16px' }}>
      <div className="header">
        <h1>Månadsbokslut {period}</h1>
        <div className="actions" style={{ margin: 0 }}>
          <Link className="btn secondary" href={`/byra/manad?f=${firm.id}&period=${shift(-1)}`}>← {shift(-1)}</Link>
          <Link className="btn secondary" href={`/byra/manad?f=${firm.id}&period=${shift(1)}`}>{shift(1)} →</Link>
          <Link className="btn secondary" href={`/byra?f=${firm.id}`}>Klienter</Link>
          <Link className="btn secondary" href={`/byra/tid?f=${firm.id}&period=${period}`}>Byråns tid</Link>
        </div>
      </div>
      <Flash searchParams={searchParams} />
      <div className="grid">
        <div className="card stat"><div className="label">Klara</div><div className="value">{doneN} av {rows.length}</div></div>
        <div className="card stat"><div className="label">Väntar på kunden</div><div className="value">{waitingN}</div></div>
        <div className="card stat"><div className="label">Kvar att göra</div><div className="value">{rows.length - doneN - waitingN}</div></div>
      </div>
      {rows.map((r) => (
        <details key={r.id} className={`card close-row ${r.done ? 'done' : r.waiting ? 'waiting' : ''}`}>
          <summary>
            <b>{r.name}</b> <span className="small muted">{r.responsible ?? 'Ingen ansvarig'}</span>
            <span style={{ marginLeft: 'auto' }}>{r.done ? <span className="badge ok">Klar {r.done}</span> : r.waiting ? <span className="badge warn">Väntar på kunden</span> : <span className="badge">{r.ok} av {r.total} klara</span>}</span>
          </summary>
          <ul className="checklist">{r.checks.map((c) => <li key={c.key} className={c.ok ? 'ok' : ''}>{c.ok ? '✓' : '○'} <Link href={c.href}>{c.title}</Link> <span className="small muted">– {c.detail}</span></li>)}</ul>
          <div className="actions" style={{ margin: 0 }}>
            {!r.done ? <form action={markClose.bind(null, firm.id, r.id, period, true)}><button className={r.ok === r.total ? '' : 'secondary'}>Markera månaden som klar</button></form>
              : <form action={markClose.bind(null, firm.id, r.id, period, false)}><button className="link">Ångra klar</button></form>}
            {!r.done && r.waiting > 0 && <form action={remind.bind(null, firm.id, r.id, period)}><button className="secondary">Påminn kunden om allt som saknas</button></form>}
            {r.reminded && <span className="small muted">Påmind {r.reminded}</span>}
          </div>
        </details>
      ))}
      {rows.length === 0 && <p className="muted">Inga klienter ännu.</p>}
    </div>
  );
}
