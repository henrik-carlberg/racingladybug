import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { computeInvoice, type InvoiceLineInput } from '@/lib/invoice';
import { today } from '@/lib/format';
import type { Actor } from '@/lib/services/actor';
import { arr, date, int, optInt, str } from '@/lib/services/input';
import { bookInvoice, saveDraftTx } from '@/lib/services/invoices';
import { INTERVALS, addMonths, invoiceDate, mrr, noticeDeadline, period, renewUntil } from './calc';

type Db = Tx | typeof sql;

export interface ContractLine { description: string; quantity: number; unit: string; unit_price: number; vat_rate: number }
export interface ContractOut {
  id: number; object: 'avtal.contract'; customer_id: number; customer_name: string; name: string; start_date: string; end_date: string | null;
  interval_months: number; interval_label: string; in_advance: boolean; next_period_start: string; next_invoice_date: string; notice_months: number;
  notice_deadline: string | null; auto_renew: boolean; renewal_months: number; auto_book: boolean; status: 'active' | 'paused' | 'ended'; your_reference: string; notes: string;
  lines: ContractLine[]; period_net: number; mrr: number; invoices: { period_start: string; period_end: string; invoice_id: number | null; number: number | null; status: string | null; total: number | null }[];
}

async function load(db: Db, companyId: number, id: number): Promise<ContractOut> {
  const [c] = await db<Omit<ContractOut, 'object' | 'interval_label' | 'next_invoice_date' | 'notice_deadline' | 'lines' | 'period_net' | 'mrr' | 'invoices'>[]>`
    SELECT a.id, a.customer_id, c.name AS customer_name, a.name, to_char(a.start_date,'YYYY-MM-DD') AS start_date, to_char(a.end_date,'YYYY-MM-DD') AS end_date,
      a.interval_months, a.in_advance, to_char(a.next_period_start,'YYYY-MM-DD') AS next_period_start, a.notice_months, a.auto_renew, a.renewal_months, a.auto_book,
      a.status, a.your_reference, a.notes
    FROM avt_contracts a JOIN customers c ON c.id = a.customer_id WHERE a.id = ${id} AND a.company_id = ${companyId}`;
  if (!c) throw new NotFoundError('Avtalet');
  const lines = await db<ContractLine[]>`SELECT description, quantity::float8 AS quantity, unit, unit_price::bigint AS unit_price, vat_rate FROM avt_lines WHERE contract_id = ${id} ORDER BY position`;
  const ls = lines.map((l) => ({ ...l, unit_price: Number(l.unit_price) }));
  const net = ls.length ? computeInvoice(ls.map((l) => ({ ...l, unitPrice: l.unit_price, vatRate: l.vat_rate as InvoiceLineInput['vatRate'], account: 3001 }))).net : 0;
  const invoices = await db<ContractOut['invoices']>`SELECT to_char(x.period_start,'YYYY-MM-DD') AS period_start, to_char(x.period_end,'YYYY-MM-DD') AS period_end, x.invoice_id,
      i.invoice_number AS number, i.status, i.total::bigint AS total
    FROM avt_invoices x LEFT JOIN invoices i ON i.id = x.invoice_id WHERE x.contract_id = ${id} ORDER BY x.period_start DESC`;
  return {
    ...c, object: 'avtal.contract', interval_label: INTERVALS[c.interval_months], next_invoice_date: invoiceDate(c.next_period_start, c.interval_months, c.in_advance),
    notice_deadline: c.end_date ? noticeDeadline(c.end_date, c.notice_months) : null, lines: ls, period_net: net, mrr: c.status === 'active' ? mrr(net, c.interval_months) : 0,
    invoices: invoices.map((i) => ({ ...i, total: i.total == null ? null : Number(i.total) })),
  };
}

export const getContract = (companyId: number, id: number) => load(sql, companyId, id);

