import { requireCompany } from '@/lib/server/auth';
import { periodRange } from '@/lib/eu';
import { ossDeclaration } from '@/lib/oss';
import { ossLines } from '@/lib/services/eu';

/** Underlag för OSS-deklarationen per land och skattesats (kronor) */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const period = new URL(req.url).searchParams.get('period') ?? '';
  const r = periodRange(period);
  if (!r || !/Q[1-4]$/.test(period)) return new Response('Ange ett kvartal, t.ex. 2026-Q4', { status: 400 });
  const d = ossDeclaration(await ossLines(company.id, r.from, r.to));
  const kr = (o: number) => (o / 100).toFixed(2).replace('.', ',');
  const body = ['Land;Momssats (%);Beskattningsunderlag (kr);Moms (kr)', ...d.rows.map((x) => [x.country, String(x.rate).replace('.', ','), kr(x.base), kr(x.vat)].join(';')), `Totalt;;${kr(d.base)};${kr(d.vat)}`].join('\r\n');
  return new Response('﻿' + body + '\r\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="oss-${period}.csv"` } });
}
