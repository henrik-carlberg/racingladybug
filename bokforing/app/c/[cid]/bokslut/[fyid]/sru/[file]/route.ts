import { requireCompany } from '@/lib/server/auth';
import { sruFiles } from '@/lib/services/taxreports';
import { latin1 } from '@/lib/taxforms';
import { AppError } from '@/lib/errors';

/** SRU-filer (ISO 8859-1) för Skatteverkets filöverföring */
export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; fyid: string; file: string }> }) {
  const { cid, fyid, file } = await params;
  const { company, user } = await requireCompany(cid, { perm: 'ledger' });
  if (file !== 'INFO.SRU' && file !== 'BLANKETTER.SRU') return new Response('Okänd fil', { status: 404 });
  try {
    const f = await sruFiles(company.id, Number(fyid), user.name);
    return new Response(new Uint8Array(latin1(file === 'INFO.SRU' ? f.info : f.blankets)), {
      headers: { 'Content-Type': 'text/plain; charset=ISO-8859-1', 'Content-Disposition': `attachment; filename="${file}"` },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