export async function listContracts(companyId: number, f: { status?: string; customer_id?: number } = {}) {
  const ids = await sql<{ id: number }[]>`SELECT a.id FROM avt_contracts a JOIN customers c ON c.id = a.customer_id WHERE a.company_id = ${companyId}
    ${f.status ? sql`AND a.status = ${f.status}` : sql``} ${f.customer_id ? sql`AND a.customer_id = ${f.customer_id}` : sql``}
    ORDER BY CASE a.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, c.name, a.name`;
  return Promise.all(ids.map((r) => load(sql, companyId, r.id)));
}

function readLines(input: Record<string, unknown>): ContractLine[] {
  const lines = arr(input, 'lines', 'Avtalsrader').map((r, i) => {
    const quantity = Number(String(r.quantity ?? '1').replace(',', '.'));
    const vat = optInt(r, 'vat_rate', 'Moms') ?? 25;
    if (!Number.isFinite(quantity) || quantity <= 0) throw new ValidationError(`Rad ${i + 1}: ogiltigt antal`);
    if (![0, 6, 12, 25].includes(vat)) throw new ValidationError('Momssats måste vara 0, 6, 12 eller 25');
    return { description: str(r, 'description', { required: true, label: `Rad ${i + 1}` }), quantity, unit: str(r, 'unit') || 'st', unit_price: int(r, 'unit_price', `Rad ${i + 1}: pris`), vat_rate: vat };
  });
  if (!lines.length) throw new ValidationError('Avtalet måste ha minst en rad');
  return lines;
}

function readContract(input: Record<string, unknown>) {
  const interval = optInt(input, 'interval_months', 'Intervall') ?? 1;
  if (!INTERVALS[interval]) throw new ValidationError('Intervall ska vara 1, 3, 6 eller 12 månader');
  const start = date(input, 'start_date', 'Startdatum');
  const end = date(input, 'end_date', 'Slutdatum', false) || null;
  if (end && end < start) throw new ValidationError('Slutdatum är före startdatum');
  const bool = (k: string, def: boolean) => (input[k] == null ? def : input[k] === true || input[k] === 'on' || input[k] === 'true');
  return {
    name: str(input, 'name', { required: true, label: 'Avtalets namn' }), start_date: start, end_date: end, interval_months: interval, in_advance: bool('in_advance', true),
    notice_months: optInt(input, 'notice_months', 'Uppsägningstid') ?? 3, auto_renew: bool('auto_renew', true), renewal_months: optInt(input, 'renewal_months', 'Förlängning') ?? 12,
    auto_book: bool('auto_book', false), your_reference: str(input, 'your_reference'), notes: str(input, 'notes'),
  };
}

export async function createContract(actor: Actor, input: Record<string, unknown>): Promise<ContractOut> {
  const f = readContract(input);
  const lines = readLines(input);
  const customerId = int(input, 'customer_id', 'Kund');
  return sql.begin(async (tx) => {
    if (!(await tx`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`).length) throw new ValidationError('Kunden finns inte');
    const [{ id }] = await tx<{ id: number }[]>`INSERT INTO avt_contracts ${tx({ ...f, customer_id: customerId, next_period_start: f.start_date, company_id: actor.companyId, created_by: actor.userId })} RETURNING id`;
    await tx`INSERT INTO avt_lines ${tx(lines.map((l, i) => ({ ...l, contract_id: id, position: i + 1 })))}`;
    await auditBy(tx, actor, 'create', 'avtal.contract', id);
    const out = await load(tx, actor.companyId, id);
    await emit(tx, actor.companyId, 'avtal.contract.created', out);
    return out;
  });
}

export async function updateContract(actor: Actor, id: number, input: Record<string, unknown>): Promise<ContractOut> {
  const f = readContract(input);
  const lines = readLines(input);
  return sql.begin(async (tx) => {
    const cur = await load(tx, actor.companyId, id);
    const { start_date: _s, ...rest } = f;
    await tx`UPDATE avt_contracts SET ${tx(cur.invoices.length ? rest : { ...f, next_period_start: f.start_date })} WHERE id = ${id}`;
    await tx`DELETE FROM avt_lines WHERE contract_id = ${id}`;
    await tx`INSERT INTO avt_lines ${tx(lines.map((l, i) => ({ ...l, contract_id: id, position: i + 1 })))}`;
    await auditBy(tx, actor, 'update', 'avtal.contract', id);
    return load(tx, actor.companyId, id);
  });
}

