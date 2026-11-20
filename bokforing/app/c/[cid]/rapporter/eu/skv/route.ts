import { requireCompany } from '@/lib/server/auth';
import { sql } from '@/lib/db';
import { periodicSummary, periodRange } from '@/lib/eu';
import { psSkvFile } from '@/lib/oss';
import { euLines } from '@/lib/services/eu';

/** Periodisk sammanställning som fil för Skatteverkets e-tjänst (SKV574008) */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company, user } = await requireCompany(cid, { perm: 'ledger' });
  const period = new URL(req.url).searchParams.get('period') ?? '';
  const r = periodRange(period);
  if (!r) return new Response('Ogiltig period', { status: 400 });
  if (!company.vat_number) return new Response('Ange bolagets momsregistreringsnummer under Inställningar', { status: 422 });
  const ps = periodicSummary(await euLines(company.id, r.from, r.to));
  const [u] = await sql<{ name: string; email: string }[]>`SELECT name, email FROM users WHERE id = ${user.id}`;
  const body = psSkvFile({ vatNumber: company.vat_number, period, contact: u.name, phone: company.phone ?? '', email: u.email, rows: ps.rows });
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=iso-8859-1', 'Content-Disposition': `attachment; filename="ps-${period}.txt"` } });
}
