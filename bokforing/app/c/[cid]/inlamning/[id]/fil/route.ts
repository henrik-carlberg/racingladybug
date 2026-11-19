import { requireCompany } from '@/lib/server/auth';
import { sql } from '@/lib/db';
import { filingFile } from '@/lib/services/filings';

export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; id: string }> }) {
  const { cid, id } = await params;
  const [k] = await sql<{ kind: string }[]>`SELECT kind FROM filings WHERE id = ${Number(id)} AND company_id = ${Number(cid)}`;
  const { company } = await requireCompany(cid, { perm: k?.kind === 'agi' ? 'payroll' : 'ledger', allowLocked: true });
  if (!k) return new Response('Saknas', { status: 404 });
  const f = await filingFile(company.id, Number(id));
  const latin = f.kind === 'moms';
  return new Response(latin ? Buffer.from(f.payload, 'latin1') : f.payload, { headers: { 'content-type': `${f.kind === 'arsredovisning' ? 'application/xhtml+xml' : 'application/xml'}; charset=${latin ? 'iso-8859-1' : 'utf-8'}`, 'content-disposition': `attachment; filename="${f.filename}"`, 'cache-control': 'no-store' } });
}
