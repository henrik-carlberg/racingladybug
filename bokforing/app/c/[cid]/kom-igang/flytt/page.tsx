import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Help } from '@/components/Help';
import { Icon } from '@/components/Icon';
import { PROGRAMS } from '@/lib/migration-check';
import { migrationStatus } from '@/lib/services/migration';

export const dynamic = 'force-dynamic';

/** Guide för att flytta från Fortnox, Visma, Bokio eller annat program */
export default async function Move({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<{ program?: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const program = (await searchParams).program ?? '';
  const p = PROGRAMS[program];
  const s = await migrationStatus(company.id);
  const b = `/c/${company.id}`;
  const step = (n: number, done: boolean, title: string, body: React.ReactNode) => (
    <div className={`card move-step${done ? ' done' : ''}`}>
      <div className="move-num" aria-hidden="true">{done ? <Icon name="check" size={16} /> : n}</div>
      <div style={{ flex: 1 }}><h3 style={{ margin: '0 0 .3rem' }}>{title} {done && <span className="badge ok">Klart</span>}</h3>{body}</div>
    </div>
  );
  return (
    <div style={{ maxWidth: 860 }}>
      <h1>Flytta från ett annat program</h1>
      <p className="muted">Ta med bokföringen, kunderna, leverantörerna och de obetalda fakturorna. Det tar oftast en kvart. Inget sparas förrän du har granskat det.</p>
      <div className="card">
        <b>Vilket program använder du i dag?</b>
        <div className="actions" style={{ margin: '.5rem 0 0' }}>
          {Object.entries(PROGRAMS).map(([k, x]) => <Link key={k} className={`btn ${program === k ? '' : 'secondary'}`} href={`${b}/kom-igang/flytt?program=${k}`}>{x.name}</Link>)}
        </div>
      </div>
      {step(1, !!s.sie, 'Bokföringen (SIE-fil)', <>
        <p style={{ margin: '0 0 .5rem' }}>Exportera en SIE-fil typ 4 för innevarande räkenskapsår <Help term="sie" />. {p && <span className="small">I {p.name}: {p.sie}</span>}</p>
        {s.sie ? <p className="small" style={{ margin: 0 }}>Importerat: {s.sie.filename} {s.sie.program ? `från ${s.sie.program}` : ''} · {s.sie.year_start} – {s.sie.year_end} · {s.sie.vouchers} verifikationer</p> : null}
        <Link className={s.sie ? 'btn secondary' : 'btn'} href={`${b}/kom-igang/sie-import`}>{s.sie ? 'Importera en till' : 'Importera SIE-fil'}</Link>
      </>)}
      {step(2, s.customers > 0 && s.suppliers > 0, 'Kunder och leverantörer', <>
        <p style={{ margin: '0 0 .5rem' }}>{p ? p.registers : 'Exportera registren som CSV.'} Kolumnerna känns igen automatiskt.</p>
        <p className="small" style={{ margin: '0 0 .5rem' }}>Nu: {s.customers} kunder och {s.suppliers} leverantörer.</p>
        <Link className="btn secondary" href={`${b}/installningar/import`}>Importera från CSV</Link>
      </>)}
      {step(3, s.imported_ar > 0 || s.imported_ap > 0, 'Obetalda fakturor', <>
        <p style={{ margin: '0 0 .5rem' }}>{p ? p.open : 'Exportera obetalda kund- och leverantörsfakturor som CSV.'} De bokförs inte igen – beloppen finns redan i de ingående saldona på 1510 och 2440 – men när de betalas bokas betalningen mot rätt faktura.</p>
        <p className="small" style={{ margin: '0 0 .5rem' }}>Nu: {s.open_ar} obetalda kundfakturor och {s.open_ap} obetalda leverantörsfakturor.</p>
        <Link className="btn secondary" href={`${b}/installningar/import`}>Importera obetalda fakturor</Link>
      </>)}
      {step(4, false, 'Kontrollera att allt stämmer', <>
        <p style={{ margin: '0 0 .5rem' }}>Jämför saldona i SIE-filen med bokföringen här, och de obetalda fakturorna med kundfordringar och leverantörsskulder.</p>
        <Link className="btn" href={`${b}/kom-igang/flytt/kontroll`}>Visa kontrollen</Link>
      </>)}
      <p className="small muted">Tips: säg upp det gamla programmet först när kontrollen visar att allt stämmer, och spara en egen kopia av SIE-filen.</p>
    </div>
  );
}
