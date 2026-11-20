import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { monthEnd } from '@/lib/format';
import { parseAmount } from '@/lib/money';
import { allocate, CUSTOMS_DEBT, decisionLines, DUTY_ACCOUNT, IMPORT_BASE, IMPORT_BASE_OFFSET, IMPORT_INPUT_VAT, IMPORT_VAT, importVat, landedAverage, reconcile, type Decision } from '@/lib/customs';
import type { Actor } from './actor';
import { date, optInt, str } from './input';

function kronor(input: Record<string, unknown>, k: string, label: string, required = false) {
  const raw = String(input[k] ?? '').trim();
  if (!raw) { if (required) throw new ValidationError(`Ange ${label.toLowerCase()}`); return 0; }
  const v = parseAmount(raw);
  if (v == null || v < 0) throw new ValidationError(`Ange ${label.toLowerCase()} i kronor`);
  return v;
}

const ACCOUNTS: [number, string][] = [
  [IMPORT_BASE[25], 'Import av varor, 25 % moms'], [IMPORT_BASE[12], 'Import av varor, 12 % moms'], [IMPORT_BASE[6], 'Import av varor, 6 % moms'],
  [IMPORT_BASE_OFFSET, 'Motkonto beskattningsunderlag import'], [IMPORT_VAT[25], 'Utgående moms import av varor, 25 %'], [IMPORT_VAT[12], 'Utgående moms import av varor, 12 %'],
  [IMPORT_VAT[6], 'Utgående moms import av varor, 6 %'], [IMPORT_INPUT_VAT, 'Beräknad ingående moms på förvärv från utlandet'], [DUTY_ACCOUNT, 'Tull- och speditionskostnader m.m.'], [CUSTOMS_DEBT, 'Skuld till Tullverket'],
];

