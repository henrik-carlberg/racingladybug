import { requireCompany } from '@/lib/server/auth';
import { peppolFile } from '@/lib/services/einvoice';

export const dynamic = 'force-dynamic';

/** E-faktura i Peppol BIS Billing 3.0 (UBL) för uppladdning hos en Peppol-operatör */
export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; iid: string }> }) {
  const { cid, iid } = await params;
  const { company } = await requireCompany(cid);
  try {
    const f = await peppolFile(company.id, Number(iid));
    return new Response(f.xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${f.filename}"` } });
  } catch (e) {
    return new Response((e as Error).message, { status: 422, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
