import 'server-only';
import { sql } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { contribution, lateCost, marginPct } from '@/lib/profitability';
import type { Actor } from './actor';

export async function settings(companyId: number) {
  const [s] = await sql<{ hour_cost: number; interest_pct: number }[]>`SELECT hour_cost::float8 AS hour_cost, interest_pct::float8 AS interest_pct FROM profitability_settings WHERE company_id = ${companyId}`;
  return s ?? { hour_cost: 50000, interest_pct: 8 };
}

export async function overview(companyId: number) {
  const t = today(), s = await settings(companyId);
  const inv = await sql<{ customer_id: number; name: string; net: number; total: number; written_off: number; due: string; paid: string | null }[]>`
    SELECT i.customer_id, c.name, i.total_net::float8 AS net, i.total::float8 AS total, COALESCE(i.written_off_amount, 0)::float8 AS written_off, to_char(i.due_date,'YYYY-MM-DD') AS due, to_char(i.paid_date,'YYYY-MM-DD') AS paid
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.company_id = ${companyId} AND i.status <> 'draft' AND i.invoice_date > ${t}::date - 365`;
  const goods = await sql<{ customer_id: number; cost: number }[]>`SELECT o.customer_id, SUM(-m.qty * m.unit_cost)::float8 AS cost FROM inv_sales_orders o JOIN inv_movements m ON m.ref_type = 'sales_order' AND m.ref_id = o.id AND m.company_id = o.company_id
    JOIN invoices i ON i.id = o.invoice_id WHERE o.company_id = ${companyId} AND i.invoice_date > ${t}::date - 365 AND m.qty < 0 GROUP BY 1`;
  const time = await sql<{ customer_id: number; minutes: number }[]>`SELECT p.customer_id, SUM(e.minutes)::float8 AS minutes FROM time_entries e JOIN projects p ON p.id = e.project_id
    WHERE e.company_id = ${companyId} AND e.date > ${t}::date - 365 GROUP BY 1`;
  const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const ids = [...new Set(inv.map((i) => i.customer_id))];
  const customers = ids.map((id) => {
    const own = inv.filter((i) => i.customer_id === id);
    const row = {
      revenue: own.reduce((a, i) => a + i.net, 0),
      goods: Math.round(goods.find((g) => g.customer_id === id)?.cost ?? 0),
      time: Math.round((time.find((x) => x.customer_id === id)?.minutes ?? 0) / 60 * s.hour_cost),
      losses: own.reduce((a, i) => a + i.written_off, 0),
      late: own.reduce((a, i) => a + lateCost(i.total, days(i.due, i.paid ?? t), s.interest_pct), 0),
    };
    const late = own.filter((i) => days(i.due, i.paid ?? t) > 0);
    return { id, name: own[0].name, ...row, contribution: contribution(row), margin: marginPct(row), invoices: own.length, avgDaysLate: late.length ? Math.round(late.reduce((a, i) => a + days(i.due, i.paid ?? t), 0) / late.length) : 0 };
  }).sort((a, b) => b.contribution - a.contribution);
  const products = await sql<{ id: number; name: string; qty: number; revenue: number; cost: number }[]>`
    SELECT p.id, p.sku || ' ' || p.name AS name, SUM(l.qty)::float8 AS qty, SUM(l.qty * l.unit_price)::float8 AS revenue,
      COALESCE(SUM((SELECT SUM(-m.qty * m.unit_cost) FROM inv_movements m WHERE m.ref_type = 'sales_order' AND m.ref_id = o.id AND m.product_id = l.product_id AND m.qty < 0) ), 0)::float8 AS cost
    FROM inv_sales_order_lines l JOIN inv_sales_orders o ON o.id = l.order_id JOIN invoices i ON i.id = o.invoice_id JOIN inv_products p ON p.id = l.product_id
    WHERE o.company_id = ${companyId} AND i.invoice_date > ${t}::date - 365 GROUP BY 1, 2`;
  return {
    settings: s, customers, unprofitable: customers.filter((c) => c.contribution < 0),
    products: products.map((p) => ({ ...p, contribution: Math.round(p.revenue - p.cost), margin: p.revenue ? Math.round((p.revenue - p.cost) / p.revenue * 1000) / 10 : null })).sort((a, b) => b.contribution - a.contribution),
  };
}

export async function saveSettings(actor: Actor, input: Record<string, unknown>) {
  const hc = parseAmount(String(input.hour_cost ?? '').trim());
  const ip = Number(String(input.interest_pct ?? '').replace(',', '.'));
  if (hc == null || hc < 0 || !Number.isFinite(ip) || ip < 0 || ip >= 100) throw new ValidationError('Ogiltig timkostnad eller ränta');
  await sql`INSERT INTO profitability_settings (company_id, hour_cost, interest_pct) VALUES (${actor.companyId}, ${hc}, ${ip}) ON CONFLICT (company_id) DO UPDATE SET hour_cost = EXCLUDED.hour_cost, interest_pct = EXCLUDED.interest_pct`;
}
