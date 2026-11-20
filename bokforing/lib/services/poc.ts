import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { today } from '@/lib/format';
import { parseAmount } from '@/lib/money';
import { adjustmentLines, LOSS_COST, LOSS_PROVISION, position, WIP_ASSET, WIP_LIABILITY, WIP_REVENUE } from '@/lib/poc';
import type { Actor } from './actor';
import { bookInvoice, saveDraftTx } from './invoices';
import { date, int, str } from './input';

const kr = (v: unknown, label: string) => { const n = parseAmount(String(v ?? '')); if (n == null || n <= 0) throw new ValidationError(`Ange ${label} i kronor`); return n; };

export async function createContract(actor: Actor, input: Record<string, unknown>) {
  const projectId = int(input, 'project_id', 'Projekt');
  const [p] = await sql<{ name: string }[]>`SELECT name FROM projects WHERE id = ${projectId} AND company_id = ${actor.companyId}`;
  if (!p) throw new ValidationError('Projektet finns inte');
  const [dup] = await sql`SELECT 1 FROM poc_contracts WHERE company_id = ${actor.companyId} AND project_id = ${projectId}`;
  if (dup) throw new ConflictError('Projektet har redan ett fastprisuppdrag');
  const [r] = await sql<{ id: number }[]>`INSERT INTO poc_contracts ${sql({ company_id: actor.companyId, project_id: projectId, name: str(input, 'name') || p.name,
    value: kr(input.value, 'kontraktsvärdet'), estimated_cost: kr(input.estimated_cost, 'beräknade kostnader') })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'poc_contract', r.id);
  return r.id;
}

export async function updateEstimate(actor: Actor, id: number, input: Record<string, unknown>) {
  const r = await sql`UPDATE poc_contracts SET estimated_cost = ${kr(input.estimated_cost, 'beräknade kostnader')}, status = ${input.done === 'on' ? 'done' : 'open'}
    WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Uppdraget');
  await auditBy(sql, actor, 'estimate', 'poc_contract', id);
}

/** Delfakturering av ett fastprisuppdrag: fakturan märks med projektet så att intäkten räknas mot uppdraget */
export async function invoicePart(actor: Actor, id: number, input: Record<string, unknown>) {
  const [c] = await sql<{ project_id: number; name: string; customer_id: number | null; vat_rate: number; value: number }[]>`
    SELECT c.project_id, c.name, p.customer_id, p.vat_rate, c.value::float8 AS value FROM poc_contracts c JOIN projects p ON p.id = c.project_id WHERE c.id = ${id} AND c.company_id = ${actor.companyId}`;
  if (!c) throw new NotFoundError('Uppdraget');
  if (!c.customer_id) throw new ValidationError('Projektet saknar kund');
  const amount = kr(input.amount, 'beloppet');
  const { adjustedContracts } = await import('./construction');
  const value = c.value + (await adjustedContracts(actor.companyId, today()))(id).value;
  if (amount > value) throw new ValidationError('Delfakturan kan inte vara större än kontraktsvärdet inklusive godkända ÄTA');
  const invId = await sql.begin(async (tx) => {
    const inv = await saveDraftTx(tx, actor, null, { customer_id: c.customer_id, invoice_date: date(input, 'invoice_date', 'Fakturadatum', false) || today(),
      lines: [{ description: str(input, 'description') || `Delfakturering ${c.name}`, quantity: 1, unit: 'st', unit_price: amount, vat_rate: c.vat_rate }] });
    await tx`UPDATE invoices SET project_id = ${c.project_id} WHERE id = ${inv.id}`;
    return inv.id;
  });
  await bookInvoice(actor, invId);
  return invId;
}

