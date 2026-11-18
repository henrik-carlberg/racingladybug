import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { loadLines } from '@/lib/server/invoices';
import { computeInvoice, lineNet } from '@/lib/invoice';
import { labourInclVat, REDUCTION, REDUCTION_ACCOUNT, type ReductionType } from '@/lib/rotrut';
import { today } from '@/lib/format';
import type { Actor } from './actor';
import { saveDraftTx } from './invoices';
import { date, int, optInt } from './input';

export interface ReductionRow {
  id: number; number: number; customer: string; type: ReductionType; status: string; invoice_date: string; paid_date: string | null;
  buyer_pnr: string; property: string; brf_orgnr: string; apartment_no: string; work_type: string;
  tax_reduction: number; customer_paid: number; labour: number; material: number; hours: number;
  requested_on: string | null; reduction_paid: number | null; decided_on: string | null; rest_invoice_id: number | null; deadline: string | null;
}

/** ROT/RUT-fakturor med de uppgifter som e-tjänsten "Rot och rut – företag" frågar efter */
export async function listReductions(companyId: number, f: { status?: string[] } = {}): Promise<ReductionRow[]> {
  const rows = await sql<(Omit<ReductionRow, 'labour' | 'material' | 'hours' | 'deadline'> & { reverse_charge: boolean })[]>`
    SELECT i.id, i.invoice_number AS number, c.name AS customer, i.reduction_type AS type, i.reduction_status AS status,
      to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date, to_char(i.paid_date,'YYYY-MM-DD') AS paid_date, i.buyer_pnr, i.property, i.brf_orgnr, i.apartment_no, i.work_type,
      i.tax_reduction, i.total AS customer_paid, to_char(i.reduction_requested_on,'YYYY-MM-DD') AS requested_on, i.reduction_paid,
      to_char(i.reduction_decided_on,'YYYY-MM-DD') AS decided_on, i.reduction_rest_invoice_id AS rest_invoice_id, i.reverse_charge
    FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.company_id = ${companyId} AND i.reduction_status IS NOT NULL ${f.status ? sql`AND i.reduction_status IN ${sql(f.status)}` : sql``}
    ORDER BY i.paid_date DESC NULLS LAST, i.invoice_number DESC`;
  const out: ReductionRow[] = [];
  for (const r of rows) {
    const lines = await loadLines(sql, r.id);
    const t = computeInvoice(lines, { reverseCharge: r.reverse_charge });
    const labour = labourInclVat(lines, t, r.reverse_charge);
    const hours = lines.filter((l) => l.labor && ['h', 'tim', 'timmar', 'timme'].includes(l.unit.toLowerCase())).reduce((s, l) => s + l.quantity, 0);
    const material = lines.reduce((s, l, i) => s + (l.labor ? 0 : lineNet(l) + Math.round((t.lineNets[i] * l.vatRate) / 100)), 0);
    out.push({ ...r, labour, material, hours, deadline: r.paid_date ? `${Number(r.paid_date.slice(0, 4)) + 1}-01-31` : null });
  }
  return out;
}

/** Markerar fakturor som begärda hos Skatteverket */
export async function markRequested(actor: Actor, ids: number[], on: string) {
  if (!ids.length) throw new ValidationError('Välj minst en faktura');
  const r = await sql`UPDATE invoices SET reduction_status = 'requested', reduction_requested_on = ${on}
    WHERE company_id = ${actor.companyId} AND id IN ${sql(ids)} AND reduction_status = 'to_request'`;
  await auditBy(sql, actor, 'request_tax_reduction', 'company', actor.companyId, { invoices: ids, date: on });
  return r.count;
}

export async function undoRequested(actor: Actor, id: number) {
  const r = await sql`UPDATE invoices SET reduction_status = 'to_request', reduction_requested_on = NULL WHERE id = ${id} AND company_id = ${actor.companyId} AND reduction_status = 'requested'`;
  if (!r.count) throw new NotFoundError('Begäran');
}

/**
 * Skatteverkets beslut: utbetalt belopp bokförs mot skattekontot (eller bank) och fordran 1513 nollas.
 * Beviljas mindre än begärt får kunden en faktura på mellanskillnaden (utan moms, mot 1513).
 */
