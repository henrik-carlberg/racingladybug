import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { monthEnd, today } from '@/lib/format';
import { parseAmount } from '@/lib/money';
import { AGENT_COMMISSION_ACCOUNT, invoiceCommission, selfInvoiceVat, targetBonus, tierBonus, type Rule } from '@/lib/commission';
import type { Actor } from './actor';
import { int, optInt, str } from './input';
import { registerSupplierInvoice } from './suppliers';
import { updatePayslip } from './payroll';

const pct = (v: unknown, label: string) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new ValidationError(`Ange ${label} i procent (0–100)`);
  return n;
};
const kronor = (v: unknown) => { const s = String(v ?? '').trim(); if (!s) return null; const x = parseAmount(s); if (x == null || x < 0) throw new ValidationError('Ogiltigt belopp'); return x; };
const validPeriod = (p: string) => { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) throw new ValidationError('Ange period som ÅÅÅÅ-MM'); return p; };

async function ownSeller(companyId: number, id: number) {
  const [s] = await sql<{ id: number; name: string; kind: 'employee' | 'agent'; employee_id: number | null; supplier_id: number | null; base_rate: number; target: number | null; target_bonus: number | null; agent_vat: boolean }[]>`
    SELECT id, name, kind, employee_id, supplier_id, base_rate::float8 AS base_rate, target::float8 AS target, target_bonus::float8 AS target_bonus, agent_vat FROM commission_sellers WHERE id = ${id} AND company_id = ${companyId}`;
  if (!s) throw new NotFoundError('Säljaren');
  return s;
}

export async function addSeller(actor: Actor, input: Record<string, unknown>) {
  const kind = str(input, 'kind') === 'agent' ? 'agent' : 'employee';
  const employeeId = kind === 'employee' ? optInt(input, 'employee_id', 'Anställd') : null;
  const supplierId = kind === 'agent' ? optInt(input, 'supplier_id', 'Agent (leverantör)') : null;
  if (kind === 'employee') { const [e] = employeeId ? await sql`SELECT 1 FROM employees WHERE id = ${employeeId} AND company_id = ${actor.companyId}` : []; if (!e) throw new ValidationError('Välj den anställda'); }
  if (kind === 'agent') { const [s] = supplierId ? await sql`SELECT 1 FROM suppliers WHERE id = ${supplierId} AND company_id = ${actor.companyId}` : []; if (!s) throw new ValidationError('Välj agenten bland leverantörerna'); }
  const [r] = await sql<{ id: number }[]>`INSERT INTO commission_sellers ${sql({
    company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Namn', max: 200 }), kind, employee_id: employeeId, supplier_id: supplierId,
    base_rate: pct(input.base_rate ?? 0, 'grundprovisionen'), target: kronor(input.target), target_bonus: kronor(input.target_bonus), agent_vat: input.agent_vat === 'on' || kind === 'employee',
  })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'commission_seller', r.id);
  return r.id;
}

export async function addRule(actor: Actor, input: Record<string, unknown>) {
  const scope = str(input, 'scope') === 'account' ? 'account' : 'customer';
  const sellerId = optInt(input, 'seller_id', 'Säljare');
  if (sellerId) await ownSeller(actor.companyId, sellerId);
  const customerId = scope === 'customer' ? int(input, 'customer_id', 'Kund') : null;
  if (customerId) { const [c] = await sql`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`; if (!c) throw new ValidationError('Kunden finns inte'); }
  const account = scope === 'account' ? int(input, 'account', 'Intäktskonto') : null;
  if (account != null && (account < 3000 || account > 3999)) throw new ValidationError('Kontoregler gäller intäktskonton 3000–3999');
  await sql`INSERT INTO commission_rules ${sql({ company_id: actor.companyId, seller_id: sellerId, scope, customer_id: customerId, account, rate_pct: pct(input.rate_pct, 'provisionen') })}`;
  await auditBy(sql, actor, 'rule', 'commission', actor.companyId);
}

export async function removeRule(actor: Actor, id: number) {
  const r = await sql`DELETE FROM commission_rules WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Regeln');
}

