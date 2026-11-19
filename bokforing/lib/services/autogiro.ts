import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { bankDay, drawFile, mandateFile, parseResultFile } from '@/lib/autogiro';
import { addDays, today } from '@/lib/format';
import { normalizeOrgNumber, normalizePersonalNumber } from '@/lib/validate';
import type { Actor } from './actor';
import { registerPayment } from './invoices';

async function company(companyId: number) {
  const [c] = await sql<{ bankgiro: string; customer_no: string }[]>`SELECT bankgiro, autogiro_customer_no AS customer_no FROM companies WHERE id = ${companyId}`;
  if (!c.bankgiro) throw new ValidationError('Lägg in bolagets bankgironummer under Inställningar först');
  if (!/^\d{6}$/.test(c.customer_no)) throw new ValidationError('Ange kundnumret för Autogiro (sex siffror från Bankgirot) först');
  return { bankgiro: c.bankgiro, customerNo: c.customer_no };
}

export async function saveSettings(actor: Actor, customerNo: string) {
  const v = customerNo.replace(/\D/g, '');
  if (v && v.length !== 6) throw new ValidationError('Kundnumret för Autogiro har sex siffror');
  await sql`UPDATE companies SET autogiro_customer_no = ${v} WHERE id = ${actor.companyId}`;
}

export async function listMandates(companyId: number) {
  return [...await sql<{ id: number; customer_id: number; customer: string; payer_number: string; clearing: string; account: string; id_number: string; status: string; created_at: string }[]>`
    SELECT m.id, m.customer_id, c.name AS customer, m.payer_number, m.clearing, m.account, m.id_number, m.status, to_char(m.created_at,'YYYY-MM-DD') AS created_at
    FROM ag_mandates m JOIN customers c ON c.id = m.customer_id WHERE m.company_id = ${companyId} ORDER BY m.status = 'cancelled', c.name`];
}

export async function addMandate(actor: Actor, input: { customer_id: number; payer_number?: string; clearing: string; account: string; id_number: string }) {
  const [c] = await sql<{ id: number }[]>`SELECT id FROM customers WHERE id = ${input.customer_id} AND company_id = ${actor.companyId}`;
  if (!c) throw new NotFoundError('Kunden');
  const clearing = input.clearing.replace(/\D/g, ''), account = input.account.replace(/\D/g, '');
  if (!/^\d{4,5}$/.test(clearing)) throw new ValidationError('Clearingnumret har fyra siffror (Swedbank ibland fem)');
  if (!/^\d{5,12}$/.test(account)) throw new ValidationError('Kontonumret ska vara 5–12 siffror');
  const id = normalizePersonalNumber(input.id_number) ?? normalizeOrgNumber(input.id_number);
  if (!id) throw new ValidationError('Ange betalarens personnummer eller organisationsnummer');
  const payer = (input.payer_number || String(input.customer_id)).replace(/\D/g, '');
  if (!payer || payer.length > 16) throw new ValidationError('Betalarnumret ska vara 1–16 siffror');
  try {
    const [m] = await sql<{ id: number }[]>`INSERT INTO ag_mandates (company_id, customer_id, payer_number, clearing, account, id_number)
      VALUES (${actor.companyId}, ${c.id}, ${payer}, ${clearing.slice(-4)}, ${account}, ${id.replace(/\D/g, '')}) RETURNING id`;
    await auditBy(sql, actor, 'create', 'ag_mandate', m.id);
    return m.id;
  } catch (e) {
    if (String((e as Error).message).includes('ag_mandates_company_id_payer_number_key')) throw new ConflictError('Betalarnumret används redan');
    throw e;
  }
}

/** Skapar fil med nya medgivanden (och makuleringar) att skicka till Bankgirot */
export async function createMandateFile(actor: Actor) {
  const c = await company(actor.companyId);
  const fresh = await sql<{ id: number; payer_number: string; clearing: string; account: string; id_number: string }[]>`SELECT id, payer_number, clearing, account, id_number FROM ag_mandates WHERE company_id = ${actor.companyId} AND status = 'new'`;
  if (!fresh.length) throw new ConflictError('Det finns inga nya medgivanden');
  const content = mandateFile(c, today(), fresh.map((m) => ({ payerNumber: m.payer_number, clearing: m.clearing, account: m.account, idNumber: m.id_number })));
  return sql.begin(async (tx) => {
    const [f] = await tx<{ id: number }[]>`INSERT INTO ag_files (company_id, kind, content, created_by) VALUES (${actor.companyId}, 'mandates', ${content}, ${actor.userId}) RETURNING id`;
    await tx`UPDATE ag_mandates SET status = 'sent' WHERE id IN ${tx(fresh.map((m) => m.id))}`;
    await auditBy(tx, actor, 'create', 'ag_file', f.id, { mandates: fresh.length });
    return f.id;
  });
}

export async function setMandateStatus(actor: Actor, id: number, status: 'active' | 'cancelled') {
  const r = await sql`UPDATE ag_mandates SET status = ${status} WHERE id = ${id} AND company_id = ${actor.companyId} AND status <> 'cancelled'`;
  if (!r.count) throw new NotFoundError('Medgivandet');
  if (status === 'cancelled') {
    const c = await company(actor.companyId);
    const [m] = await sql<{ payer_number: string }[]>`SELECT payer_number FROM ag_mandates WHERE id = ${id}`;
    await sql`INSERT INTO ag_files (company_id, kind, content, created_by) VALUES (${actor.companyId}, 'mandates', ${mandateFile(c, today(), [], [m.payer_number])}, ${actor.userId})`;
  }
  await auditBy(sql, actor, status === 'active' ? 'activate' : 'cancel', 'ag_mandate', id);
}

