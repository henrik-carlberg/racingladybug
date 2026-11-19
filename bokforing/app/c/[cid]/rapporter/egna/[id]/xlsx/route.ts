import { requireCompany } from '@/lib/server/auth';
import { getReport, runReport } from '@/lib/services/custom-reports';
import { workbook, XLSX_TYPE, type Cell } from '@/lib/xlsx';
import { today } from '@/lib/format';

export async function GET(req: Request, { params }: { params: Promise<{ cid: string; id: string }> }) {
  const { cid, id } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger', allowLocked: true });
  const r = await getReport(company.id, Number(id)).catch(() => null);
  if (!r) return new Response('Saknas', { status: 404 });
  const y = Number(new URL(req.url).searchParams.get('ar')) || Number(today().slice(0, 4));
  const out = await runReport(company.id, r.definition, y);
  const pct = (l: string) => /%\s*$/.test(l);
  const rows: Cell[][] = [
    [{ s: `${company.name} – ${r.name}`, bold: true }], [],
    [{ s: '', bold: true }, ...out.columns.map((c) => ({ s: c, bold: true })), ...(out.hasBudget ? [{ s: 'Budget', bold: true }, { s: 'Avvikelse', bold: true }] : [])],
    ...out.rows.map((x) => [x.bold ? { s: x.label, bold: true } : x.label, ...x.values.map((v) => (v == null ? null : pct(x.label) ? { v: Math.round(v * 10) / 1000, fmt: 'pct' as const } : { v: Math.round(v) / 100, fmt: 'kr' as const })),
      ...(out.hasBudget ? [x.budget[0] == null ? null : pct(x.label) ? { v: x.budget[0] / 100, fmt: 'pct' as const } : { v: x.budget[0] / 100, fmt: 'kr' as const }, x.budget[0] == null || x.values[0] == null ? null : pct(x.label) ? { v: (x.values[0] - x.budget[0]) / 100, fmt: 'pct' as const } : { v: (x.values[0] - x.budget[0]) / 100, fmt: 'kr' as const }] : [])]),
  ];
  const file = workbook([{ name: r.name.slice(0, 31).replace(/[\\/*?:[\]]/g, ' '), rows, widths: [32, ...out.columns.map(() => 16), 16, 16] }]);
  return new Response(new Uint8Array(file), { headers: { 'content-type': XLSX_TYPE, 'content-disposition': `attachment; filename="rapport-${r.id}-${y}.xlsx"`, 'cache-control': 'no-store' } });
}