export async function addTier(actor: Actor, sellerId: number, input: Record<string, unknown>) {
  await ownSeller(actor.companyId, sellerId);
  const threshold = kronor(input.threshold);
  if (threshold == null) throw new ValidationError('Ange gränsen i kronor');
  await sql`INSERT INTO commission_tiers (seller_id, threshold, rate_pct) VALUES (${sellerId}, ${threshold}, ${pct(input.rate_pct, 'bonusen')})`;
}

export async function assignCustomer(actor: Actor, input: Record<string, unknown>) {
  const customerId = int(input, 'customer_id', 'Kund');
  const sellerId = optInt(input, 'seller_id', 'Säljare');
  if (sellerId) await ownSeller(actor.companyId, sellerId);
  const r = await sql`UPDATE customers SET seller_id = ${sellerId} WHERE id = ${customerId} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Kunden');
}

export async function setInvoiceSeller(actor: Actor, input: Record<string, unknown>) {
  const invoiceNo = int(input, 'invoice_number', 'Fakturanummer');
  const sellerId = int(input, 'seller_id', 'Säljare');
  await ownSeller(actor.companyId, sellerId);
  const [i] = await sql<{ id: number }[]>`SELECT id FROM invoices WHERE company_id = ${actor.companyId} AND invoice_number = ${invoiceNo}`;
  if (!i) throw new NotFoundError('Fakturan');
  await sql`INSERT INTO invoice_sellers (invoice_id, seller_id) VALUES (${i.id}, ${sellerId}) ON CONFLICT (invoice_id) DO UPDATE SET seller_id = EXCLUDED.seller_id`;
  await auditBy(sql, actor, 'invoice_seller', 'invoice', i.id, { seller: sellerId });
}

/** Periodens provision per säljare: betalda fakturor (betaldatum i perioden) minus krediteringar bokförda i perioden */
export async function calculate(companyId: number, period: string) {
  validPeriod(period);
  const from = `${period}-01`, to = monthEnd(period);
  const sellers = await sql<{ id: number; name: string; kind: string; base_rate: number; target: number | null; target_bonus: number | null }[]>`
    SELECT id, name, kind, base_rate::float8 AS base_rate, target::float8 AS target, target_bonus::float8 AS target_bonus FROM commission_sellers WHERE company_id = ${companyId} AND active ORDER BY name`;
  const rules = (await sql<{ scope: 'customer' | 'account'; customer_id: number | null; account: number | null; rate_pct: number; seller_id: number | null }[]>`
    SELECT scope, customer_id, account, rate_pct::float8 AS rate_pct, seller_id FROM commission_rules WHERE company_id = ${companyId}`).map((r): Rule => ({ scope: r.scope, customerId: r.customer_id, account: r.account, ratePct: r.rate_pct, sellerId: r.seller_id }));
  const invoices = await sql<{ id: number; number: number; customer_id: number; customer: string; seller_id: number | null; net: number; credit: boolean; date: string }[]>`
    SELECT i.id, i.invoice_number AS number, i.customer_id, c.name AS customer, COALESCE(s.seller_id, c.seller_id) AS seller_id, i.total_net::float8 AS net, i.credit_of_id IS NOT NULL AS credit,
      to_char(COALESCE(i.paid_date, i.invoice_date),'YYYY-MM-DD') AS date
    FROM invoices i JOIN customers c ON c.id = i.customer_id LEFT JOIN invoice_sellers s ON s.invoice_id = i.id
    WHERE i.company_id = ${companyId} AND NOT i.advance AND (
      (i.credit_of_id IS NULL AND i.status = 'paid' AND i.paid_date BETWEEN ${from} AND ${to}) OR
      (i.credit_of_id IS NOT NULL AND i.status <> 'draft' AND i.invoice_date BETWEEN ${from} AND ${to}))`;
  const lines = invoices.length ? await sql<{ invoice_id: number; account: number; net: number }[]>`
    SELECT invoice_id, account_number AS account, ROUND(quantity * unit_price)::float8 AS net FROM invoice_lines WHERE invoice_id = ANY(${invoices.map((i) => i.id)})` : [];
  const tiers = await sql<{ seller_id: number; threshold: number; rate_pct: number }[]>`SELECT t.seller_id, t.threshold::float8 AS threshold, t.rate_pct::float8 AS rate_pct
    FROM commission_tiers t JOIN commission_sellers s ON s.id = t.seller_id WHERE s.company_id = ${companyId}`;
  return sellers.map((s) => {
    const mine = invoices.filter((i) => i.seller_id === s.id);
    const details = mine.map((i) => {
      const net = i.credit ? -Math.abs(i.net) : i.net;
      const c = invoiceCommission({ netSek: net, lines: lines.filter((l) => l.invoice_id === i.id), sellerId: s.id, customerId: i.customer_id, baseRate: s.base_rate, rules });
      return { invoice: i.number, customer: i.customer, date: i.date, net, commission: c };
    });
    const basis = details.reduce((t, d) => t + d.net, 0);
    const commission = details.reduce((t, d) => t + d.commission, 0);
    const bonus = tierBonus(tiers.filter((t) => t.seller_id === s.id).map((t) => ({ threshold: t.threshold, ratePct: t.rate_pct })), basis) + targetBonus({ target: s.target, amount: s.target_bonus, basis });
    return { seller: s, basis, commission, bonus, total: commission + bonus, details };
  });
}

/** Sparar periodens avräkning (räknas om tills den är överförd) */
export async function settle(actor: Actor, period: string) {
  const rows = await calculate(actor.companyId, period);
  let n = 0;
  for (const r of rows) {
    if (!r.details.length && !r.bonus) continue;
    const res = await sql`INSERT INTO commission_runs (company_id, seller_id, period, basis, commission, bonus, total, details)
      VALUES (${actor.companyId}, ${r.seller.id}, ${period}, ${r.basis}, ${r.commission}, ${r.bonus}, ${r.total}, ${sql.json(r.details as never)})
      ON CONFLICT (seller_id, period) DO UPDATE SET basis = EXCLUDED.basis, commission = EXCLUDED.commission, bonus = EXCLUDED.bonus, total = EXCLUDED.total, details = EXCLUDED.details
      WHERE commission_runs.status = 'calculated' RETURNING id`;
    n += res.length;
  }
  await auditBy(sql, actor, 'settle', 'commission', actor.companyId, { period, sellers: n });
  return n;
}

/**
 * Överför avräkningen: anställd → provisionsrad på lönespecen i en lönekörning som inte är bokförd;
 * agent → självfaktura som leverantörsfaktura (med moms om agenten är momsregistrerad).
 */
export async function transfer(actor: Actor, runId: number) {
  const [r] = await sql<{ id: number; seller_id: number; period: string; total: number; status: string }[]>`
    SELECT id, seller_id, period, total::float8 AS total, status FROM commission_runs WHERE id = ${runId} AND company_id = ${actor.companyId}`;
  if (!r) throw new NotFoundError('Avräkningen');
  if (r.status !== 'calculated') throw new ConflictError('Avräkningen är redan överförd');
  if (r.total <= 0) throw new ValidationError('Det finns ingen provision att betala ut för perioden');
  const s = await ownSeller(actor.companyId, r.seller_id);
  const claim = await sql`UPDATE commission_runs SET status = 'transferred', transferred_at = now() WHERE id = ${runId} AND status = 'calculated' RETURNING id`;
  if (!claim.length) throw new ConflictError('Avräkningen är redan överförd');
  try {
    if (s.kind === 'employee') {
      const [slip] = await sql<{ id: number; run_id: number; items: { type: string; description: string; amount: number; code?: string; account?: number }[] }[]>`
        SELECT p.id, p.run_id, p.items FROM payslips p JOIN payroll_runs pr ON pr.id = p.run_id
        WHERE pr.company_id = ${actor.companyId} AND pr.status = 'draft' AND p.employee_id = ${s.employee_id} ORDER BY pr.period, pr.id LIMIT 1`;
      if (!slip) throw new ValidationError(`Skapa en lönekörning med ${s.name} först – provisionen läggs på lönespecen`);
      await updatePayslip(actor, slip.run_id, slip.id, { items: [...slip.items, { type: 'salary', description: `Provision ${r.period}`, amount: r.total }] });
      await sql`UPDATE commission_runs SET payslip_id = ${slip.id} WHERE id = ${runId}`;
    } else {
      await sql`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${AGENT_COMMISSION_ACCOUNT}, 'Provisioner till agenter') ON CONFLICT DO NOTHING`;
      const vat = selfInvoiceVat(r.total, s.agent_vat);
      const si = await registerSupplierInvoice(actor, {
        supplier_id: s.supplier_id, invoice_number: `SF-${r.period}-${s.id}`, invoice_date: today(), total: r.total + vat, vat,
        description: `Självfaktura: provision ${r.period} enligt avtal om självfakturering`, lines: [{ account: AGENT_COMMISSION_ACCOUNT, amount: r.total, description: `Provision ${r.period}` }],
      });
      await sql`UPDATE commission_runs SET supplier_invoice_id = ${(si as { id: number }).id} WHERE id = ${runId}`;
    }
  } catch (e) {
    await sql`UPDATE commission_runs SET status = 'calculated', transferred_at = NULL WHERE id = ${runId}`;
    throw e;
  }
  await auditBy(sql, actor, 'transfer', 'commission_run', runId, { total: r.total });
}

export async function overview(companyId: number, period: string) {
  const sellers = await sql<{ id: number; name: string; kind: string; base_rate: number; target: number | null; target_bonus: number | null; employee_id: number | null; supplier_id: number | null }[]>`
    SELECT id, name, kind, base_rate::float8 AS base_rate, target::float8 AS target, target_bonus::float8 AS target_bonus, employee_id, supplier_id FROM commission_sellers WHERE company_id = ${companyId} ORDER BY name`;
  const rules = await sql<{ id: number; seller: string | null; scope: string; customer: string | null; account: number | null; rate_pct: number }[]>`
    SELECT r.id, s.name AS seller, r.scope, c.name AS customer, r.account, r.rate_pct::float8 AS rate_pct FROM commission_rules r LEFT JOIN commission_sellers s ON s.id = r.seller_id LEFT JOIN customers c ON c.id = r.customer_id
    WHERE r.company_id = ${companyId} ORDER BY r.id`;
  const tiers = await sql<{ seller_id: number; threshold: number; rate_pct: number }[]>`SELECT t.seller_id, t.threshold::float8 AS threshold, t.rate_pct::float8 AS rate_pct FROM commission_tiers t JOIN commission_sellers s ON s.id = t.seller_id WHERE s.company_id = ${companyId} ORDER BY t.threshold`;
  const runs = await sql<{ id: number; seller_id: number; total: number; status: string; payslip_id: number | null; supplier_invoice_id: number | null }[]>`
    SELECT id, seller_id, total::float8 AS total, status, payslip_id, supplier_invoice_id FROM commission_runs WHERE company_id = ${companyId} AND period = ${period}`;
  const customers = await sql<{ id: number; name: string; seller_id: number | null }[]>`SELECT id, name, seller_id FROM customers WHERE company_id = ${companyId} ORDER BY name`;
  return { sellers, rules, tiers, runs, customers, calc: await calculate(companyId, period) };
}