/** Registrerar Tullverkets beslut och bokför importmomsen (ruta 50/60) och tullen */
export async function registerDecision(actor: Actor, input: Record<string, unknown>) {
  const decisionNo = str(input, 'decision_no', { required: true, label: 'Tullverkets beslutsnummer', max: 60 });
  const d = date(input, 'date', 'Beslutsdatum');
  const rate = Number(input.vat_rate ?? 25);
  if (![25, 12, 6].includes(rate)) throw new ValidationError('Ogiltig momssats');
  const dec: Decision = { customsValue: kronor(input, 'customs_value', 'Tullvärde', true), duty: kronor(input, 'duty', 'Tull'), fees: kronor(input, 'fees', 'Avgifter'), freightSweden: kronor(input, 'freight_sweden', 'Frakt i Sverige'), vatRate: rate as 25 | 12 | 6 };
  if (!dec.customsValue) throw new ValidationError('Tullvärdet ska vara större än noll');
  const { base, vat } = importVat(dec);
  const stated = String(input.vat_stated ?? '').trim() ? kronor(input, 'vat_stated', 'Moms enligt beslutet') : null;
  const supplierId = optInt(input, 'supplier_id', 'Leverantör');
  if (supplierId) { const [s] = await sql`SELECT 1 FROM suppliers WHERE id = ${supplierId} AND company_id = ${actor.companyId}`; if (!s) throw new ValidationError('Leverantören finns inte'); }
  const poId = optInt(input, 'po_id', 'Inköpsorder');
  if (poId) { const [p] = await sql`SELECT 1 FROM inv_purchase_orders WHERE id = ${poId} AND company_id = ${actor.companyId}`; if (!p) throw new ValidationError('Inköpsordern finns inte'); }
  const deductible = input.deductible !== 'no';
  return sql.begin(async (tx) => {
    for (const [n, name] of ACCOUNTS) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n}, ${name}) ON CONFLICT DO NOTHING`;
    const [dup] = await tx`SELECT 1 FROM customs_decisions WHERE company_id = ${actor.companyId} AND decision_no = ${decisionNo}`;
    if (dup) throw new ConflictError('Beslutet är redan registrerat');
    const v = await createVoucher(tx, { actor, date: d, description: `Tullverket beslut ${decisionNo}${str(input, 'description') ? ` – ${str(input, 'description')}` : ''}`,
      lines: fromSigned(decisionLines(dec, deductible)), sourceType: 'customs' });
    const [r] = await tx<{ id: number }[]>`INSERT INTO customs_decisions ${tx({
      company_id: actor.companyId, decision_no: decisionNo, date: d, description: str(input, 'description', { max: 300 }), supplier_id: supplierId,
      customs_value: dec.customsValue, duty: dec.duty, fees: dec.fees, freight_sweden: dec.freightSweden, vat_rate: rate, vat_base: base, vat, vat_stated: stated,
      freight_alloc: kronor(input, 'freight_alloc', 'Frakt att fördela'), po_id: poId, voucher_id: v.id, created_by: actor.userId,
    })} RETURNING id`;
    await tx`UPDATE vouchers SET source_id = ${r.id} WHERE id = ${v.id}`;
    await auditBy(tx, actor, 'create', 'customs_decision', r.id, { base, vat, duty: dec.duty });
    return { id: r.id, base, vat, mismatch: stated != null && Math.abs(stated - vat) > 100 };
  });
}

/**
 * Fördelar tull, avgifter och frakt på inköpsorderns inlevererade rader efter värde (landed cost).
 * Genomsnittspriset höjs för de enheter som finns kvar i lager; lagervärdet bokas vid nästa lagervärdering.
 */
export async function allocateDecision(actor: Actor, id: number, input: Record<string, unknown>) {
  return sql.begin(async (tx) => {
    const [d] = await tx<{ duty: number; fees: number; freight_alloc: number; po_id: number | null; allocated_at: string | null }[]>`
      SELECT duty::float8 AS duty, fees::float8 AS fees, freight_alloc::float8 AS freight_alloc, po_id, allocated_at::text FROM customs_decisions WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!d) throw new NotFoundError('Tullbeslutet');
    if (d.allocated_at) throw new ConflictError('Kostnaderna är redan fördelade');
    const poId = d.po_id ?? optInt(input, 'po_id', 'Inköpsorder');
    if (!poId) throw new ValidationError('Välj inköpsorder att fördela på');
    const lines = await tx<{ id: number; product_id: number; received: number; unit_price: number }[]>`
      SELECT l.id, l.product_id, l.received::float8 AS received, l.unit_price::float8 AS unit_price FROM inv_purchase_order_lines l JOIN inv_purchase_orders o ON o.id = l.order_id
      WHERE o.id = ${poId} AND o.company_id = ${actor.companyId} AND l.received > 0`;
    if (!lines.length) throw new ValidationError('Inköpsordern har inga inlevererade rader');
    const extra = d.duty + d.fees + d.freight_alloc;
    if (!extra) throw new ValidationError('Det finns ingen tull eller frakt att fördela');
    const alloc = allocate(lines.map((l) => ({ id: l.id, qty: l.received, value: Math.round(l.received * l.unit_price) })), extra);
    const byProduct = new Map<number, { qty: number; allocated: number }>();
    for (const a of alloc) { const pid = lines.find((l) => l.id === a.id)!.product_id; const x = byProduct.get(pid) ?? { qty: 0, allocated: 0 }; byProduct.set(pid, { qty: x.qty + a.qty, allocated: x.allocated + a.allocated }); }
    let toInv = 0;
    for (const [pid, x] of byProduct) {
      const [p] = await tx<{ avg_cost: number; on_hand: number }[]>`SELECT p.avg_cost::float8 AS avg_cost, COALESCE((SELECT SUM(qty) FROM inv_stock WHERE product_id = p.id), 0)::float8 AS on_hand
        FROM inv_products p WHERE p.id = ${pid} AND p.company_id = ${actor.companyId} FOR UPDATE`;
      const r = landedAverage({ onHand: p.on_hand, avgCost: p.avg_cost, received: x.qty, allocated: x.allocated });
      await tx`UPDATE inv_products SET avg_cost = ${r.avgCost} WHERE id = ${pid}`;
      await tx`INSERT INTO customs_allocations ${tx({ decision_id: id, product_id: pid, qty: x.qty, allocated: x.allocated, to_inventory: r.toInventory, unit_before: p.avg_cost, unit_after: r.avgCost })}`;
      toInv += r.toInventory;
    }
    await tx`UPDATE customs_decisions SET po_id = ${poId}, allocated_at = now() WHERE id = ${id}`;
    await auditBy(tx, actor, 'allocate', 'customs_decision', id, { po: poId, extra, toInventory: toInv });
    return { extra, toInventory: toInv, products: byProduct.size };
  });
}

export async function setStatement(actor: Actor, input: Record<string, unknown>) {
  const month = str(input, 'month');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ValidationError('Ange månad som ÅÅÅÅ-MM');
  const amount = kronor(input, 'amount', 'Belopp enligt Tullverket', true);
  await sql`INSERT INTO customs_statements (company_id, month, amount) VALUES (${actor.companyId}, ${month}, ${amount}) ON CONFLICT (company_id, month) DO UPDATE SET amount = EXCLUDED.amount`;
  await auditBy(sql, actor, 'statement', 'customs', actor.companyId, { month, amount });
}

