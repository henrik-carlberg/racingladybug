import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { encodeCp437 } from '@/lib/sie';
import { sieForYear } from '@/lib/services/sie-export';
import { audit } from '@/lib/server/audit';

export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company, user } = await requireCompany(cid, { allowLocked: true });
  const fyId = Number(new URL(req.url).searchParams.get('fy'));
  const r = await sieForYear(company.id, fyId);
  if (!r) return new Response('Räkenskapsåret finns inte', { status: 404 });
  const { text, fy } = r;
  await audit(sql, { companyId: company.id, userId: user.id, action: 'export', entity: 'sie', entityId: fy.id });
  const name = `${company.name.replace(/[^\w]+/g, '_')}_${fy.start_date.slice(0, 4)}.se`;
  return new Response(Buffer.from(encodeCp437(text)), {
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"` },
  });
}
