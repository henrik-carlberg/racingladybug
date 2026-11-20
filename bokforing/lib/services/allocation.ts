import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { monthEnd } from '@/lib/format';
import { parseAmount } from '@/lib/money';
import { allocationLines, departmentResult, INTERNAL_ACCOUNT, internalLines } from '@/lib/allocation';
import type { Actor } from './actor';
import { int, optInt, str } from './input';
import { listCostCenters } from './dimensions';

const validPeriod = (p: string) => { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) throw new ValidationError('Ange period som ÅÅÅÅ-MM'); return p; };
async function ownCc(companyId: number, id: number) {
  const [c] = await sql`SELECT 1 FROM cost_centers WHERE id = ${id} AND company_id = ${companyId}`;
  if (!c) throw new ValidationError('Kostnadsstället finns inte');
}

export async function createKey(actor: Actor, input: Record<string, unknown>) {
  const from = int(input, 'account_from', 'Från konto'), to = int(input, 'account_to', 'Till konto');
  if (from < 4000 || to > 8999 || to < from) throw new ValidationError('Ange ett kostnadskontointervall inom 4000–8999');
  const source = optInt(input, 'source_cost_center_id', 'Källa');
  if (source) await ownCc(actor.companyId, source);
  const ccs = await listCostCenters(actor.companyId, true);
  const weights = ccs.map((c) => ({ id: c.id, weight: Number(String(input[`weight_${c.id}`] ?? '').replace(',', '.')) || 0 })).filter((w) => w.weight > 0 && w.id !== source);
  if (weights.length < 1) throw new ValidationError('Ange vikt för minst ett kostnadsställe');
  return sql.begin(async (tx) => {
    const [k] = await tx<{ id: number }[]>`INSERT INTO allocation_keys ${tx({ company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Namn', max: 200 }), basis: str(input, 'basis', { max: 100 }),
      account_from: from, account_to: to, source_cost_center_id: source })} RETURNING id`;
    for (const w of weights) await tx`INSERT INTO allocation_weights (key_id, cost_center_id, weight) VALUES (${k.id}, ${w.id}, ${w.weight})`;
    await auditBy(tx, actor, 'create', 'allocation_key', k.id);
    return k.id;
  });
}

export async function createCharge(actor: Actor, input: Record<string, unknown>) {
  const from = int(input, 'from_cost_center_id', 'Från'), to = int(input, 'to_cost_center_id', 'Till');
  if (from === to) throw new ValidationError('Välj två olika kostnadsställen');
  await ownCc(actor.companyId, from); await ownCc(actor.companyId, to);
  const amount = parseAmount(String(input.amount ?? ''));
  if (amount == null || amount <= 0) throw new ValidationError('Ange beloppet');
  const [c] = await sql<{ id: number }[]>`INSERT INTO internal_charges ${sql({ company_id: actor.companyId, from_cost_center_id: from, to_cost_center_id: to,
    description: str(input, 'description', { required: true, label: 'Beskrivning', max: 200 }), amount, recurring: input.recurring === 'on', start_period: validPeriod(str(input, 'start_period')) })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'internal_charge', c.id);
  return c.id;
}

export async function deactivate(actor: Actor, kind: 'key' | 'charge', id: number) {
  const r = kind === 'key' ? await sql`UPDATE allocation_keys SET active = false WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`
    : await sql`UPDATE internal_charges SET active = false WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError(kind === 'key' ? 'Fördelningsnyckeln' : 'Debiteringen');
}

