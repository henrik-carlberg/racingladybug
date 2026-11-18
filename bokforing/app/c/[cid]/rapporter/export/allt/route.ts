import { requireCompany } from '@/lib/server/auth';
import { audit } from '@/lib/server/audit';
import { sql } from '@/lib/db';
import { exportCompany } from '@/lib/services/full-export';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Hela bolagets data som JSON (ägaren) – egen säkerhetskopia eller flytt till annat system */
export async function GET(_req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company, user } = await requireCompany(cid, { owner: true, allowLocked: true });
  const data = await exportCompany(company.id);
  await audit(sql, { companyId: company.id, userId: user.id, action: 'export_all', entity: 'company', entityId: company.id });
  return new Response(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${company.name.replace(/[^\w]+/g, '_')}_export_${new Date().toISOString().slice(0, 10)}.json"`, 'Cache-Control': 'no-store' },
  });
}
