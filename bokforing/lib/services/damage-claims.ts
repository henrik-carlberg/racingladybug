import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { ASSET_CATEGORIES, type AssetCategory } from '@/lib/assets';
import { COMPENSATION, INVENTORY, RECEIVABLE, STOCK_CHANGE, assessmentLines, compensation, paymentLines, scrapLines, stockLossLines } from '@/lib/damage-claims';
import type { Actor } from './actor';
import { ensureAccounts } from './assets';
import { date, int, optInt, str } from './input';

const kronor = (v: unknown, label: string, zero = false) => { const n = parseAmount(String(v ?? '').trim() || (zero ? '0' : '')); if (n == null || n < 0 || (!zero && !n)) throw new ValidationError(`Ange ${label} i kronor`); return n; };
const NAMES: Record<number, string> = { [RECEIVABLE]: 'Övriga kortfristiga fordringar', [COMPENSATION]: 'Försäkringsersättningar', [INVENTORY]: 'Lager av handelsvaror', [STOCK_CHANGE]: 'Förändring av lager av handelsvaror' };
const ensure = async (tx: Tx, companyId: number, ns: number[]) => { for (const n of ns) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${n}, ${NAMES[n]}) ON CONFLICT DO NOTHING`; };

export async function overview(companyId: number) {
  const claims = await sql<{ id: number; kind: string; description: string; damage_date: string; insurer: string; claim_ref: string; asset: string | null; status: string; written_off: number; assessed: number | null; deductible: number | null; compensation: number | null; decided_on: string | null; paid_on: string | null; fund_claim_id: number | null; items: string | null }[]>`
    SELECT d.id, d.kind, d.description, to_char(d.damage_date,'YYYY-MM-DD') AS damage_date, d.insurer, d.claim_ref, a.name AS asset, d.status, d.written_off::float8 AS written_off,
      d.assessed::float8 AS assessed, d.deductible::float8 AS deductible, d.compensation::float8 AS compensation, to_char(d.decided_on,'YYYY-MM-DD') AS decided_on, to_char(d.paid_on,'YYYY-MM-DD') AS paid_on, d.fund_claim_id,
      (SELECT string_agg(i.quantity::float8 || ' ' || p.unit || ' ' || p.sku, ', ') FROM damage_claim_items i JOIN inv_products p ON p.id = i.product_id WHERE i.claim_id = d.id) AS items
    FROM damage_claims d LEFT JOIN assets a ON a.id = d.asset_id WHERE d.company_id = ${companyId} ORDER BY d.status IN ('reported','assessed') DESC, d.damage_date DESC, d.id DESC LIMIT 200`;
  const assets = await sql<{ id: number; name: string }[]>`SELECT id, name FROM assets WHERE company_id = ${companyId} AND status = 'active' ORDER BY name`;
  const products = await sql<{ id: number; label: string }[]>`SELECT id, sku || ' ' || name AS label FROM inv_products WHERE company_id = ${companyId} AND active ORDER BY sku`;
  const [{ receivable }] = await sql<{ receivable: number }[]>`SELECT COALESCE(SUM(l.debit - l.credit), 0)::float8 AS receivable FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND l.account_number = ${RECEIVABLE} AND v.source_type = 'damage_claim'`;
  return { claims, assets, products, receivable };
}

/** Skadeanmälan: en förstörd tillgång utrangeras och förstörda varor skrivs bort ur lagret direkt; andra skador (t.ex. reparationer) bokförs som vanliga kostnader */
export async function report(actor: Actor, input: Record<string, unknown>) {
  const kind = ['asset', 'inventory', 'other'].includes(String(input.kind)) ? String(input.kind) as 'asset' | 'inventory' | 'other' : 'other';
  const d = date(input, 'damage_date', 'Skadedatum');
  const description = str(input, 'description', { required: true, label: 'Vad som hänt', max: 300 });
  return sql.begin(async (tx) => {
    let assetId: number | null = null, writtenOff = 0, voucherId: number | null = null;
    const items: { product_id: number; quantity: number; unit_cost: number }[] = [];
    if (kind === 'asset') {
      assetId = int(input, 'asset_id', 'Tillgång');
      const [a] = await tx<{ name: string; cost: number; category: AssetCategory; asset_account: number; acc_dep_account: number; status: string }[]>`
        SELECT name, cost::float8 AS cost, category, asset_account, acc_dep_account, status FROM assets WHERE id = ${assetId} AND company_id = ${actor.companyId} FOR UPDATE`;
      if (!a) throw new NotFoundError('Tillgången');
      if (a.status !== 'active') throw new ConflictError('Tillgången är redan avyttrad eller utrangerad');
      await ensureAccounts(tx, actor.companyId, a.category);
      const [{ booked }] = await tx<{ booked: number }[]>`SELECT COALESCE(SUM(amount), 0)::float8 AS booked FROM asset_depreciations WHERE asset_id = ${assetId}`;
      writtenOff = a.cost - booked;
      const v = await createVoucher(tx, { actor, date: d, description: `Skada: ${description} – utrangering av ${a.name}`, lines: fromSigned(scrapLines(a.cost, booked, { asset: a.asset_account, accDep: a.acc_dep_account })), sourceType: 'damage_claim' });
      voucherId = v.id;
      await tx`UPDATE assets SET status = 'disposed', disposed_on = ${d}, disposal_voucher_id = ${v.id} WHERE id = ${assetId}`;
    } else if (kind === 'inventory') {
      const productId = int(input, 'product_id', 'Artikel');
      const q = Number(String(input.quantity ?? '').replace(',', '.'));
      if (!Number.isFinite(q) || q <= 0 || Math.round(q * 1000) !== q * 1000) throw new ValidationError('Ange antal förstörda enheter');
      const [p] = await tx<{ avg_cost: number; sku: string }[]>`SELECT avg_cost::float8 AS avg_cost, sku FROM inv_products WHERE id = ${productId} AND company_id = ${actor.companyId}`;
      if (!p) throw new NotFoundError('Artikeln');
      const { move, warehouseId } = await import('@/modules/lager/service');
      await move(tx, actor, { product_id: productId, warehouse_id: await warehouseId(tx, actor.companyId, input), qty: -q, type: 'adjustment', date: d, ref_type: 'damage_claim', note: `Skada: ${description}` });
      writtenOff = Math.round(q * p.avg_cost);
      items.push({ product_id: productId, quantity: q, unit_cost: p.avg_cost });
      if (writtenOff) {
        await ensure(tx, actor.companyId, [INVENTORY, STOCK_CHANGE]);
        voucherId = (await createVoucher(tx, { actor, date: d, description: `Skada: ${description} – ${q} ${p.sku} bortskrivna ur lagret`, lines: fromSigned(stockLossLines(writtenOff)), sourceType: 'damage_claim' })).id;
      }
    }
    const [c] = await tx<{ id: number }[]>`INSERT INTO damage_claims ${tx({ company_id: actor.companyId, kind, description, damage_date: d, insurer: str(input, 'insurer', { max: 100 }), claim_ref: str(input, 'claim_ref', { max: 60 }),
      asset_id: assetId, written_off: writtenOff, report_voucher_id: voucherId, created_by: actor.userId })} RETURNING id`;
    if (items.length) await tx`INSERT INTO damage_claim_items ${tx(items.map((i) => ({ ...i, claim_id: c.id })))}`;
    await auditBy(tx, actor, 'damage_reported', 'damage_claim', c.id, { kind, written_off: writtenOff });
    return { id: c.id, writtenOff };
  });
}

const lock = async (tx: Tx, actor: Actor, id: number, status: string) => {
  const [c] = await tx<{ id: number; kind: string; description: string; damage_date: string; status: string; written_off: number; compensation: number | null; asset_id: number | null }[]>`
    SELECT id, kind, description, to_char(damage_date,'YYYY-MM-DD') AS damage_date, status, written_off::float8 AS written_off, compensation::float8 AS compensation, asset_id FROM damage_claims WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
  if (!c) throw new NotFoundError('Skadeärendet');
  if (c.status !== status) throw new ConflictError(status === 'reported' ? 'Försäkringsbolaget har redan lämnat besked' : 'Ärendet väntar inte på utbetalning');
  return c;
};

