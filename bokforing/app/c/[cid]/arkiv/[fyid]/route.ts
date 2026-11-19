import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { audit } from '@/lib/server/audit';
import { buildArchive } from '@/lib/services/archive';
import { sysdocHtml } from '@/lib/sysdoc-html';

export const maxDuration = 300;

/** Arkivpaket (zip) för ett räkenskapsår */
export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; fyid: string }> }) {
  const { cid, fyid } = await params;
  const { company, user } = await requireCompany(cid, { perm: 'ledger', allowLocked: true });
  try {
    const a = await buildArchive(company.id, Number(fyid), sysdocHtml);
    if (!a) return new Response('Räkenskapsåret finns inte', { status: 404 });
    await audit(sql, { companyId: company.id, userId: user.id, action: 'export', entity: 'archive', entityId: Number(fyid), details: { files: a.manifest.files.length } });
    return new Response(new Uint8Array(a.data), { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${a.name}"`, 'cache-control': 'no-store' } });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : 'Arkivpaketet kunde inte skapas', { status: 400 });
  }
}
