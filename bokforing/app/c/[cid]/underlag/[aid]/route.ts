import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';

export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; aid: string }> }) {
  const { cid, aid } = await params;
  const { company } = await requireCompany(cid);
  const [f] = await sql<{ filename: string; mime_type: string; data: Buffer }[]>`
    SELECT filename, mime_type, data FROM attachments WHERE id = ${Number(aid)} AND company_id = ${company.id}`;
  if (!f) return new Response('Hittades inte', { status: 404 });
  const safe = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(f.mime_type);
  return new Response(new Uint8Array(f.data), {
    headers: {
      'Content-Type': safe ? f.mime_type : 'application/octet-stream',
      'Content-Disposition': `${safe ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
