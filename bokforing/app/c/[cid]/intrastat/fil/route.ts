import { requireCompany } from '@/lib/server/auth';
import { AppError } from '@/lib/errors';
import { exportFile } from '@/lib/services/intrastat';

export const dynamic = 'force-dynamic';

/** Intrastatdeklarationen för en månad som fil */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const period = new URL(req.url).searchParams.get('period') ?? '';
  try {
    const body = await exportFile(company.id, period);
    return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="intrastat_${period}.csv"`, 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: 400 });
    throw e;
  }
}
