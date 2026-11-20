import { requireCompany } from '@/lib/server/auth';
import { pdf } from '@/lib/services/closing-binder';

export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; fyid: string }> }) {
  const { cid, fyid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const r = await pdf(company.id, Number(fyid) || 0);
  return new Response(new Uint8Array(r.file), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(r.name)}`, 'X-Content-Type-Options': 'nosniff' } });
}
