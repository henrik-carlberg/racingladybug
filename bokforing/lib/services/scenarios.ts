import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { KINDS, impacts, project, type Base, type Item } from '@/lib/scenarios';
import type { Actor } from './actor';
import { int, str } from './input';

/** Basen: budgeten för året om den finns, annars årstakten de senaste tolv månaderna; kassan är dagens saldo på 19xx */
async function base(companyId: number, year: number): Promise<Base & { source: 'budget' | 'runrate' }> {
  const b = await sql<{ month: number; revenue: number; costs: number }[]>`SELECT month, COALESCE(SUM(amount) FILTER (WHERE account < 4000), 0)::float8 AS revenue, COALESCE(SUM(amount) FILTER (WHERE account >= 4000), 0)::float8 AS costs
    FROM account_budgets WHERE company_id = ${companyId} AND year = ${year} GROUP BY month`;
  const [{ cash }] = await sql<{ cash: number }[]>`SELECT COALESCE(SUM(l.debit - l.credit), 0)::float8 AS cash FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND l.account_number BETWEEN 1900 AND 1999`;
  if (b.length) {
    const rev = Array(12).fill(0), cost = Array(12).fill(0);
    for (const r of b) { rev[r.month - 1] = r.revenue; cost[r.month - 1] = r.costs; }
    return { revenue: rev, costs: cost, openingCash: cash, source: 'budget' };
  }
  const t = today();
  const [r] = await sql<{ revenue: number; costs: number }[]>`SELECT COALESCE(SUM(l.credit - l.debit) FILTER (WHERE l.account_number BETWEEN 3000 AND 3999), 0)::float8 AS revenue,
      COALESCE(SUM(l.debit - l.credit) FILTER (WHERE l.account_number BETWEEN 4000 AND 8999), 0)::float8 AS costs
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND v.date > ${t}::date - 365 AND v.date <= ${t}`;
  return { revenue: Array(12).fill(Math.round(r.revenue / 12)), costs: Array(12).fill(Math.round(r.costs / 12)), openingCash: cash, source: 'runrate' };
}

export async function overview(companyId: number, year: number) {
  const b = await base(companyId, year);
  const scenarios = await sql<{ id: number; name: string }[]>`SELECT id, name FROM scenarios WHERE company_id = ${companyId} AND year = ${year} ORDER BY id`;
  const items = scenarios.length ? await sql<(Item & { id: number; scenario_id: number })[]>`SELECT id, scenario_id, kind, label, from_month, amount::float8 AS amount, pct::float8 AS pct, years FROM scenario_items
    WHERE scenario_id IN ${sql(scenarios.map((s) => s.id))} ORDER BY id` : [];
  const customers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name LIMIT 500`;
  return {
    base: { ...b, ...project(b, []) }, customers,
    scenarios: scenarios.map((s) => { const own = items.filter((i) => i.scenario_id === s.id); return { ...s, items: own, ...project(b, own), impacts: impacts(b, own) }; }),
  };
}

export async function addScenario(actor: Actor, input: Record<string, unknown>) {
  const year = int(input, 'year', 'År');
  try { await sql`INSERT INTO scenarios ${sql({ company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Scenario', max: 100 }), year, created_by: actor.userId })}`; }
  catch (e) { if (String((e as Error).message).includes('scenarios_company_id_name_year_key')) throw new ConflictError('Scenariot finns redan'); throw e; }
}

export async function addItem(actor: Actor, scenarioId: number, input: Record<string, unknown>) {
  const [s] = await sql`SELECT 1 FROM scenarios WHERE id = ${scenarioId} AND company_id = ${actor.companyId}`;
  if (!s) throw new NotFoundError('Scenariot');
  const kind = String(input.kind) as Item['kind'];
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw new ValidationError('Välj typ av förändring');
  const from = int(input, 'from_month', 'Från månad');
  if (from < 1 || from > 12) throw new ValidationError('Månaden ska vara 1–12');
  const num = (k: string) => Number(String(input[k] ?? '0').replace(',', '.') || '0');
  const money = (k: string, label: string) => { const v = parseAmount(String(input[k] ?? '').trim()); if (v == null || v <= 0) throw new ValidationError(`Ange ${label}`); return v; };
  let amount = 0, pct = 0, years = 0, label = str(input, 'label', { max: 100 });
  if (kind === 'price_pct' || kind === 'cost_pct') { pct = num('pct'); if (!Number.isFinite(pct) || !pct || Math.abs(pct) > 100) throw new ValidationError('Ange förändringen i procent'); }
  if (kind === 'hire') amount = money('amount', 'månadslönen');
  if (kind === 'investment' || kind === 'loan') { amount = money('amount', 'beloppet'); years = Math.round(num('years')); if (years < 0 || years > 50) throw new ValidationError('Ogiltig tid i år'); }
  if (kind === 'loan') pct = num('pct');
  if (kind === 'lost_customer') {
    const customerId = int(input, 'customer_id', 'Kund');
    const [c] = await sql<{ name: string; net: number }[]>`SELECT c.name, COALESCE((SELECT SUM(i.total_net) FROM invoices i WHERE i.customer_id = c.id AND i.status <> 'draft' AND i.invoice_date > ${today()}::date - 365), 0)::float8 AS net
      FROM customers c WHERE c.id = ${customerId} AND c.company_id = ${actor.companyId}`;
    if (!c) throw new NotFoundError('Kunden');
    amount = Math.round(c.net / 12);
    label = label || `Förlorar ${c.name}`;
  }
  await sql`INSERT INTO scenario_items ${sql({ scenario_id: scenarioId, kind, label: label || KINDS[kind], from_month: from, amount, pct, years })}`;
}

export async function removeItem(actor: Actor, itemId: number) {
  const r = await sql`DELETE FROM scenario_items i USING scenarios s WHERE i.id = ${itemId} AND s.id = i.scenario_id AND s.company_id = ${actor.companyId}`;
  if (!r.count) throw new NotFoundError('Posten');
}
