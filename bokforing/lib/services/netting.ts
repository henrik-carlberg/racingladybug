import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { today } from '@/lib/format';
import { offsetLines, pairs, type Open } from '@/lib/netting';
import type { Actor } from './actor';
import { date, str } from './input';

const norm = (o: string) => o.replace(/\D/g, '');

/** Öppna fakturor utan ROT/RUT, factoring eller pågående bankbetalning (svenska kronor, bokförda enligt faktureringsmetoden) per motpart; leverantörsfakturor måste vara attesterade */
async function open(db: Tx | typeof sql, companyId: number, orgnr?: string, lock = false) {
  const recv = await db<(Open & { orgnr: string; name: string; number: number })[]>`SELECT i.id, (i.total - i.paid_amount)::float8 AS remaining, to_char(i.due_date,'YYYY-MM-DD') AS due, c.orgnr, c.name, i.invoice_number AS number
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.company_id = ${companyId} AND i.status = 'booked' AND i.voucher_id IS NOT NULL AND i.currency = 'SEK' AND i.total > i.paid_amount
      AND COALESCE(i.tax_reduction, 0) = 0 AND NOT EXISTS (SELECT 1 FROM factoring_deals f WHERE f.invoice_id = i.id AND f.status IN ('offered','accepted','funded'))
      AND regexp_replace(c.orgnr, '\\D', '', 'g') <> '' ${orgnr ? db`AND regexp_replace(c.orgnr, '\\D', '', 'g') = ${orgnr}` : db``} ${lock ? db`FOR UPDATE OF i` : db``}`;
  const pay = await db<(Open & { orgnr: string; name: string; number: string })[]>`SELECT i.id, (i.total - i.paid_amount)::float8 AS remaining, to_char(i.due_date,'YYYY-MM-DD') AS due, s.orgnr, s.name, i.invoice_number AS number
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.company_id = ${companyId} AND i.status = 'approved' AND i.voucher_id IS NOT NULL AND i.currency = 'SEK' AND i.total > i.paid_amount
      AND NOT EXISTS (SELECT 1 FROM bank_payment_items bi JOIN bank_payments bp ON bp.id = bi.payment_id WHERE bi.supplier_invoice_id = i.id AND bp.status IN ('authorization','accepted','executed'))
      AND regexp_replace(s.orgnr, '\\D', '', 'g') <> '' ${orgnr ? db`AND regexp_replace(s.orgnr, '\\D', '', 'g') = ${orgnr}` : db``} ${lock ? db`FOR UPDATE OF i` : db``}`;
  return { recv, pay };
}

/** Motparter som har både en öppen kundfaktura och en attesterad leverantörsfaktura */
export async function candidates(companyId: number) {
  const { recv, pay } = await open(sql, companyId);
  const keys = new Set(recv.map((r) => norm(r.orgnr)).filter((k) => pay.some((p) => norm(p.orgnr) === k)));
  const group = new Set((await sql<{ orgnr: string }[]>`SELECT c.orgnr FROM group_links g JOIN companies c ON c.id IN (g.parent_company_id, g.subsidiary_company_id)
    WHERE ${companyId} IN (g.parent_company_id, g.subsidiary_company_id) AND c.id <> ${companyId}`).map((g) => norm(g.orgnr ?? '')));
  return [...keys].map((k) => {
    const r = recv.filter((x) => norm(x.orgnr) === k), p = pay.filter((x) => norm(x.orgnr) === k);
    return { orgnr: k, name: r[0].name, group: group.has(k), receivable: r.reduce((s, x) => s + x.remaining, 0), payable: p.reduce((s, x) => s + x.remaining, 0), ...pairs(r, p) };
  });
}

export async function history(companyId: number) {
  return sql<{ id: number; orgnr: string; date: string; amount: number; voucher_id: number | null }[]>`SELECT id, orgnr, to_char(date,'YYYY-MM-DD') AS date, amount::float8 AS amount, voucher_id FROM offsets WHERE company_id = ${companyId} ORDER BY date DESC, id DESC LIMIT 50`;
}

/** Kvittar öppna fakturor mot motparten i en verifikation och registrerar betalningarna på fakturorna */
export async function offset(actor: Actor, input: Record<string, unknown>) {
  const orgnr = norm(str(input, 'orgnr'));
  if (!orgnr) throw new ValidationError('Välj motpart');
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const { recv, pay } = await open(tx, actor.companyId, orgnr, true);
    const p = pairs(recv, pay);
    if (!p.total) throw new ValidationError('Det finns inget att kvitta mot motparten');
    const v = await createVoucher(tx, { actor, date: d, description: `Kvittning kund- mot leverantörsfakturor, ${recv[0].name}`, lines: fromSigned(offsetLines(p.total)), sourceType: 'offset' });
    for (const x of p.pairs) {
      await tx`INSERT INTO invoice_payments (company_id, invoice_id, date, amount, voucher_id) VALUES (${actor.companyId}, ${x.invoiceId}, ${d}, ${x.amount}, ${v.id})`;
      await tx`UPDATE invoices SET paid_amount = paid_amount + ${x.amount}, payment_voucher_id = ${v.id}, status = CASE WHEN paid_amount + ${x.amount} >= total THEN 'paid' ELSE status END,
        paid_date = CASE WHEN paid_amount + ${x.amount} >= total THEN ${d}::date ELSE paid_date END WHERE id = ${x.invoiceId} AND company_id = ${actor.companyId}`;
      await tx`INSERT INTO supplier_invoice_payments (company_id, supplier_invoice_id, date, amount, voucher_id) VALUES (${actor.companyId}, ${x.supplierInvoiceId}, ${d}, ${x.amount}, ${v.id})`;
      await tx`UPDATE supplier_invoices SET paid_amount = paid_amount + ${x.amount}, payment_voucher_id = ${v.id}, status = CASE WHEN paid_amount + ${x.amount} >= total THEN 'paid' ELSE status END,
        paid_date = CASE WHEN paid_amount + ${x.amount} >= total THEN ${d}::date ELSE paid_date END WHERE id = ${x.supplierInvoiceId} AND company_id = ${actor.companyId}`;
    }
    await tx`INSERT INTO offsets ${tx({ company_id: actor.companyId, orgnr, date: d, amount: p.total, pairs: tx.json(p.pairs as never) as never, agreement: str(input, 'agreement', { max: 500 }), voucher_id: v.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'offset', 'company', actor.companyId, { orgnr, amount: p.total });
    return p.total;
  });
}
