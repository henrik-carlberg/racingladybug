import { requireCompany } from '@/lib/server/auth';
import { foraFile } from '@/lib/services/agreements';

export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; rid: string }> }) {
  const { cid, rid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll', allowLocked: true });
  const f = await foraFile(company.id, Number(rid)).catch(() => null);
  if (!f) return new Response('Saknas', { status: 404 });
  return new Response(f.content, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${f.filename}"`, 'cache-control': 'no-store' } });
}