export async function setStatus(actor: Actor, id: number, status: 'active' | 'paused' | 'ended', endDate?: string) {
  return sql.begin(async (tx) => {
    const c = await load(tx, actor.companyId, id);
    if (status === 'ended') {
      const end = endDate || c.end_date || today();
      await tx`UPDATE avt_contracts SET status = 'ended', end_date = ${end}, auto_renew = false WHERE id = ${id}`;
    } else {
      await tx`UPDATE avt_contracts SET status = ${status} WHERE id = ${id}`;
    }
    await auditBy(tx, actor, status, 'avtal.contract', id);
    return load(tx, actor.companyId, id);
  });
}

/** Säger upp avtalet: det löper ut vid nästa möjliga slutdatum med hänsyn till uppsägningstiden */
export async function terminate(actor: Actor, id: number, noticeDate = today()) {
  return sql.begin(async (tx) => {
    const c = await load(tx, actor.companyId, id);
    let end = addMonths(noticeDate, c.notice_months);
    if (c.end_date && c.end_date >= end) end = c.end_date; // bundet till slutdatumet
    await tx`UPDATE avt_contracts SET end_date = ${end}, auto_renew = false WHERE id = ${id}`;
    await auditBy(tx, actor, 'terminate', 'avtal.contract', id, { end });
    return load(tx, actor.companyId, id);
  });
}

/** Prisjustering (t.ex. index) i procent på avtalets rader */
export async function adjustPrices(actor: Actor, percent: number, ids?: number[]) {
  if (!Number.isFinite(percent) || percent < -50 || percent > 100) throw new ValidationError('Ogiltig procentsats');
  const r = await sql`UPDATE avt_lines l SET unit_price = ROUND(l.unit_price * ${1 + percent / 100} / 100) * 100 FROM avt_contracts a
    WHERE a.id = l.contract_id AND a.company_id = ${actor.companyId} AND a.status <> 'ended' ${ids?.length ? sql`AND a.id IN ${sql(ids)}` : sql``} RETURNING l.id`;
  await auditBy(sql, actor, 'adjust_prices', 'avtal.contract', ids?.[0] ?? 0, { percent, lines: r.length });
  return r.length;
}

/**
 * Skapar fakturor för alla perioder som ska faktureras till och med datumet. Förskott faktureras vid periodens början,
 * efterskott dagen efter periodens slut. Avtal med automatisk förlängning förlängs; andra avslutas efter slutdatum.
 */
