import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { KpiTiles } from '@/components/KpiTiles';
import { ReportTable } from '@/components/ReportTable';
import { ROLE_KPIS } from '@/lib/report-builder';
import { getReport, kpiView, resolveShare, runReport } from '@/lib/services/custom-reports';
import { today } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };

/** Delad, läsbar rapport eller nyckeltal – ingen inloggning, slutar gälla vid angivet datum */
export default async function Shared({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await resolveShare(token);
  if (!s) notFound();
  const year = Number(today().slice(0, 4));
  return (
    <div className="center" style={{ maxWidth: 1100 }}>
      <div className="header"><div><h1>{s.company}</h1><div className="small muted">Org.nr {s.orgnr} · Hämtat {today()} · Länken gäller till {s.expires}</div></div></div>
      {s.kind === 'report' ? await (async () => {
        const r = await getReport(s.company_id, s.report_id!);
        const out = await runReport(s.company_id, r.definition, year);
        return <><h2>{r.name}</h2><ReportTable columns={out.columns} rows={out.rows} budget={out.hasBudget} /></>;
      })() : await (async () => {
        const k = await kpiView(s.company_id);
        return <><h2>Nyckeltal hittills i år</h2><p className="small muted">{k.period}, jämfört med samma period i fjol.</p><KpiTiles keys={ROLE_KPIS[(s.role ?? 'styrelse') as keyof typeof ROLE_KPIS]} now={k.now} prev={k.prev} /></>;
      })()}
      <p className="small muted">Siffrorna kommer direkt från bolagets bokföring och är inte reviderade.</p>
    </div>
  );
}