/** Obetalda fakturor till kunder med aktivt medgivande som inte redan ska dras */
export async function drawable(companyId: number) {
  return [...await sql<{ id: number; number: number; customer: string; due: string; remaining: number; ocr: string | null; mandate_id: number }[]>`
    SELECT i.id, i.invoice_number AS number, c.name AS customer, to_char(i.due_date,'YYYY-MM-DD') AS due, (i.total - i.paid_amount)::bigint AS remaining, i.ocr, m.id AS mandate_id
    FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN ag_mandates m ON m.customer_id = i.customer_id AND m.company_id = i.company_id AND m.status = 'active'
    WHERE i.company_id = ${companyId} AND i.status = 'booked' AND i.currency = 'SEK' AND i.total > i.paid_amount
      AND NOT EXISTS (SELECT 1 FROM ag_draws d WHERE d.invoice_id = i.id AND d.status IN ('scheduled','paid'))
    ORDER BY i.due_date`].map((r) => ({ ...r, remaining: Number(r.remaining) }));
}

/** Dragningsfil för valda fakturor; dras på förfallodagen (tidigast nästa bankdag) */
export async function createDrawFile(actor: Actor, invoiceIds: number[]) {
  const c = await company(actor.companyId);
  const all = await drawable(actor.companyId);
  const pick = all.filter((x) => invoiceIds.includes(x.id));
  if (!pick.length) throw new ConflictError('Välj minst en faktura');
  const earliest = bankDay(addDays(today(), 1));
  const draws = await Promise.all(pick.map(async (x) => {
    const [m] = await sql<{ payer_number: string }[]>`SELECT payer_number FROM ag_mandates WHERE id = ${x.mandate_id}`;
    return { inv: x, date: bankDay(x.due > earliest ? x.due : earliest), payerNumber: m.payer_number, amount: x.remaining, reference: x.ocr || String(x.number) };
  }));
  const content = drawFile(c, today(), draws);
  return sql.begin(async (tx) => {
    const [f] = await tx<{ id: number }[]>`INSERT INTO ag_files (company_id, kind, content, created_by) VALUES (${actor.companyId}, 'draws', ${content}, ${actor.userId}) RETURNING id`;
    for (const d of draws) await tx`INSERT INTO ag_draws (company_id, invoice_id, mandate_id, file_id, date, amount, reference) VALUES (${actor.companyId}, ${d.inv.id}, ${d.inv.mandate_id}, ${f.id}, ${d.date}, ${d.amount}, ${d.reference})`;
    await auditBy(tx, actor, 'create', 'ag_file', f.id, { draws: draws.length });
    return f.id;
  });
}

/** Läser in Bankgirots återrapport: genomförda dragningar bokförs som betalning, misslyckade markeras */
export async function importResult(actor: Actor, text: string) {
  const rows = parseResultFile(text);
  if (!rows.length) throw new ValidationError('Filen innehåller inga dragningar (TK82)');
  let paid = 0, failed = 0, unknown = 0;
  for (const r of rows) {
    const [d] = await sql<{ id: number; invoice_id: number }[]>`
      SELECT d.id, d.invoice_id FROM ag_draws d JOIN ag_mandates m ON m.id = d.mandate_id
      WHERE d.company_id = ${actor.companyId} AND d.status = 'scheduled' AND d.reference = ${r.reference} AND d.amount = ${r.amount} AND ltrim(m.payer_number, '0') = ${r.payerNumber} LIMIT 1`;
    if (!d) { unknown++; continue; }
    if (r.ok) {
      await registerPayment(actor, d.invoice_id, { date: r.date, amount: r.amount, bank_account: 1930 });
      await sql`UPDATE ag_draws SET status = 'paid', message = ${r.status} WHERE id = ${d.id}`;
      paid++;
    } else {
      await sql`UPDATE ag_draws SET status = 'failed', message = ${r.status} WHERE id = ${d.id}`;
      failed++;
    }
  }
  await auditBy(sql, actor, 'import', 'ag_result', 0, { paid, failed, unknown });
  return { paid, failed, unknown };
}

export async function listFiles(companyId: number) {
  return [...await sql<{ id: number; kind: string; created_at: string; lines: number }[]>`
    SELECT id, kind, to_char(created_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS created_at, (length(content) - length(replace(content, E'\\n', '')) - 1)::int AS lines
    FROM ag_files WHERE company_id = ${companyId} ORDER BY id DESC LIMIT 30`];
}
export async function fileContent(companyId: number, id: number) {
  const [f] = await sql<{ content: string; kind: string }[]>`SELECT content, kind FROM ag_files WHERE id = ${id} AND company_id = ${companyId}`;
  return f ?? null;
}
export async function listDraws(companyId: number) {
  return [...await sql<{ id: number; invoice_id: number; number: number; customer: string; date: string; amount: number; status: string; message: string }[]>`
    SELECT d.id, d.invoice_id, i.invoice_number AS number, c.name AS customer, to_char(d.date,'YYYY-MM-DD') AS date, d.amount, d.status, d.message
    FROM ag_draws d JOIN invoices i ON i.id = d.invoice_id JOIN customers c ON c.id = i.customer_id WHERE d.company_id = ${companyId} ORDER BY d.id DESC LIMIT 100`].map((r) => ({ ...r, amount: Number(r.amount) }));
}
