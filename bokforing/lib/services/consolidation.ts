import 'server-only';
import { sql } from '@/lib/db';
import { accountSums, openingBalances } from '@/lib/server/ledger';
import { addDays } from '@/lib/format';
import { consolidate, orgDigits, type GroupCompany } from '@/lib/consolidation';

/** Bolag där användaren är ägare, redovisningskonsult eller revisor */
export async function groupCandidates(userId: number) {
  return sql<{ id: number; name: string; orgnr: string }[]>`
    SELECT c.id, c.name, c.orgnr FROM companies c JOIN memberships m ON m.company_id = c.id
    WHERE m.user_id = ${userId} AND m.role IN ('owner','accountant','auditor') AND NOT c.is_demo ORDER BY c.name`;
}

export async function groupReport(userId: number, ids: number[], from: string, to: string) {
  const allowed = await groupCandidates(userId);
  const sel = allowed.filter((c) => ids.includes(c.id));
  const orgs = new Map(sel.map((c) => [orgDigits(c.orgnr), c.id]));
  const cs: GroupCompany[] = [];
  for (const c of sel) {
    const others = [...orgs.entries()].filter(([o, id]) => o && id !== c.id).map(([o]) => o);
    const [intra] = others.length ? await sql<{ sales: number; open: number }[]>`
      SELECT COALESCE(SUM(i.total_net) FILTER (WHERE i.invoice_date BETWEEN ${from} AND ${to}), 0)::bigint AS sales,
        COALESCE(SUM(i.total - i.paid_amount) FILTER (WHERE i.status = 'booked' AND i.invoice_date <= ${to}), 0)::bigint AS open
      FROM invoices i JOIN customers cu ON cu.id = i.customer_id
      WHERE i.company_id = ${c.id} AND i.status <> 'draft' AND NOT i.imported AND right(regexp_replace(cu.orgnr, '\\D', '', 'g'), 10) IN ${sql(others)}` : [{ sales: 0, open: 0 }];
    cs.push({ id: c.id, name: c.name, result: await accountSums(c.id, from, to), balance: await openingBalances(c.id, addDays(to, 1)), intraSales: Number(intra.sales), intraOpen: Number(intra.open) });
  }
  return { companies: sel, candidates: allowed, ...consolidate(cs) };
}