export async function overview(companyId: number, year: number) {
  const decisions = await sql<{ id: number; decision_no: string; date: string; description: string; supplier: string | null; customs_value: number; duty: number; fees: number; freight_sweden: number; vat_rate: number; vat_base: number; vat: number; vat_stated: number | null; freight_alloc: number; po_id: number | null; po_number: number | null; allocated_at: string | null; voucher_id: number | null }[]>`
    SELECT d.id, d.decision_no, to_char(d.date,'YYYY-MM-DD') AS date, d.description, s.name AS supplier, d.customs_value::float8 AS customs_value, d.duty::float8 AS duty, d.fees::float8 AS fees,
      d.freight_sweden::float8 AS freight_sweden, d.vat_rate, d.vat_base::float8 AS vat_base, d.vat::float8 AS vat, d.vat_stated::float8 AS vat_stated, d.freight_alloc::float8 AS freight_alloc,
      d.po_id, (SELECT number FROM inv_purchase_orders WHERE id = d.po_id) AS po_number, d.allocated_at::text, d.voucher_id
    FROM customs_decisions d LEFT JOIN suppliers s ON s.id = d.supplier_id WHERE d.company_id = ${companyId} AND d.date BETWEEN ${`${year}-01-01`} AND ${`${year}-12-31`} ORDER BY d.date DESC, d.id DESC`;
  const allocations = await sql<{ decision_id: number; sku: string; name: string; qty: number; allocated: number; unit_before: number; unit_after: number }[]>`
    SELECT a.decision_id, p.sku, p.name, a.qty::float8 AS qty, a.allocated::float8 AS allocated, a.unit_before::float8 AS unit_before, a.unit_after::float8 AS unit_after
    FROM customs_allocations a JOIN customs_decisions d ON d.id = a.decision_id JOIN inv_products p ON p.id = a.product_id WHERE d.company_id = ${companyId}`;
  const statements = new Map((await sql<{ month: string; amount: number }[]>`SELECT month, amount::float8 AS amount FROM customs_statements WHERE company_id = ${companyId} AND month LIKE ${`${year}-%`}`).map((r) => [r.month, r.amount]));
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const p = `${year}-${String(m).padStart(2, '0')}`;
    const dm = decisions.filter((d) => d.date.startsWith(p));
    const sums = await accountSums(companyId, `${p}-01`, monthEnd(p));
    const credited = await sql<{ v: number }[]>`SELECT COALESCE(SUM(l.credit), 0)::float8 AS v FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
      WHERE v.company_id = ${companyId} AND l.account_number = ${CUSTOMS_DEBT} AND v.date BETWEEN ${`${p}-01`} AND ${monthEnd(p)}`;
    const paid = await sql<{ v: number }[]>`SELECT COALESCE(SUM(l.debit), 0)::float8 AS v FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
      WHERE v.company_id = ${companyId} AND l.account_number = ${CUSTOMS_DEBT} AND v.date BETWEEN ${`${p}-01`} AND ${monthEnd(p)}`;
    const box50 = [...sums].filter(([n]) => n >= 4545 && n <= 4547).reduce((s, [, v]) => s + v, 0);
    const box60 = -[...sums].filter(([n]) => n === 2615 || n === 2625 || n === 2635).reduce((s, [, v]) => s + v, 0);
    const due = dm.reduce((s, d) => s + d.duty + d.fees, 0);
    if (!dm.length && !credited[0].v && !paid[0].v && !statements.has(p)) continue;
    months.push({ month: p, count: dm.length, base: dm.reduce((s, d) => s + d.vat_base, 0), vat: dm.reduce((s, d) => s + d.vat, 0), box50, box60, due, booked: credited[0].v, paid: paid[0].v,
      statement: statements.get(p) ?? null, ...reconcile({ decisions: due, booked: credited[0].v, statement: statements.get(p) ?? null }) });
  }
  const [debt] = await sql<{ v: number }[]>`SELECT COALESCE(SUM(l.credit - l.debit), 0)::float8 AS v FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND l.account_number = ${CUSTOMS_DEBT}`;
  return { decisions, allocations, months, debt: debt.v };
}

export async function openPOs(companyId: number) {
  return sql<{ id: number; number: number; supplier: string | null }[]>`SELECT o.id, o.number, s.name AS supplier FROM inv_purchase_orders o LEFT JOIN suppliers s ON s.id = o.supplier_id
    WHERE o.company_id = ${companyId} AND o.status IN ('partial','received') ORDER BY o.id DESC LIMIT 50`;
}
