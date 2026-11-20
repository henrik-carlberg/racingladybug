import { requireCompany } from '@/lib/server/auth';
import { batchXml } from '@/lib/services/foreign-pay';

export const dynamic = 'force-dynamic';

/** Betalfil (pain.001) för en skapad batch av utlandsbetalningar */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payments' });
  const batch = new URL(req.url).searchParams.get('batch') ?? '';
  if (!/^UB[0-9a-f]{1,33}$/.test(batch)) return new Response('Ogiltig betalfil', { status: 400 });
  const xml = await batchXml(company.id, batch).catch(() => null);
  if (!xml) return new Response('Betalfilen finns inte', { status: 404 });
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="utlandsbetalningar-${batch}.xml"` } });
}
