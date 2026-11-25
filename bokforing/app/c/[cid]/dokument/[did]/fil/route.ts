import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { canSeeDocument } from '@/lib/permissions';

export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; did: string }> }) {
  const { cid, did } = await params;
  const { company, user, role, permissions } = await requireCompany(cid);
  const [d] = await sql<{ file: Buffer | null; filename: string | null; source_module: string | null; signer: boolean }[]>`SELECT file, filename, source_module, EXISTS (SELECT 1 FROM document_signers s WHERE s.document_id = documents.id AND s.user_id = ${user.id}) AS signer FROM documents WHERE id = ${Number(did)} AND company_id = ${company.id}`;
  if (d && !canSeeDocument(role, permissions, d.source_module, d.signer)) return new Response('Hittades inte', { status: 404 });
  if (!d?.file) return new Response('Hittades inte', { status: 404 });
  return new Response(new Uint8Array(d.file), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(d.filename ?? 'dokument.pdf')}`, 'X-Content-Type-Options': 'nosniff' } });
}