export async function generateDue(actor: Actor, upTo = today(), onlyId?: number): Promise<number[]> {
  const ids = await sql<{ id: number }[]>`SELECT id FROM avt_contracts WHERE company_id = ${actor.companyId} AND status = 'active' ${onlyId ? sql`AND id = ${onlyId}` : sql``}`;
  const created: number[] = [];
  for (const { id } of ids) {
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM avt_contracts WHERE id = ${id} FOR UPDATE`;
      for (let guard = 0; guard < 24; guard++) {
        const c = await load(tx, actor.companyId, id);
        if (c.status !== 'active') break;
        const p = period(c.next_period_start, c.interval_months);
        if (c.end_date && p.start > c.end_date) {
          if (c.auto_renew && invoiceDate(p.start, c.interval_months, c.in_advance) <= upTo) {
            await tx`UPDATE avt_contracts SET end_date = ${renewUntil(c.end_date, c.renewal_months, p.start)} WHERE id = ${id}`;
            continue;
          }
          if (!c.auto_renew) await tx`UPDATE avt_contracts SET status = 'ended' WHERE id = ${id}`;
          break;
        }
        const invDate = invoiceDate(p.start, c.interval_months, c.in_advance);
        if (invDate > upTo) break;
        const end = c.end_date && p.end > c.end_date ? c.end_date : p.end;
        const inv = await saveDraftTx(tx, actor, null, {
          customer_id: c.customer_id, invoice_date: invDate, delivery_date: `${p.start} – ${end}`, your_reference: c.your_reference,
          notes: `${c.name}, period ${p.start} – ${end}.`,
          lines: c.lines.map((l) => ({ ...l, description: `${l.description} (${p.start} – ${end})` })),
        });
        await tx`INSERT INTO avt_invoices (contract_id, period_start, period_end, invoice_id) VALUES (${id}, ${p.start}, ${end}, ${inv.id})`;
        await tx`UPDATE avt_contracts SET next_period_start = ${p.next} WHERE id = ${id}`;
        created.push(inv.id);
      }
    });
  }
  // Bokför efteråt (egen transaktion per faktura) för avtal med automatisk bokföring
  for (const invId of created) {
    const [x] = await sql<{ auto_book: boolean }[]>`SELECT a.auto_book FROM avt_invoices i JOIN avt_contracts a ON a.id = i.contract_id WHERE i.invoice_id = ${invId}`;
    if (x?.auto_book) await bookInvoice(actor, invId);
  }
  if (created.length) await auditBy(sql, actor, 'generate', 'avtal.contract', onlyId ?? 0, { invoices: created.length });
  return created;
}

/** Cron: återkommande fakturor i alla bolag med aktiverad avtalsmodul */
export async function generateAll(upTo = today()) {
  const companies = await sql<{ company_id: number; user_id: number }[]>`
    SELECT DISTINCT ON (a.company_id) a.company_id, m.user_id FROM avt_contracts a
    JOIN company_modules cm ON cm.company_id = a.company_id AND cm.module_id = 'avtal'
    JOIN memberships m ON m.company_id = a.company_id AND m.role = 'owner'
    WHERE a.status = 'active' ORDER BY a.company_id, m.user_id`;
  let n = 0;
  for (const c of companies) n += (await generateDue({ companyId: c.company_id, userId: c.user_id, apiKeyId: null, role: 'owner' }, upTo)).length;
  return { invoices: n };
}

/** Avtal vars uppsägningsdatum infaller inom `days` dagar */
export async function upcomingRenewals(companyId: number, days = 90) {
  const t = today();
  const limit = new Date(Date.parse(t) + days * 86400000).toISOString().slice(0, 10);
  return (await listContracts(companyId, { status: 'active' })).filter((c) => c.notice_deadline && c.notice_deadline >= t && c.notice_deadline <= limit);
}

/** Skapar en förnyelseaffär i CRM (om modulen används) */
export async function renewalDeal(actor: Actor, id: number) {
  const c = await getContract(actor.companyId, id);
  const { pipelines, stages, createDeal } = await import('@/modules/crm/pipeline');
  const pipes = await pipelines(sql, actor.companyId);
  const pipe = pipes.find((p) => /förnyelse|renewal/i.test(p.name)) ?? pipes[0];
  const first = (await stages(sql, actor.companyId)).find((s) => s.pipeline_id === pipe.id && s.kind === 'open' && s.active);
  if (!first) throw new ConflictError('Pipelinen saknar öppna faser');
  return createDeal(actor, {
    title: `Förnyelse: ${c.name}`, customer_id: c.customer_id, value: c.mrr * 12, expected_close: c.notice_deadline ?? undefined, stage_id: first.id,
    next_step: `Kontakta kunden före ${c.notice_deadline ?? 'uppsägningsdatum'}`, source: 'Avtal',
  });
}

export async function stats(companyId: number) {
  const list = await listContracts(companyId);
  const active = list.filter((c) => c.status === 'active');
  const m = active.reduce((s, c) => s + c.mrr, 0);
  return { active: active.length, mrr: m, arr: m * 12, due: active.filter((c) => c.next_invoice_date <= today()).length };
}
