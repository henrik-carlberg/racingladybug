import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { CAUSES, fromProvision, inWarranty, lineTotal, provisionUseLines, warrantyRate, warrantyUntil } from '@/lib/service-cases';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';
import { saveDraftTx } from './invoices';

type Db = Tx | typeof sql;
async function warrantyProvisions(db: Db, companyId: number) {
  return db<{ id: number; description: string; account: number; cost_account: number; balance: number }[]>`SELECT p.id, p.description, p.account, p.cost_account,
      COALESCE((SELECT SUM(CASE WHEN m.kind = 'set' THEN m.amount ELSE -m.amount END) FROM provision_movements m WHERE m.provision_id = p.id), 0)::float8 AS balance
    FROM provisions p WHERE p.company_id = ${companyId} AND p.kind = 'warranty' ORDER BY p.id`;
}

export async function overview(companyId: number) {
  const t = today();
  const cases = await sql<{ id: number; customer: string; customer_id: number; invoice_number: number | null; item: string; serial: string; sold_on: string | null; warranty_months: number; opened_on: string; fault: string; cause: string; in_warranty: boolean; status: string; closed_on: string | null; invoice_out_id: number | null; cost_total: number }[]>`
    SELECT s.id, c.name AS customer, s.customer_id, i.invoice_number, s.item, s.serial, to_char(s.sold_on,'YYYY-MM-DD') AS sold_on, s.warranty_months, to_char(s.opened_on,'YYYY-MM-DD') AS opened_on, s.fault, s.cause, s.in_warranty, s.status,
      to_char(s.closed_on,'YYYY-MM-DD') AS closed_on, s.invoice_out_id, s.cost_total::float8 AS cost_total
    FROM service_cases s JOIN customers c ON c.id = s.customer_id LEFT JOIN invoices i ON i.id = s.invoice_id WHERE s.company_id = ${companyId} ORDER BY s.status = 'open' DESC, s.opened_on DESC, s.id DESC LIMIT 300`;
  const lines = cases.length ? await sql<{ id: number; case_id: number; kind: string; description: string; quantity: number; unit_price: number }[]>`SELECT id, case_id, kind, description, quantity::float8 AS quantity, unit_price::float8 AS unit_price
    FROM service_case_lines WHERE case_id IN ${sql(cases.map((c) => c.id))} ORDER BY id` : [];
  const invoices = await sql<{ id: number; customer_id: number; number: number; date: string }[]>`SELECT id, customer_id, invoice_number AS number, to_char(invoice_date,'YYYY-MM-DD') AS date FROM invoices
    WHERE company_id = ${companyId} AND status IN ('booked','paid') AND credit_of_id IS NULL ORDER BY invoice_date DESC LIMIT 300`;
  const customers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name LIMIT 500`;
  // Garantikostnad och försäljning de senaste tolv månaderna för förslaget till garantiavsättning
  const [{ costs }] = await sql<{ costs: number }[]>`SELECT COALESCE(SUM(cost_total), 0)::float8 AS costs FROM service_cases WHERE company_id = ${companyId} AND in_warranty AND status = 'closed' AND closed_on > ${t}::date - 365`;
  const [{ sales }] = await sql<{ sales: number }[]>`SELECT COALESCE(SUM(total_net), 0)::float8 AS sales FROM invoices WHERE company_id = ${companyId} AND status IN ('booked','paid','credited') AND invoice_date > ${t}::date - 365 AND total_net > 0`;
  const byItem = new Map<string, { item: string; cases: number; warranty: number; cost: number; causes: Record<string, number> }>();
  for (const c of cases) {
    const b = byItem.get(c.item) ?? { item: c.item, cases: 0, warranty: 0, cost: 0, causes: {} };
    b.cases++; if (c.in_warranty) { b.warranty++; b.cost += c.cost_total; } b.causes[c.cause] = (b.causes[c.cause] ?? 0) + 1;
    byItem.set(c.item, b);
  }
  return {
    customers, invoices, provisions: await warrantyProvisions(sql, companyId), costs, sales, rate: warrantyRate(costs, sales),
    cases: cases.map((c) => ({ ...c, until: warrantyUntil(c.sold_on, c.warranty_months), lines: lines.filter((l) => l.case_id === c.id), open: lines.filter((l) => l.case_id === c.id).reduce((s, l) => s + lineTotal(l), 0) })),
    items: [...byItem.values()].sort((a, b) => b.cases - a.cases).map((b) => ({ ...b, top: Object.entries(b.causes).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'other' })),
  };
}

/** Nytt ärende: garantin avgörs av fakturadatum och garantitid */
export async function open(actor: Actor, input: Record<string, unknown>) {
  const customerId = int(input, 'customer_id', 'Kund');
  const [c] = await sql`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  if (!c) throw new NotFoundError('Kunden');
  const invoiceId = optInt(input, 'invoice_id', 'Faktura');
  let soldOn: string | null = null;
  if (invoiceId) {
    const [i] = await sql<{ date: string; customer_id: number }[]>`SELECT to_char(invoice_date,'YYYY-MM-DD') AS date, customer_id FROM invoices WHERE id = ${invoiceId} AND company_id = ${actor.companyId}`;
    if (!i) throw new NotFoundError('Fakturan');
    if (i.customer_id !== customerId) throw new ValidationError('Fakturan är ställd till en annan kund');
    soldOn = i.date;
  }
  const months = Number(input.warranty_months ?? 12);
  if (!Number.isInteger(months) || months < 0 || months > 120) throw new ValidationError('Ogiltig garantitid');
  const d = date(input, 'opened_on', 'Datum', false) || today();
  const cause = Object.prototype.hasOwnProperty.call(CAUSES, String(input.cause)) ? String(input.cause) : 'other';
  const [r] = await sql<{ id: number }[]>`INSERT INTO service_cases ${sql({ company_id: actor.companyId, customer_id: customerId, invoice_id: invoiceId, item: str(input, 'item', { required: true, label: 'Vara', max: 200 }),
    serial: str(input, 'serial', { max: 100 }), sold_on: soldOn, warranty_months: months, opened_on: d, fault: str(input, 'fault', { required: true, label: 'Fel', max: 1000 }), cause,
    in_warranty: inWarranty(soldOn, months, d), created_by: actor.userId })} RETURNING id`;
  return { id: r.id, inWarranty: inWarranty(soldOn, months, d) };
}

