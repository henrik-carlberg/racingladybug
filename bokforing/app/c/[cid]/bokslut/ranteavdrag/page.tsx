import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { EmptyState, Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { CARRY_YEARS } from '@/lib/interest-limit';
import { interestLimit } from '@/lib/services/interest-limit';
import { saveSimplification } from './actions';

export const dynamic = 'force-dynamic';
const RULE: Record<string, string> = { none: 'Inget negativt räntenetto', simplification: 'Förenklingsregeln', ebitda: 'EBITDA-regeln (30 %)' };

/** Ränteavdragsbegränsning år för år med sparat negativt räntenetto */
export default async function InterestLimit({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  if (company.company_type !== 'AB') return <div style={{ maxWidth: 760 }}><h1>Ränteavdragsbegränsning</h1><EmptyState icon="briefcase" title="Gäller företag">Reglerna om ränteavdragsbegränsning gäller aktiebolag och andra juridiska personer.</EmptyState></div>;
  const d = await interestLimit(company.id);
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Ränteavdragsbegränsning</h1>
      <p className="small"><Link href={`/c/${company.id}/bokslut`}>← Bokslut</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">Ett negativt räntenetto (räntekostnader minus ränteintäkter) får dras av med högst 30 % av skattemässig EBITDA. Är räntenettot högst förenklingsbeloppet
        ({kr(d.simplification)} kr) får hela beloppet dras av. Det som inte får dras av sparas och kan användas inom {CARRY_YEARS} år när det finns utrymme.</p>
      <table className="il-years"><thead><tr><th>År</th><th className="num">Negativt räntenetto</th><th className="num">Skattemässig EBITDA</th><th className="num">Utrymme 30 %</th><th>Regel</th>
        <th className="num">Avdrag i år</th><th className="num">Ej avdragsgillt</th><th className="num">Sparat använt</th><th className="num">Sparat kvar</th></tr></thead>
        <tbody>{d.rows.map((r) => (
          <tr key={r.start} className="il-row" data-year={r.year}><td>{r.year}</td><td className="num">{kr(r.netCost)}</td><td className="num">{kr(r.ebitda)}</td><td className="num">{kr(r.room)}</td><td>{RULE[r.rule]}</td>
            <td className="num il-deductible">{kr(r.deductible)}</td><td className="num il-nondeductible">{kr(r.nonDeductible)}</td><td className="num il-used">{kr(r.usedSaved)}</td><td className="num il-saved">{kr(r.savedOut)}</td></tr>))}</tbody></table>
      <p className="small muted">Ej avdragsgill ränta läggs till och utnyttjat sparat räntenetto dras av i INK2S; beräkningen redovisas i bilaga N9. Det skattemässiga resultatet hämtas från bokslutet eller den justering som gjorts under Underskottsavdrag.</p>
      <form action={saveSimplification.bind(null, company.id)} className="card row">
        <label>Bolagets andel av förenklingsbeloppet (kr) – i en koncern delas 5 000 000 kr<input name="simplification" defaultValue={(d.simplification / 100).toFixed(0)} /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Spara</button></div>
      </form>
    </div>
  );
}
