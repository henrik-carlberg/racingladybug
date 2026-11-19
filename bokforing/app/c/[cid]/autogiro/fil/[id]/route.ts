import { requireCompany } from '@/lib/server/auth';
import { fileContent } from '@/lib/services/autogiro';

export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; id: string }> }) {
  const { cid, id } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const f = await fileContent(company.id, Number(id));
  if (!f) return new Response('Saknas', { status: 404 });
  return new Response(Buffer.from(f.content, 'latin1'), { headers: { 'content-type': 'text/plain; charset=iso-8859-1', 'content-disposition': `attachment; filename="autogiro-${f.kind === 'draws' ? 'dragningar' : 'medgivanden'}-${id}.txt"`, 'cache-control': 'no-store' } });
}