/** Uppdragens ställning per ett datum: nedlagda kostnader och fakturerat på projektet, upparbetat och det som redan är bokfört */
export async function positions(companyId: number, at: string) {
  const cs = await sql<{ id: number; project_id: number; name: string; value: number; estimated_cost: number; status: string; cost: number; invoiced: number; booked_wip: number | null; booked_loss: number | null; last: string | null }[]>`
    SELECT c.id, c.project_id, c.name, c.value::float8 AS value, c.estimated_cost::float8 AS estimated_cost, c.status,
      COALESCE((SELECT SUM(l.debit - l.credit) FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND l.project_id = c.project_id
        AND l.account_number BETWEEN 4000 AND 7999 AND l.account_number <> ${LOSS_COST} AND v.date <= ${at}), 0)::float8 AS cost,
      COALESCE((SELECT SUM(l.credit - l.debit) FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND l.project_id = c.project_id
        AND l.account_number BETWEEN 3000 AND 3799 AND l.account_number <> ${WIP_REVENUE} AND v.date <= ${at}), 0)::float8 AS invoiced,
      (SELECT p.wip FROM poc_postings p WHERE p.contract_id = c.id AND p.date <= ${at} AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = p.voucher_id) ORDER BY p.date DESC, p.id DESC LIMIT 1)::float8 AS booked_wip,
      (SELECT p.loss_provision FROM poc_postings p WHERE p.contract_id = c.id AND p.date <= ${at} AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = p.voucher_id) ORDER BY p.date DESC, p.id DESC LIMIT 1)::float8 AS booked_loss,
      (SELECT to_char(MAX(p.date),'YYYY-MM-DD') FROM poc_postings p WHERE p.contract_id = c.id AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = p.voucher_id)) AS last
    FROM poc_contracts c WHERE c.company_id = ${companyId} ORDER BY c.id`;
  const { adjustedContracts } = await import('./construction');
  const ata = await adjustedContracts(companyId, at);
  return cs.map((c0) => {
    // Godkända ÄTA-arbeten ändrar kontraktsvärdet och den beräknade kostnaden
    const e = ata(c0.id);
    const c = { ...c0, base_value: c0.value, value: c0.value + e.value, estimated_cost: Math.max(1, c0.estimated_cost + e.cost), ata_value: e.value, ata_pending: e.pending, ata_pending_count: e.pendingCount };
    const done = c.status === 'done';
    // Avslutat uppdrag: allt är fakturerat och upparbetat – tidigare justeringar förs tillbaka
    const pos = done ? { grade: 1, earned: c.invoiced, wip: 0, expectedLoss: 0, lossProvision: 0, margin: c.invoiced - c.cost }
      : position({ value: c.value, estimatedCost: c.estimated_cost }, { cost: c.cost, invoiced: c.invoiced });
    const booked = { wip: c.booked_wip ?? 0, lossProvision: c.booked_loss ?? 0 };
    return { ...c, ...pos, booked, lines: adjustmentLines(pos, booked) };
  });
}

/** Bokför bokslutsjusteringen per datumet för alla uppdrag (en verifikation) */
export async function book(actor: Actor, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Bokslutsdag', false) || today();
  return sql.begin(async (tx) => {
    // En bokning åt gången per bolag, och aldrig före en tidigare bokning (annars blir utgångsläget fel)
    await tx`SELECT pg_advisory_xact_lock(86001, ${actor.companyId})`;
    const [mx] = await tx<{ last: string | null }[]>`SELECT to_char(MAX(p.date),'YYYY-MM-DD') AS last FROM poc_postings p JOIN poc_contracts c ON c.id = p.contract_id
      WHERE c.company_id = ${actor.companyId} AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = p.voucher_id)`;
    if (mx.last && d < mx.last) throw new ValidationError(`Det finns redan en bokning per ${mx.last} – välj samma eller ett senare datum`);
    const ps = await positions(actor.companyId, d);
    const lines = ps.flatMap((p) => p.lines.map((l) => ({ ...l, projectId: p.project_id })));
    if (!lines.length) throw new ValidationError('Det finns inga förändringar att bokföra');
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${WIP_ASSET}, 'Upparbetad men ej fakturerad intäkt'), (${actor.companyId}, ${WIP_LIABILITY}, 'Fakturerad men ej upparbetad intäkt'),
      (${actor.companyId}, ${WIP_REVENUE}, 'Förändring av upparbetade intäkter (successiv vinstavräkning)'), (${actor.companyId}, ${LOSS_COST}, 'Befarad förlust på pågående uppdrag'),
      (${actor.companyId}, ${LOSS_PROVISION}, 'Avsättning för befarade förluster') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: `Successiv vinstavräkning per ${d}`, lines: fromSigned(lines), sourceType: 'poc' });
    for (const p of ps) if (p.lines.length) await tx`INSERT INTO poc_postings (contract_id, date, wip, loss_provision, voucher_id) VALUES (${p.id}, ${d}, ${p.wip}, ${p.lossProvision}, ${v.id})`;
    await auditBy(tx, actor, 'book', 'poc', actor.companyId, { date: d });
    return v;
  });
}

/** Not i årsredovisningen: pågående uppdrag per balansdagen */
export async function pocNote(companyId: number, at: string) {
  const ps = (await positions(companyId, at)).filter((p) => p.status === 'open');
  if (!ps.length) return null;
  return { earned: ps.reduce((s, p) => s + p.earned, 0), invoiced: ps.reduce((s, p) => s + p.invoiced, 0), asset: ps.reduce((s, p) => s + Math.max(0, p.wip), 0), liability: ps.reduce((s, p) => s + Math.max(0, -p.wip), 0), loss: ps.reduce((s, p) => s + p.lossProvision, 0) };
}
