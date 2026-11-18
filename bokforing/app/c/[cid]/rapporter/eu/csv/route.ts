import { requireCompany } from '@/lib/server/auth';
import { periodicSummary, periodicSummaryCsv, periodRange } from '@/lib/eu';
import { euLines } from '@/lib/services/eu';

export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const period = new URL(req.url).searchParams.get('period') ?? '';
  const r = periodRange(period);
  if (!r) return new Response('Ogiltig period', { status: 400 });
  const ps = periodicSummary(await euLines(company.id, r.from, r.to));
  const body = periodicSummaryCsv({ vatNumber: company.vat_number, period, rows: ps.rows });
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="periodisk-sammanstallning-${period}.csv"` } });
}
