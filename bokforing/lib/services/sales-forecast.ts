import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { today } from '@/lib/format';
import { build, nextMonths, seasonality, shiftYm, weighted, ym } from '@/lib/sales-forecast';
import type { Actor } from './actor';

const exists = async (t: string) => (await sql<{ ok: boolean }[]>`SELECT to_regclass(${t}) IS NOT NULL AS ok`)[0].ok;
export const LIQ_PREFIX = 'Försäljningsprognos:';

export async function forecast(companyId: number) {
  const t = today(), months = nextMonths(ym(t), 12), last = months[11];
  const contracts = new Map<string, number>(), pipeline = new Map<string, number>(), deals: { title: string; month: string; value: number; probability: number; weighted: number }[] = [];
  if (await exists('avt_contracts')) {
    const { listContracts } = await import('@/modules/avtal/service');
    const { invoiceDate, addMonths } = await import('@/modules/avtal/calc');
    for (const k of await listContracts(companyId, { status: 'active' })) {
      let start = k.next_period_start;
      for (let i = 0; i < 60; i++) {
        if (k.end_date && start > k.end_date && !k.auto_renew) break;
        const m = ym(invoiceDate(start, k.interval_months, k.in_advance));
        if (m > last) break;
        if (m >= months[0]) contracts.set(m, (contracts.get(m) ?? 0) + k.period_net);
        start = addMonths(start, k.interval_months);
      }
    }
  }
  if (await exists('crm_deals')) {
    for (const d of await sql<{ title: string; value: number; probability: number; close: string | null }[]>`SELECT d.title, d.value::float8 AS value, COALESCE(d.probability, s.probability) AS probability, to_char(d.expected_close,'YYYY-MM-DD') AS close
      FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id WHERE d.company_id = ${companyId} AND s.kind = 'open'`) {
      const m = d.close && ym(d.close) >= months[0] ? ym(d.close) : months[0];
      if (m > last) continue;
      const w = weighted(d.value, d.probability);
      pipeline.set(m, (pipeline.get(m) ?? 0) + w);
      deals.push({ title: d.title, month: m, value: d.value, probability: d.probability, weighted: w });
    }
  }
  // Historik: bokförda intäkter (3000–3799) per månad de senaste 24 månaderna
  const hist = await sql<{ m: string; amount: number }[]>`SELECT to_char(v.date,'YYYY-MM') AS m, SUM(l.credit - l.debit)::float8 AS amount FROM vouchers v JOIN voucher_lines l ON l.voucher_id = v.id
    WHERE v.company_id = ${companyId} AND l.account_number BETWEEN 3000 AND 3799 AND v.date >= date_trunc('month', ${t}::date) - interval '24 months' AND v.date < date_trunc('month', ${t}::date) GROUP BY 1`;
  const history = new Map(hist.map((h) => [h.m, h.amount]));
  const from12 = shiftYm(ym(t), -12);
  const last12 = [...history].filter(([k]) => k >= from12).reduce((a, [, v]) => a + v, 0);
  // Avtalsfakturerat senaste 12 månaderna räknas bort så att avtalen inte kommer med två gånger
  const contracted = (await exists('avt_invoices')) ? Number((await sql<{ s: number }[]>`SELECT COALESCE(SUM(i.total_net), 0)::float8 AS s FROM avt_invoices a JOIN invoices i ON i.id = a.invoice_id
    WHERE i.company_id = ${companyId} AND i.status <> 'draft' AND i.invoice_date >= date_trunc('month', ${t}::date) - interval '12 months' AND i.invoice_date < date_trunc('month', ${t}::date)`)[0].s) : 0;
  const baselineMonthly = Math.max(0, Math.round((last12 - contracted) / 12));
  const year = Number(months[0].slice(0, 4));
  const budget = new Map<string, number>();
  if (await exists('liq_budget')) for (const b of await sql<{ y: number; m: number; amount: number }[]>`SELECT year AS y, month AS m, amount::float8 AS amount FROM liq_budget WHERE company_id = ${companyId} AND category = 'revenue' AND year IN (${year}, ${year + 1})`) budget.set(`${b.y}-${String(b.m).padStart(2, '0')}`, b.amount);
  for (const b of await sql<{ y: number; m: number; amount: number }[]>`SELECT year AS y, month AS m, SUM(amount)::float8 AS amount FROM account_budgets WHERE company_id = ${companyId} AND account BETWEEN 3000 AND 3999 AND year IN (${year}, ${year + 1}) GROUP BY 1, 2`) {
    const k = `${b.y}-${String(b.m).padStart(2, '0')}`; if (!budget.has(k)) budget.set(k, b.amount);
  }
  const season = seasonality(history);
  const rows = build({ months, contracts, pipeline, baselineMonthly, season, budget });
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  const transferred = (await exists('liq_items')) ? (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM liq_items WHERE company_id = ${companyId} AND description LIKE ${LIQ_PREFIX + '%'}`)[0].n : null;
  return { rows, deals, season, seasonal: season.some((x) => x !== 1), baselineMonthly, total: sum((r) => r.total), budgetTotal: rows.some((r) => r.budget != null) ? sum((r) => r.budget ?? 0) : null, transferred };
}

/** Överför pipeline och övrig försäljning till likviditetsprognosen som planerade inbetalningar (avtalen finns redan där). Tidigare överföring ersätts. */
export async function transfer(actor: Actor, vatPct: number) {
  if (!(await exists('liq_items'))) throw new ConflictError('Likviditetsprognosen är inte aktiverad');
  if (![0, 6, 12, 25].includes(vatPct)) throw new ConflictError('Ogiltig momssats');
  const f = await forecast(actor.companyId);
  const [c] = await sql<{ terms: number }[]>`SELECT invoice_terms AS terms FROM companies WHERE id = ${actor.companyId}`;
  const t = today();
  return sql.begin(async (tx) => {
    await tx`DELETE FROM liq_items WHERE company_id = ${actor.companyId} AND description LIKE ${LIQ_PREFIX + '%'}`;
    let n = 0;
    for (const r of f.rows) {
      const net = r.pipeline + r.baseline;
      if (net <= 0) continue;
      const d = new Date(`${r.month}-15T12:00:00Z`); d.setUTCDate(d.getUTCDate() + (c?.terms ?? 30));
      const date = d.toISOString().slice(0, 10);
      if (date < t) continue;
      await tx`INSERT INTO liq_items ${tx({ company_id: actor.companyId, date, amount: Math.round(net * (1 + vatPct / 100)), description: `${LIQ_PREFIX} ${r.month} pipeline och övrig försäljning`, recurrence: 'none', created_by: actor.userId })}`;
      n++;
    }
    await auditBy(tx, actor, 'transfer', 'sales_forecast', 0, { items: n });
    return n;
  });
}
