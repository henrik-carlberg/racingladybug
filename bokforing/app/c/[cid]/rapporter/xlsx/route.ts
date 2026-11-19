import { requireCompany } from '@/lib/server/auth';
import type { Permission } from '@/lib/permissions';
import { workbook, XLSX_TYPE } from '@/lib/xlsx';
import { listSheet, rrbrSheets } from '@/lib/services/xlsx-reports';
import type { Compare } from '@/lib/services/statements';

const PERM: Record<string, Permission | undefined> = { rrbr: undefined, kundfakturor: 'invoicing', kunder: 'invoicing', leverantorsfakturor: 'purchasing', verifikationer: 'ledger' };

/** Excel-export av rapporter och listor */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const u = new URL(req.url);
  const r = u.searchParams.get('r') ?? '';
  if (!(r in PERM)) return new Response('Okänd rapport', { status: 400 });
  const { company } = await requireCompany(cid, { perm: PERM[r] });
  const q = (k: string) => u.searchParams.get(k) || undefined;
  const date = (k: string) => { const v = q(k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined; };
  const out = r === 'rrbr'
    ? await rrbrSheets(company.id, { fy: q('fy'), from: date('from'), to: date('to'), compare: (['fjol', 'budget'].includes(q('jmf') ?? '') ? q('jmf') : 'none') as Compare })
    : await listSheet(company.id, r, { from: date('from'), to: date('to') });
  if (!out) return new Response('Inget att exportera', { status: 404 });
  return new Response(new Uint8Array(workbook(out.sheets)), { headers: { 'content-type': XLSX_TYPE, 'content-disposition': `attachment; filename="${out.name}.xlsx"`, 'cache-control': 'no-store' } });
}
