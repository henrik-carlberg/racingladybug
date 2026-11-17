import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { buildAgiForRun } from '@/lib/services/payroll';
import { AppError } from '@/lib/errors';

export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; rid: string }> }) {
  const { cid, rid } = await params;
  const actor = userActor(await requireCompany(cid));
  try {
    const { filename, xml } = await buildAgiForRun(actor, Number(rid));
    return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
