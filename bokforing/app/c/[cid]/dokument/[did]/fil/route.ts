import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';

export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; did: string }> }) {
  const { cid, did } = await params;
  const { company } = await requireCompany(cid);
  const [d] = await sql<{ file: Buffer | null; filename: string | null }[]>`SELECT file, filename FROM documents WHERE id = ${Number(did)} AND company_id = ${company.id}`;
  if (!d?.file) return new Response('Hittades inte', { status: 404 });
  return new Response(new Uint8Array(d.file), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(d.filename ?? 'dokument.pdf')}`, 'X-Content-Type-Options': 'nosniff' } });
}
