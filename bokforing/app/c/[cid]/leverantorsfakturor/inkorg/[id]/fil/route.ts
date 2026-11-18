import { requireCompany } from '@/lib/server/auth';
import { inboxFile } from '@/lib/services/inbox';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; id: string }> }) {
  const { cid, id } = await params;
  const { company } = await requireCompany(cid, { perm: 'purchasing' });
  const f = await inboxFile(company.id, Number(id)).catch(() => null);
  if (!f) return new Response('Filen finns inte', { status: 404 });
  return new Response(new Uint8Array(f.data!), {
    headers: {
      'Content-Type': f.mime_type, 'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename="${encodeURIComponent(f.filename || 'faktura')}"`,
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
    },
  });
}
