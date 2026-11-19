import 'server-only';
import { sql } from '@/lib/db';
import { accountSums, openingBalances } from '@/lib/server/ledger';
import { addDays } from '@/lib/format';
import { consolidate, orgDigits, type GroupCompany, type GroupLink } from '@/lib/consolidation';
import { ValidationError } from '@/lib/errors';

/** Bolag där användaren är ägare, redovisningskonsult eller revisor */
export async function groupCandidates(userId: number) {
  return sql<{ id: number; name: string; orgnr: string }[]>`
    SELECT c.id, c.name, c.orgnr FROM companies c JOIN memberships m ON m.company_id = c.id
    WHERE m.user_id = ${userId} AND m.role IN ('owner','accountant','auditor') AND NOT c.is_demo ORDER BY c.name`;
}

export async function groupReport(userId: number, ids: number[], from: string, to: string, parentId?: number | null) {
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
  const parent = parentId && sel.some((c) => c.id === parentId) ? parentId : null;
  const links = parent ? await groupLinks(parent) : [];
  return { companies: sel, candidates: allowed, parentId: parent, links, ...consolidate(cs, { parentId: parent, links }) };
}

export async function groupLinks(parentId: number): Promise<GroupLink[]> {
  return (await sql<{ sub: number; ownership: number; cost: string | null; eq: string | null }[]>`
    SELECT subsidiary_company_id AS sub, ownership::float8 AS ownership, acquisition_cost AS cost, acquired_equity AS eq FROM group_links WHERE parent_company_id = ${parentId}`)
    .map((r) => ({ subsidiaryId: r.sub, ownership: r.ownership, acquisitionCost: r.cost == null ? null : Number(r.cost), acquiredEquity: r.eq == null ? null : Number(r.eq) }));
}

/** Sparar dotterbolagets ägarandel och förvärvsuppgifter. Användaren ska vara ägare eller konsult i båda bolagen. */
export async function saveGroupLink(userId: number, parentId: number, subId: number, input: { ownership: number; acquisitionCost: number | null; acquiredEquity: number | null; remove?: boolean }) {
  const [ok] = await sql<{ n: number }[]>`SELECT count(DISTINCT company_id)::int AS n FROM memberships WHERE user_id = ${userId} AND role IN ('owner','accountant') AND company_id IN (${parentId}, ${subId})`;
  if (parentId === subId || ok.n !== 2) throw new ValidationError('Du behöver vara ägare eller redovisningskonsult i både moderbolaget och dotterbolaget');
  if (input.remove) { await sql`DELETE FROM group_links WHERE parent_company_id = ${parentId} AND subsidiary_company_id = ${subId}`; return; }
  if (!(input.ownership > 0 && input.ownership <= 100)) throw new ValidationError('Ägarandelen ska vara 0–100 %');
  await sql`INSERT INTO group_links (parent_company_id, subsidiary_company_id, ownership, acquisition_cost, acquired_equity, updated_by)
    VALUES (${parentId}, ${subId}, ${input.ownership}, ${input.acquisitionCost}, ${input.acquiredEquity}, ${userId})
    ON CONFLICT (parent_company_id, subsidiary_company_id) DO UPDATE SET ownership = EXCLUDED.ownership, acquisition_cost = EXCLUDED.acquisition_cost,
      acquired_equity = EXCLUDED.acquired_equity, updated_by = EXCLUDED.updated_by, updated_at = now()`;
}
