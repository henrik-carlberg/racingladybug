import { requireCompany } from '@/lib/server/auth';
import { climateReport } from '@/lib/services/climate';

export const dynamic = 'force-dynamic';

/** Underlag för hållbarhetsredovisning: utsläpp per kategori och scope (kg CO2e) */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const year = Number(new URL(req.url).searchParams.get('ar')) || new Date().getFullYear();
  const r = await climateReport(company.id, year);
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = ['Kategori;Scope;Källa;Kostnad (kr);kg CO2e', ...r.rows.map((x) => [q(x.label), x.scope, x.source === 'exact' ? 'Mängd' : 'Schablon', (x.spend / 100).toFixed(2).replace('.', ','), x.kg].join(';')),
    `${q('Totalt')};;;;${r.total}`];
  return new Response('﻿' + lines.join('\r\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="klimat-${year}.csv"` } });
}