export async function addLine(actor: Actor, caseId: number, input: Record<string, unknown>) {
  const [c] = await sql<{ status: string }[]>`SELECT status FROM service_cases WHERE id = ${caseId} AND company_id = ${actor.companyId}`;
  if (!c) throw new NotFoundError('Ärendet');
  if (c.status !== 'open') throw new ConflictError('Ärendet är avslutat');
  const q = Number(String(input.quantity ?? '1').replace(',', '.') || '1');
  if (!Number.isFinite(q) || q <= 0) throw new ValidationError('Ogiltigt antal');
  const price = parseAmount(String(input.unit_price ?? '').trim());
  if (price == null || price < 0) throw new ValidationError('Ange à-pris exkl. moms');
  await sql`INSERT INTO service_case_lines ${sql({ case_id: caseId, kind: input.kind === 'material' ? 'material' : 'labor', description: str(input, 'description', { required: true, label: 'Beskrivning', max: 200 }), quantity: q, unit_price: price })}`;
}

/**
 * Ärendet avslutas. Inom garantin tas kostnaden i anspråk ur garantiavsättningen (högst det som finns kvar);
 * utanför garantin blir arbete och material ett fakturautkast till kunden.
 */
export async function close(actor: Actor, caseId: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const [c] = await tx<{ status: string; in_warranty: boolean; customer_id: number; item: string; serial: string }[]>`SELECT status, in_warranty, customer_id, item, serial FROM service_cases WHERE id = ${caseId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!c) throw new NotFoundError('Ärendet');
    if (c.status !== 'open') throw new ConflictError('Ärendet är redan avslutat');
    const lines = await tx<{ kind: string; description: string; quantity: number; unit_price: number }[]>`SELECT kind, description, quantity::float8 AS quantity, unit_price::float8 AS unit_price FROM service_case_lines WHERE case_id = ${caseId} ORDER BY id`;
    const total = lines.reduce((s, l) => s + lineTotal(l), 0);
    let invoiceId: number | null = null, voucherId: number | null = null, used = 0;
    if (c.in_warranty) {
      const provisionId = optInt(input, 'provision_id', 'Avsättning');
      if (provisionId && total) {
        const p = (await warrantyProvisions(tx, actor.companyId)).find((x) => x.id === provisionId);
        if (!p) throw new NotFoundError('Garantiavsättningen');
        used = fromProvision(total, p.balance);
        if (used) {
          voucherId = (await createVoucher(tx, { actor, date: d, description: `Garantiärende ${caseId}: ${c.item}${c.serial ? ` ${c.serial}` : ''} – ur garantiavsättning`, lines: fromSigned(provisionUseLines(used, p.account, p.cost_account)), sourceType: 'provision', sourceId: provisionId })).id;
          await tx`INSERT INTO provision_movements ${tx({ company_id: actor.companyId, provision_id: provisionId, kind: 'use', date: d, amount: used, voucher_id: voucherId, created_by: actor.userId })}`;
        }
      }
    } else if (lines.length) {
      invoiceId = (await saveDraftTx(tx, actor, null, { customer_id: c.customer_id, invoice_date: d, notes: `Service ${c.item}${c.serial ? `, serienummer ${c.serial}` : ''} (ärende ${caseId}, utanför garantin).`,
        lines: lines.map((l) => ({ description: `${l.kind === 'labor' ? 'Arbete' : 'Material'}: ${l.description}`, quantity: l.quantity, unit: l.kind === 'labor' ? 'tim' : 'st', unit_price: l.unit_price, vat_rate: 25 })) })).id;
    }
    await tx`UPDATE service_cases SET status = 'closed', closed_on = ${d}, cost_total = ${total}, invoice_out_id = ${invoiceId}, provision_voucher_id = ${voucherId} WHERE id = ${caseId}`;
    await auditBy(tx, actor, 'service_case_closed', 'service_case', caseId, { total, used, invoice: invoiceId });
    return { total, used, invoiceId, inWarranty: c.in_warranty };
  });
}