export async function registerDecision(actor: Actor, id: number, input: Record<string, unknown>) {
  const paid = optInt(input, 'amount', 'Utbetalt belopp') ?? 0;
  const d = date(input, 'date', 'Beslutsdatum');
  const account = optInt(input, 'account', 'Konto') ?? 1630;
  if (paid < 0) throw new ValidationError('Beloppet kan inte vara negativt');
  if (![1630, 1930, 1940].includes(account) && !(account >= 1900 && account <= 1999)) throw new ValidationError('Välj skattekontot (1630) eller ett bankkonto');
  return sql.begin(async (tx) => {
    const [inv] = await tx<{ number: number; customer_id: number; tax_reduction: number; status: string; type: ReductionType; customer: string }[]>`
      SELECT i.invoice_number AS number, i.customer_id, i.tax_reduction, i.reduction_status AS status, i.reduction_type AS type, c.name AS customer
      FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${id} AND i.company_id = ${actor.companyId} FOR UPDATE OF i`;
    if (!inv) throw new NotFoundError('Fakturan');
    if (inv.status !== 'requested') throw new ConflictError('Markera först att avdraget är begärt');
    if (paid > inv.tax_reduction) throw new ValidationError('Utbetalningen kan inte vara större än det begärda beloppet');
    const label = REDUCTION[inv.type].label;
    const v = paid > 0 ? await createVoucher(tx, {
      actor, date: d, description: `${label} faktura ${inv.number}, ${inv.customer} – utbetalning från Skatteverket`,
      lines: fromSigned([{ account, amount: paid }, { account: REDUCTION_ACCOUNT, amount: -paid }]), sourceType: 'tax_reduction', sourceId: id,
    }) : null;
    const rest = inv.tax_reduction - paid;
    let restId: number | null = null;
    if (rest > 0) {
      const draft = await saveDraftTx(tx, actor, null, {
        customer_id: inv.customer_id, invoice_date: today(),
        notes: `Skatteverket beviljade ${(paid / 100).toLocaleString('sv-SE')} kr av begärda ${(inv.tax_reduction / 100).toLocaleString('sv-SE')} kr i ${label.toLowerCase()} för faktura ${inv.number}. Mellanskillnaden betalas av dig som köpare.`,
        lines: [{ description: `Ej beviljat ${label.toLowerCase()}, faktura ${inv.number}`, quantity: 1, unit: 'st', unit_price: rest, vat_rate: 0, account: REDUCTION_ACCOUNT }],
      });
      restId = draft.id;
    }
    await tx`UPDATE invoices SET reduction_status = ${paid === inv.tax_reduction ? 'paid' : paid === 0 ? 'rejected' : 'partly_paid'}, reduction_paid = ${paid},
      reduction_decided_on = ${d}, reduction_voucher_id = ${v?.id ?? null}, reduction_rest_invoice_id = ${restId} WHERE id = ${id}`;
    await auditBy(tx, actor, 'tax_reduction_decision', 'invoice', id, { paid, rest, rest_invoice: restId });
    return { paid, rest, restInvoiceId: restId };
  });
}

/** Summa ROT/RUT per köpare och år (för att hålla koll på taket 50 000 / 75 000 kr) */
export async function buyerTotals(companyId: number, year: string) {
  return sql<{ buyer_pnr: string; customer: string; rot: number; rut: number }[]>`
    SELECT i.buyer_pnr, max(c.name) AS customer,
      COALESCE(SUM(COALESCE(i.reduction_paid, i.tax_reduction)) FILTER (WHERE i.reduction_type = 'rot'), 0)::bigint AS rot,
      COALESCE(SUM(COALESCE(i.reduction_paid, i.tax_reduction)) FILTER (WHERE i.reduction_type = 'rut'), 0)::bigint AS rut
    FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.company_id = ${companyId} AND i.reduction_type IS NOT NULL AND i.status IN ('booked','paid') AND i.credit_of_id IS NULL AND to_char(i.invoice_date,'YYYY') = ${year}
    GROUP BY i.buyer_pnr ORDER BY 2`;
}

export const parseIds = (v: unknown) => (Array.isArray(v) ? v : [v]).map((x) => int({ x }, 'x', 'Faktura'));