/** Försäkringsbolagets besked: värdering minus självrisk tas upp som fordran och intäkt. Förstörda inventarier och byggnader kan sedan sättas av till ersättningsfond i bokslutet. */
export async function assess(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  const denied = input.denied === 'on' || input.denied === true;
  return sql.begin(async (tx) => {
    const c = await lock(tx, actor, id, 'reported');
    if (denied) {
      await tx`UPDATE damage_claims SET status = 'denied', decided_on = ${d}, compensation = 0 WHERE id = ${id}`;
      await auditBy(tx, actor, 'damage_denied', 'damage_claim', id);
      return { compensation: 0, deductible: 0, fund: false };
    }
    const assessed = kronor(input.assessed, 'skadans värdering'), deductible = kronor(input.deductible, 'självrisken', true);
    const amount = compensation(assessed, deductible);
    if (!amount) throw new ValidationError('Självrisken är lika stor som skadan – markera ärendet som utan ersättning i stället');
    await ensure(tx, actor.companyId, [RECEIVABLE, COMPENSATION]);
    const v = await createVoucher(tx, { actor, date: d, description: `Försäkringsersättning: ${c.description} (värdering ${(assessed / 100).toLocaleString('sv-SE')} kr, självrisk ${(deductible / 100).toLocaleString('sv-SE')} kr)`, lines: fromSigned(assessmentLines(amount)), sourceType: 'damage_claim', sourceId: id });
    let fundId: number | null = null;
    if (c.kind === 'asset' && c.asset_id) {
      // Underlag för ersättningsfond (inkomstskattelagen 31 kap.) – avsättningen görs i bokslutet
      const [a] = await tx<{ category: AssetCategory; asset_account: number }[]>`SELECT category, asset_account FROM assets WHERE id = ${c.asset_id}`;
      if (a && a.asset_account < 1300) {
        const [f] = await tx<{ id: number }[]>`INSERT INTO insurance_claims ${tx({ company_id: actor.companyId, description: c.description, kind: a.asset_account < 1200 ? 'byggnad' : 'inventarier', damage_date: c.damage_date,
          asset_account: ASSET_CATEGORIES[a.category]?.asset ?? a.asset_account, book_value: c.written_off, compensation: amount, damage_voucher_id: v.id, created_by: actor.userId })} RETURNING id`;
        fundId = f.id;
      }
    }
    await tx`UPDATE damage_claims SET status = 'assessed', decided_on = ${d}, assessed = ${assessed}, deductible = ${deductible}, compensation = ${amount}, assessment_voucher_id = ${v.id}, fund_claim_id = ${fundId} WHERE id = ${id}`;
    await auditBy(tx, actor, 'damage_assessed', 'damage_claim', id, { assessed, deductible, compensation: amount });
    return { compensation: amount, deductible, fund: !!fundId };
  });
}

/** Utbetalningen från försäkringsbolaget löser upp fordran */
export async function pay(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Utbetalningen tas emot på ett bankkonto (19xx)');
  return sql.begin(async (tx) => {
    const c = await lock(tx, actor, id, 'assessed');
    const v = await createVoucher(tx, { actor, date: d, description: `Utbetald försäkringsersättning: ${c.description}`, lines: fromSigned(paymentLines(c.compensation!, bank)), sourceType: 'damage_claim', sourceId: id });
    await tx`UPDATE damage_claims SET status = 'paid', paid_on = ${d}, payment_voucher_id = ${v.id} WHERE id = ${id}`;
    await auditBy(tx, actor, 'damage_paid', 'damage_claim', id, { amount: c.compensation });
    return c.compensation!;
  });
}
