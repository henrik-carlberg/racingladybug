import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, createVoucher, fiscalYears, openingBalances } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { monthEnd } from '@/lib/format';
import { parseAmount } from '@/lib/money';
import { cashFlow, deferredTax, deferredTaxEntry, DEFERRED_TAX_ASSET, DEFERRED_TAX_COST, DEFERRED_TAX_LIABILITY, k3Changes } from '@/lib/cashflow';
import type { Actor } from './actor';
import { str } from './input';

async function fyOf(companyId: number, fyId: number) {
  const fy = (await fiscalYears(companyId)).find((y) => y.id === fyId);
  if (!fy) throw new NotFoundError('Räkenskapsåret');
  return fy;
}

const cashAt = (m: Map<number, number>) => [...m].filter(([n]) => n >= 1900 && n <= 1999).reduce((s, [, v]) => s + v, 0);

/** Kassaflödesanalys per månad och för hela räkenskapsåret */
export async function cashFlowReport(companyId: number, fyId: number) {
  const fy = await fyOf(companyId, fyId);
  const months: { period: string; flow: ReturnType<typeof cashFlow> }[] = [];
  for (let p = fy.start_date.slice(0, 7); p <= fy.end_date.slice(0, 7);) {
    months.push({ period: p, flow: cashFlow(await accountSums(companyId, `${p}-01`, monthEnd(p))) });
    const [y, m] = p.split('-').map(Number);
    p = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  const year = cashFlow(await accountSums(companyId, fy.start_date, fy.end_date));
  const opening = cashAt(await openingBalances(companyId, fy.start_date));
  return { fy, months, year, opening, closing: opening + year.cashChange };
}

export async function framework(companyId: number) {
  const [c] = await sql<{ accounting_framework: 'K2' | 'K3'; k3_from: string | null; company_type: string }[]>`
    SELECT accounting_framework, to_char(k3_from,'YYYY-MM-DD') AS k3_from, company_type FROM companies WHERE id = ${companyId}`;
  return c;
}

/** Underlag för bytet K2 → K3: vad som påverkas för just det här bolaget */
export async function k3Explanation(companyId: number, fyId: number) {
  const fy = await fyOf(companyId, fyId);
  const [b] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM assets WHERE company_id = ${companyId} AND category = 'byggnader' AND status = 'active' AND property_id IS NULL`;
  const ub = await openingBalances(companyId, fy.start_date);
  for (const [n, v] of await accountSums(companyId, fy.start_date, fy.end_date)) if (n < 3000) ub.set(n, (ub.get(n) ?? 0) + v);
  const untaxed = -[...ub].filter(([n]) => n >= 2100 && n <= 2199).reduce((s, [, v]) => s + v, 0);
  const sales = -[...await accountSums(companyId, fy.start_date, fy.end_date)].filter(([n]) => n >= 3000 && n <= 3799).reduce((s, [, v]) => s + v, 0);
  const assets = [...ub].filter(([n]) => n < 2000).reduce((s, [, v]) => s + v, 0);
  // Större företag (ÅRL 1:3): mer än ett av: 50 anställda, 40 mkr balansomslutning, 80 mkr nettoomsättning
  const larger = [assets > 4_000_000_000, sales > 8_000_000_000].filter(Boolean).length >= 2;
  return { changes: k3Changes({ buildingsWithoutComponents: b.n, untaxedReserves: untaxed, hasCashFlow: true, larger }), untaxed, deferredInUntaxed: Math.round(untaxed * 0.206) };
}

export async function setFramework(actor: Actor, fyId: number, input: Record<string, unknown>) {
  const fy = await fyOf(actor.companyId, fyId);
  const target = str(input, 'framework') === 'K3' ? 'K3' : 'K2';
  const c = await framework(actor.companyId);
  if (c.company_type !== 'AB') throw new ValidationError('K3 gäller aktiebolag och andra juridiska personer – enskild firma upprättar årsbokslut');
  if (c.accounting_framework === target) throw new ConflictError(`Bolaget tillämpar redan ${target}`);
  if (target === 'K3' && input.confirm !== 'on') throw new ValidationError('Bekräfta att du har läst vad bytet innebär');
  if (fy.closed) throw new ValidationError('Byt regelverk från ett öppet räkenskapsår');
  await sql`UPDATE companies SET accounting_framework = ${target}, k3_from = ${target === 'K3' ? fy.start_date : null} WHERE id = ${actor.companyId}`;
  await auditBy(sql, actor, 'framework', 'company', actor.companyId, { from: c.accounting_framework, to: target, fy: fy.start_date });
}

export async function listDiffs(companyId: number, fyId: number) {
  return sql<{ id: number; label: string; amount: number }[]>`SELECT id, label, amount::float8 AS amount FROM k3_temp_diffs WHERE company_id = ${companyId} AND fiscal_year_id = ${fyId} ORDER BY id`;
}

export async function addDiff(actor: Actor, fyId: number, input: Record<string, unknown>) {
  await fyOf(actor.companyId, fyId);
  const label = str(input, 'label', { required: true, label: 'Post', max: 200 });
  const amount = parseAmount(String(input.amount ?? ''));
  if (amount == null || amount === 0) throw new ValidationError('Ange skillnaden i kronor (negativ för skattefordran)');
  await sql`INSERT INTO k3_temp_diffs (company_id, fiscal_year_id, label, amount) VALUES (${actor.companyId}, ${fyId}, ${label}, ${amount})`;
  await auditBy(sql, actor, 'k3_diff', 'fiscal_year', fyId, { label, amount });
}

export async function removeDiff(actor: Actor, id: number) {
  const r = await sql`DELETE FROM k3_temp_diffs WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Posten');
}

async function currentDeferred(companyId: number, fy: { start_date: string; end_date: string }) {
  const ub = await openingBalances(companyId, fy.start_date);
  for (const [n, v] of await accountSums(companyId, fy.start_date, fy.end_date)) if (n < 3000) ub.set(n, (ub.get(n) ?? 0) + v);
  return { liability: -(ub.get(DEFERRED_TAX_LIABILITY) ?? 0), asset: ub.get(DEFERRED_TAX_ASSET) ?? 0 };
}

export async function deferredStatus(companyId: number, fyId: number) {
  const fy = await fyOf(companyId, fyId);
  const diffs = await listDiffs(companyId, fyId);
  const target = deferredTax(diffs);
  const current = await currentDeferred(companyId, fy);
  return { fy, diffs, target, current, entry: deferredTaxEntry(target, current) };
}

/** Bokför förändringen av uppskjuten skatt per bokslutsdagen */
export async function bookDeferredTax(actor: Actor, fyId: number) {
  const c = await framework(actor.companyId);
  if (c.accounting_framework !== 'K3') throw new ValidationError('Uppskjuten skatt bokförs bara enligt K3');
  const s = await deferredStatus(actor.companyId, fyId);
  if (s.fy.closed) throw new ConflictError('Räkenskapsåret är stängt');
  if (!s.entry.length) throw new ValidationError('Den uppskjutna skatten är redan bokförd med rätt belopp');
  return sql.begin(async (tx) => {
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${DEFERRED_TAX_LIABILITY}, 'Avsättningar för uppskjutna skatter'),
      (${actor.companyId}, ${DEFERRED_TAX_ASSET}, 'Uppskjuten skattefordran'), (${actor.companyId}, ${DEFERRED_TAX_COST}, 'Uppskjuten skatt') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: s.fy.end_date, description: `Uppskjuten skatt ${s.fy.end_date.slice(0, 4)} (K3 kap. 29)`, lines: fromSigned(s.entry), sourceType: 'deferred_tax' });
    await auditBy(tx, actor, 'deferred_tax', 'fiscal_year', fyId, { net: s.target.net });
    return v;
  });
}

/** K3-tillägg till årsredovisningen: kassaflödesanalys, komponenter, uppskjuten skatt */
export async function k3Extras(companyId: number, fyId: number) {
  const cf = await cashFlowReport(companyId, fyId);
  const d = await deferredStatus(companyId, fyId);
  const components = await sql<{ name: string; cost: number; life_months: number; booked: number }[]>`
    SELECT a.name, a.cost::float8 AS cost, a.life_months, COALESCE((SELECT SUM(amount) FROM asset_depreciations x WHERE x.asset_id = a.id AND x.period <= ${cf.fy.end_date.slice(0, 7)}), 0)::float8 AS booked
    FROM assets a WHERE a.company_id = ${companyId} AND a.status = 'active' AND a.acquired_on <= ${cf.fy.end_date} ORDER BY a.category, a.name`;
  return { cashflow: cf.year, opening: cf.opening, closing: cf.closing, deferred: d.target, components };
}
