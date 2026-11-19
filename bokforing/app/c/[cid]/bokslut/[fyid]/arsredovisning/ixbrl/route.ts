import { requireCompany } from '@/lib/server/auth';
import { annualReport } from '@/lib/services/taxreports';
import { annualReportIxbrl } from '@/lib/ixbrl';

/** Årsredovisningen som iXBRL-fil (XHTML) för digital inlämning till Bolagsverket */
export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; fyid: string }> }) {
  const { cid, fyid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger', allowLocked: true });
  if (company.company_type !== 'AB') return new Response('Årsredovisning i iXBRL gäller aktiebolag', { status: 400 });
  const r = await annualReport(company.id, Number(fyid));
  if (!r.input) return new Response('Saknas', { status: 404 });
  const y = r.input.years[0];
  const name = `arsredovisning-${company.orgnr.replace(/\D/g, '')}-${y.end.slice(0, 4)}.xhtml`;
  return new Response(annualReportIxbrl(r.input), {
    headers: { 'content-type': 'application/xhtml+xml; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' },
  });
}
