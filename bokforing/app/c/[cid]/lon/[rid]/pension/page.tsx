import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCompany } from '@/lib/server/auth';
import { NotFoundError } from '@/lib/errors';
import { kr } from '@/lib/format';
import { pensionReport } from '@/lib/services/agreements';

export const dynamic = 'force-dynamic';

export default async function Pension({ params }: { params: Promise<{ cid: string; rid: string }> }) {
  const { cid, rid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const { run, rows } = await pensionReport(company.id, Number(rid)).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const b = `/c/${company.id}/lon/${run.id}`;
  const sum = (k: 'pension' | 'slp' | 'insurance') => rows.reduce((s, r) => s + r[k], 0);
  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="header"><h1>Pension och försäkringar {run.period}</h1><Link className="btn secondary" href={b}>Tillbaka</Link></div>
      <table>
        <thead><tr><th>Anställd</th><th>Plan</th><th className="num">Bruttolön</th><th className="num">Premie</th><th className="num">Särskild löneskatt</th><th className="num">Fora-försäkringar</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.employee_id}><td>{r.name}{r.sacrificeWarning && <div className="small" style={{ color: 'var(--danger)' }}>{r.sacrificeWarning}</div>}{Number(r.sacrifice) > 0 && <div className="small muted">Löneväxling {kr(Number(r.sacrifice))}/mån</div>}</td>
            <td>{r.planLabel}</td><td className="num">{kr(r.gross)}</td><td className="num">{kr(r.pension)}</td><td className="num">{kr(r.slp)}</td><td className="num">{kr(r.insurance)}</td></tr>
        ))}</tbody>
        <tfoot><tr><th colSpan={3}>Summa</th><th className="num">{kr(sum('pension'))}</th><th className="num">{kr(sum('slp'))}</th><th className="num">{kr(sum('insurance'))}</th></tr></tfoot>
      </table>
      <div className="actions">
        {rows.some((r) => r.plan === 'itp1' || r.plan === 'itp2') && <a className="btn secondary" href={`${b}/pension/collectum`} download>Ladda ner Collectum-fil (ITP)</a>}
        {rows.some((r) => r.plan === 'saf_lo') && <a className="btn secondary" href={`${b}/pension/fora`} download>Ladda ner Fora-rapport (SAF-LO)</a>}
      </div>
      <p className="small muted">Collectum-filen innehåller periodens nyanmälningar, avanmälningar och ändrade årslöner för ITP 2 (månadslön × 12,2). Fora-rapporten innehåller lönesumman per arbetare för avtalspension SAF-LO. Premien bokförs på 7411 mot 2990 och den särskilda löneskatten på 7533 mot 2514.</p>
    </div>
  );
}
