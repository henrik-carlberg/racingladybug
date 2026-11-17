import { sql } from '@/lib/db';
import { sha256 } from '@/lib/server/auth';

/** PDF för extern undertecknare (åtkomst via personlig länk) */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [d] = await sql<{ file: Buffer | null; filename: string | null }[]>`
    SELECT d.file, d.filename FROM document_signers s JOIN documents d ON d.id = s.document_id
    WHERE s.token_hash = ${sha256(token)} AND d.status <> 'cancelled'`;
  if (!d?.file) return new Response('Hittades inte', { status: 404 });
  return new Response(new Uint8Array(d.file), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(d.filename ?? 'dokument.pdf')}`, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
}
