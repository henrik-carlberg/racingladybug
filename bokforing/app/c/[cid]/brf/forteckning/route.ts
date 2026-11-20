import { requireCompany } from '@/lib/server/auth';
import { registerDocument } from '@/lib/services/brf';

/** Lägenhetsförteckningen för utskrift (BRL 9:8) */
export async function GET(_req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  return new Response(await registerDocument(ctx.company.id), { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff' } });
}