/** Månadens fördelningar och interna debiteringar (en gång per nyckel/debitering och månad) */
export async function runPeriod(actor: Actor, periodRaw: string) {
  const period = validPeriod(periodRaw);
  const from = `${period}-01`, to = monthEnd(period);
  let n = 0;
  const keys = await sql<{ id: number; name: string; account_from: number; account_to: number; source: number | null }[]>`
    SELECT id, name, account_from, account_to, source_cost_center_id AS source FROM allocation_keys k WHERE company_id = ${actor.companyId} AND active
      AND NOT EXISTS (SELECT 1 FROM allocation_runs r WHERE r.key_id = k.id AND r.period = ${period}) ORDER BY id`;
  for (const k of keys) {
    const weights = (await sql<{ id: number; weight: number }[]>`SELECT cost_center_id AS id, weight::float8 AS weight FROM allocation_weights WHERE key_id = ${k.id} ORDER BY cost_center_id`);
    const costs = await sql<{ account: number; amount: number }[]>`SELECT l.account_number AS account, SUM(l.debit - l.credit)::float8 AS amount FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
      WHERE v.company_id = ${actor.companyId} AND v.date BETWEEN ${from} AND ${to} AND l.account_number BETWEEN ${k.account_from} AND ${k.account_to}
        AND ${k.source == null ? sql`l.cost_center_id IS NULL` : sql`l.cost_center_id = ${k.source}`} AND v.source_type IS DISTINCT FROM 'allocation'
      GROUP BY l.account_number HAVING SUM(l.debit - l.credit) <> 0 ORDER BY 1`;
    const lines = allocationLines(costs, k.source, weights);
    await sql.begin(async (tx) => {
      const claimed = await tx`INSERT INTO allocation_runs (key_id, period, amount) VALUES (${k.id}, ${period}, ${costs.reduce((s, c) => s + c.amount, 0)}) ON CONFLICT DO NOTHING RETURNING key_id`;
      if (!claimed.length || !lines.length) return;
      const v = await createVoucher(tx, { actor, date: to, description: `Kostnadsfördelning ${k.name} ${period}`, lines: fromSigned(lines), sourceType: 'allocation', sourceId: k.id });
      await tx`UPDATE allocation_runs SET voucher_id = ${v.id} WHERE key_id = ${k.id} AND period = ${period}`;
      n++;
    });
  }
  const charges = await sql<{ id: number; from: number; to: number; description: string; amount: number }[]>`
    SELECT id, from_cost_center_id AS from, to_cost_center_id AS to, description, amount::float8 AS amount FROM internal_charges c WHERE company_id = ${actor.companyId} AND active
      AND (start_period = ${period} OR (recurring AND start_period <= ${period})) AND NOT EXISTS (SELECT 1 FROM internal_charge_runs r WHERE r.charge_id = c.id AND r.period = ${period})`;
  if (charges.length) await sql`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${INTERNAL_ACCOUNT}, 'Interna debiteringar') ON CONFLICT DO NOTHING`;
  for (const c of charges) {
    await sql.begin(async (tx) => {
      const claimed = await tx`INSERT INTO internal_charge_runs (charge_id, period) VALUES (${c.id}, ${period}) ON CONFLICT DO NOTHING RETURNING charge_id`;
      if (!claimed.length) return;
      const v = await createVoucher(tx, { actor, date: to, description: `Interndebitering: ${c.description} ${period}`, lines: fromSigned(internalLines({ from: c.from, to: c.to, amount: c.amount })), sourceType: 'internal_charge', sourceId: c.id });
      await tx`UPDATE internal_charge_runs SET voucher_id = ${v.id} WHERE charge_id = ${c.id} AND period = ${period}`;
      n++;
    });
  }
  if (n) await auditBy(sql, actor, 'allocation_run', 'company', actor.companyId, { period, vouchers: n });
  return n;
}

export async function report(companyId: number, from: string, to: string) {
  const rows = await sql<{ cc: number | null; account: number; amount: number; allocated: boolean }[]>`
    SELECT l.cost_center_id AS cc, l.account_number AS account, SUM(l.credit - l.debit)::float8 AS amount, v.source_type = 'allocation' AS allocated
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND v.date BETWEEN ${from} AND ${to} AND l.account_number BETWEEN 3000 AND 8999
    GROUP BY 1, 2, 4`;
  const ccs = await listCostCenters(companyId);
  const cols = [...ccs.map((c) => ({ id: c.id as number | null, label: `${c.code} ${c.name}` })), { id: null, label: 'Utan kostnadsställe' }];
  return cols.map((c) => ({ ...c, ...departmentResult(rows.filter((r) => r.cc === c.id).map((r) => ({ account: r.account, amount: r.amount, allocated: !!r.allocated }))) }))
    .filter((c) => c.revenue || c.variable || c.other || c.internal || c.allocated);
}

export async function overview(companyId: number) {
  const keys = await sql<{ id: number; name: string; basis: string; account_from: number; account_to: number; source: string | null; active: boolean }[]>`
    SELECT k.id, k.name, k.basis, k.account_from, k.account_to, (SELECT code || ' ' || name FROM cost_centers WHERE id = k.source_cost_center_id) AS source, k.active
    FROM allocation_keys k WHERE k.company_id = ${companyId} ORDER BY k.id`;
  const weights = await sql<{ key_id: number; label: string; weight: number }[]>`SELECT w.key_id, c.code || ' ' || c.name AS label, w.weight::float8 AS weight FROM allocation_weights w
    JOIN allocation_keys k ON k.id = w.key_id JOIN cost_centers c ON c.id = w.cost_center_id WHERE k.company_id = ${companyId} ORDER BY c.code`;
  const charges = await sql<{ id: number; from: string; to: string; description: string; amount: number; recurring: boolean; start_period: string; active: boolean }[]>`
    SELECT i.id, f.code || ' ' || f.name AS from, t.code || ' ' || t.name AS to, i.description, i.amount::float8 AS amount, i.recurring, i.start_period, i.active
    FROM internal_charges i JOIN cost_centers f ON f.id = i.from_cost_center_id JOIN cost_centers t ON t.id = i.to_cost_center_id WHERE i.company_id = ${companyId} ORDER BY i.id`;
  const runs = await sql<{ period: string; n: number }[]>`SELECT period, COUNT(*)::int AS n FROM allocation_runs r JOIN allocation_keys k ON k.id = r.key_id WHERE k.company_id = ${companyId} GROUP BY period ORDER BY period DESC LIMIT 12`;
  return { keys, weights, charges, runs, costCenters: await listCostCenters(companyId, true) };
}


