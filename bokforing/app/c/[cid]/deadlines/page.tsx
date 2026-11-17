import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { companyDeadlines, deadlinePrep } from '@/lib/services/deadlines';
import { Flash, type SP } from '@/components/ui';
import { mark } from './actions';

export const dynamic = 'force-dynamic';

const BADGE = { overdue: ['Försenad', 'danger'], soon: ['Snart', 'warn'], upcoming: ['Kommande', ''], done: ['Klar', 'ok'] } as const;
const fmt = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

export default async function Deadlines({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const sp = await searchParams;
  const list = await companyDeadlines(company.id);
  const prep = await deadlinePrep(company.id);
  const showDone = sp.visa === 'alla';
  const shown = list.filter((d) => showDone || d.status !== 'done');
  const groups: [string, typeof list][] = [
    ['Försenade', shown.filter((d) => d.status === 'overdue')],
    ['Inom två veckor', shown.filter((d) => d.status === 'soon')],
    ['Kommande', shown.filter((d) => d.status === 'upcoming')],
    ...(showDone ? [['Klara', shown.filter((d) => d.status === 'done')] as [string, typeof list]] : []),
  ];
  const hint = (d: (typeof list)[number]) => {
    if (d.kind === 'vat' && prep.vat.has(d.periodEnd!)) return '✓ Momsavräkningen är bokförd – deklarera i Skatteverkets e-tjänst och bocka av.';
    if (d.kind === 'vat') return 'Steg: bokför momsavräkning för perioden → fyll i rutorna i Skatteverkets e-tjänst → betala.';
    if (d.kind === 'agi' && prep.payroll.has(d.periodStart!.slice(0, 7))) return '✓ Lönen är bokförd – ladda upp AGI-filen hos Skatteverket och bocka av.';
    if ((d.kind === 'ink2' || d.kind === 'ink1' || d.kind === 'arsredovisning' || d.kind === 'bokslut') && prep.closed.has(d.periodEnd!)) return '✓ Året är stängt – underlagen finns under Bokslut & deklaration.';
    return null;
  };
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Deadlines</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Anpassat efter {company.company_type === 'AB' ? 'aktiebolag' : 'enskild firma'}, momsredovisning per {company.vat_period === 'month' ? 'månad' : company.vat_period === 'quarter' ? 'kvartal' : 'år'}
        {company.f_skatt ? ', F-skatt' : ''}. Datum som infaller på helg flyttas till nästa vardag. Gäller företag med omsättning under 40 Mkr utan EU-handel.
        Bocka av när du har lämnat in – appen kan inte se vad som skickats till myndigheterna.</p>
      <p className="small"><Link href={`/c/${company.id}/deadlines${showDone ? '' : '?visa=alla'}`}>{showDone ? 'Dölj klara' : 'Visa även klara'}</Link></p>
      {groups.map(([title, items]) => items.length > 0 && (
        <div key={title}>
          <h2>{title}</h2>
          {items.map((d) => (
            <div key={d.key} className="card" style={d.status === 'overdue' ? { borderColor: 'var(--danger)' } : undefined}>
              <div className="header" style={{ marginBottom: '.25rem' }}>
                <div>
                  <span className={`badge ${BADGE[d.status][1]}`}>{BADGE[d.status][0]}</span> <b>{d.title}</b>
                  <div className="small">Senast <b>{fmt(d.due)}</b></div>
                </div>
                <div className="actions" style={{ margin: 0 }}>
                  {d.status !== 'done' && <Link className="btn secondary" href={d.href}>Öppna</Link>}
                  <form action={mark.bind(null, company.id, d.key, d.status !== 'done')}>
                    <button className={d.status === 'done' ? 'link' : ''}>{d.status === 'done' ? 'Ångra' : 'Markera klar'}</button>
                  </form>
                </div>
              </div>
              <div className="small muted">{d.doneHow ?? d.help}</div>
              {d.status !== 'done' && hint(d) && <div className="small" style={{ marginTop: 4 }}>{hint(d)}</div>}
            </div>
          ))}
        </div>
      ))}
      {shown.length === 0 && <p>Inga deadlines att visa.</p>}
    </div>
  );
}
