import 'server-only';
import { minutesBetween } from '@/lib/time-flow';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { bankStatement, fmtHours, hoursQty, monthName, monthRange, parseDuration, timeInvoiceLines, type BankStatement } from '@/lib/time';
import { addDays, today } from '@/lib/format';
import type { Actor } from './actor';
import { saveDraftTx, type InvoiceOut } from './invoices';
import { bool, date, int, optInt, str } from './input';

export type Billing = 'hourly' | 'hour_bank' | 'fixed' | 'internal';
const BILLINGS: Billing[] = ['hourly', 'hour_bank', 'fixed', 'internal'];

export interface Activity { id: number; name: string; hourly_rate: number | null; rate: number; billable: boolean; active: boolean }
export interface ProjectOut {
  id: number; object: 'project'; customer_id: number; customer_name: string; name: string; billing: Billing;
  hourly_rate: number; vat_rate: number; active: boolean; notes: string; activities: Activity[];
  minutes_total: number; minutes_unbilled: number; value_unbilled: number;
  bank: { purchased: number; drawn: number; unreported: number; remaining: number } | null;
}

async function loadProject(db: Tx | typeof sql, companyId: number, id: number): Promise<ProjectOut> {
  const [p] = await db<Omit<ProjectOut, 'object' | 'activities' | 'bank' | 'minutes_total' | 'minutes_unbilled' | 'value_unbilled'>[]>`
    SELECT p.id, p.customer_id, c.name AS customer_name, p.name, p.billing, p.hourly_rate::int AS hourly_rate, p.vat_rate, p.active, p.notes
    FROM projects p JOIN customers c ON c.id = p.customer_id WHERE p.id = ${id} AND p.company_id = ${companyId}`;
  if (!p) throw new NotFoundError('Uppdraget');
  const acts = await db<Omit<Activity, 'rate'>[]>`SELECT id, name, hourly_rate::int AS hourly_rate, billable, active FROM project_activities WHERE project_id = ${id} ORDER BY name`;
  const activities = acts.map((a) => ({ ...a, rate: a.hourly_rate ?? p.hourly_rate }));
  const [t] = await db<{ total: number; unbilled: number; value: number }[]>`
    SELECT COALESCE(SUM(e.minutes), 0)::int AS total,
      COALESCE(SUM(e.minutes) FILTER (WHERE e.billable AND e.invoice_id IS NULL), 0)::int AS unbilled,
      COALESCE(SUM(e.minutes * COALESCE(r.rate, a.hourly_rate, ${p.hourly_rate}) / 60.0) FILTER (WHERE e.billable AND e.invoice_id IS NULL), 0)::bigint AS value
    FROM time_entries e JOIN project_activities a ON a.id = e.activity_id LEFT JOIN project_user_rates r ON r.project_id = e.project_id AND r.user_id = e.user_id WHERE e.project_id = ${id}`;
  let bank: ProjectOut['bank'] = null;
  if (p.billing === 'hour_bank') {
    const b = await bankTotals(db, id);
    bank = { purchased: b.purchased, drawn: b.drawn, unreported: t.unbilled, remaining: b.purchased - b.drawn - t.unbilled };
  }
  return { ...p, object: 'project', activities, minutes_total: t.total, minutes_unbilled: t.unbilled, value_unbilled: Number(t.value), bank };
}

/** Köpta (fakturerade) och avräknade minuter i en timbank */
async function bankTotals(db: Tx | typeof sql, projectId: number): Promise<{ purchased: number; drawn: number }> {
  const [r] = await db<{ purchased: number; drawn: number }[]>`SELECT
    (SELECT COALESCE(SUM(h.minutes), 0) FROM hour_bank_purchases h JOIN invoices i ON i.id = h.invoice_id
      WHERE h.project_id = ${projectId} AND i.status IN ('booked', 'paid'))::int AS purchased,
    (SELECT COALESCE(SUM((i.hour_bank->>'drawn')::int), 0) FROM invoices i
      WHERE i.project_id = ${projectId} AND i.hour_bank IS NOT NULL AND i.status <> 'credited')::int AS drawn`;
  return r;
}

export const getProject = (companyId: number, id: number) => loadProject(sql, companyId, id);

export async function listProjects(companyId: number, f: { active?: boolean; customer_id?: number } = {}): Promise<ProjectOut[]> {
  const rows = await sql<{ id: number }[]>`SELECT p.id FROM projects p JOIN customers c ON c.id = p.customer_id WHERE p.company_id = ${companyId}
    ${f.active != null ? sql`AND p.active = ${f.active}` : sql``} ${f.customer_id ? sql`AND p.customer_id = ${f.customer_id}` : sql``}
    ORDER BY p.active DESC, c.name, p.name`;
  return Promise.all(rows.map((r) => loadProject(sql, companyId, r.id)));
}

const rate = (input: Record<string, unknown>, key: string, label: string) => {
  const v = optInt(input, key, label);
  if (v != null && v < 0) throw new ValidationError(`${label} kan inte vara negativt`);
  return v;
};

export async function createProject(actor: Actor, input: Record<string, unknown>): Promise<ProjectOut> {
  const customerId = int(input, 'customer_id', 'Kund');
  const [c] = await sql`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  if (!c) throw new ValidationError('Kunden finns inte');
  const billing = (str(input, 'billing') || 'hourly') as Billing;
  if (!BILLINGS.includes(billing)) throw new ValidationError('Ogiltig faktureringsform');
  const vat = optInt(input, 'vat_rate', 'Momssats') ?? 25;
  if (![0, 6, 12, 25].includes(vat)) throw new ValidationError('Momssats måste vara 0, 6, 12 eller 25');
  const names = (Array.isArray(input.activities) ? input.activities.map(String) : String(input.activities ?? '').split(/\n|,/))
    .map((s) => s.trim()).filter(Boolean);
  return sql.begin(async (tx) => {
    const [{ id }] = await tx<{ id: number }[]>`INSERT INTO projects ${tx({
      company_id: actor.companyId, customer_id: customerId, name: str(input, 'name', { required: true, label: 'Namn' }), billing,
      hourly_rate: rate(input, 'hourly_rate', 'Timpris') ?? 0, vat_rate: vat, notes: str(input, 'notes'),
    })} RETURNING id`;
    const uniq = [...new Set(names.length ? names : ['Konsulttid'])];
    await tx`INSERT INTO project_activities ${tx(uniq.map((name) => ({ project_id: id, name, billable: billing !== 'internal' })))}`;
    await auditBy(tx, actor, 'create', 'project', id);
    const out = await loadProject(tx, actor.companyId, id);
    await emit(tx, actor.companyId, 'project.created', out);
    return out;
  });
}

export async function updateProject(actor: Actor, id: number, input: Record<string, unknown>): Promise<ProjectOut> {
  const cur = await getProject(actor.companyId, id);
  const billing = (str(input, 'billing') || cur.billing) as Billing;
  if (!BILLINGS.includes(billing)) throw new ValidationError('Ogiltig faktureringsform');
  return sql.begin(async (tx) => {
    await tx`UPDATE projects SET name = ${str(input, 'name') || cur.name}, billing = ${billing},
      hourly_rate = ${rate(input, 'hourly_rate', 'Timpris') ?? cur.hourly_rate},
      active = ${input.active == null ? cur.active : bool(input, 'active')}, notes = ${input.notes == null ? cur.notes : str(input, 'notes')}
      WHERE id = ${id}`;
    await auditBy(tx, actor, 'update', 'project', id);
    return loadProject(tx, actor.companyId, id);
  });
}

export async function saveActivity(actor: Actor, projectId: number, activityId: number | null, input: Record<string, unknown>) {
  await getProject(actor.companyId, projectId);
  const hr = input.hourly_rate === '' || input.hourly_rate == null ? null : rate(input, 'hourly_rate', 'Timpris');
  try {
    if (activityId) {
      const r = await sql`UPDATE project_activities SET name = ${str(input, 'name', { required: true, label: 'Namn' })}, hourly_rate = ${hr},
        billable = ${bool(input, 'billable')}, active = ${input.active == null ? true : bool(input, 'active')}
        WHERE id = ${activityId} AND project_id = ${projectId} RETURNING id`;
      if (!r.length) throw new NotFoundError('Aktiviteten');
    } else {
      await sql`INSERT INTO project_activities (project_id, name, hourly_rate, billable)
        VALUES (${projectId}, ${str(input, 'name', { required: true, label: 'Namn' })}, ${hr}, ${input.billable == null ? true : bool(input, 'billable')})`;
    }
  } catch (e) {
    if (String((e as Error).message).includes('project_activities_project_id_name_key')) throw new ConflictError('Det finns redan en aktivitet med det namnet');
    throw e;
  }
  await auditBy(sql, actor, activityId ? 'update' : 'create', 'project_activity', activityId ?? projectId);
  return getProject(actor.companyId, projectId);
}

// ---------- Tidrader ----------

export interface TimeEntryOut {
  id: number; object: 'time_entry'; project_id: number; project_name: string; customer_name: string; activity_id: number; activity_name: string;
  user_id: number; user_name: string; date: string; minutes: number; description: string; billable: boolean; invoice_id: number | null;
}

const TCOLS = (db: Tx | typeof sql) => db`e.id, 'time_entry' AS object, e.project_id, p.name AS project_name, c.name AS customer_name, e.activity_id,
  a.name AS activity_name, e.user_id, u.name AS user_name, to_char(e.date,'YYYY-MM-DD') AS date, e.minutes, e.description, e.billable, e.invoice_id`;
const TFROM = (db: Tx | typeof sql) => db`time_entries e JOIN projects p ON p.id = e.project_id JOIN customers c ON c.id = p.customer_id
  JOIN project_activities a ON a.id = e.activity_id JOIN users u ON u.id = e.user_id`;

export async function listTimeEntries(companyId: number, f: { from?: string; to?: string; project_id?: number; user_id?: number; unbilled?: boolean; invoice_id?: number }) {
  return sql<TimeEntryOut[]>`SELECT ${TCOLS(sql)} FROM ${TFROM(sql)} WHERE e.company_id = ${companyId}
    ${f.from ? sql`AND e.date >= ${f.from}` : sql``} ${f.to ? sql`AND e.date <= ${f.to}` : sql``}
    ${f.project_id ? sql`AND e.project_id = ${f.project_id}` : sql``} ${f.user_id ? sql`AND e.user_id = ${f.user_id}` : sql``}
    ${f.unbilled ? sql`AND e.billable AND e.invoice_id IS NULL` : sql``} ${f.invoice_id ? sql`AND e.invoice_id = ${f.invoice_id}` : sql``}
    ORDER BY e.date, e.id`;
}

export async function createTimeEntry(actor: Actor, input: Record<string, unknown>): Promise<TimeEntryOut> {
  const activityId = int(input, 'activity_id', 'Aktivitet');
  const [a] = await sql<{ project_id: number; billable: boolean; active: boolean; p_active: boolean; billing: Billing }[]>`
    SELECT a.project_id, a.billable, a.active, p.active AS p_active, p.billing FROM project_activities a JOIN projects p ON p.id = a.project_id
    WHERE a.id = ${activityId} AND p.company_id = ${actor.companyId}`;
  if (!a) throw new ValidationError('Aktiviteten finns inte');
  if (!a.active || !a.p_active) throw new ValidationError('Uppdraget eller aktiviteten är avslutad');
  // Klockslag (för OB och lön): tiden räknas från passet om inget annat anges
  const st = str(input, 'start_time'), et = str(input, 'end_time');
  const timeRe = /^([01]?\d|2[0-3]):[0-5]\d$/;
  if ((st || et) && !(timeRe.test(st) && timeRe.test(et))) throw new ValidationError('Ange start och slut som klockslag, t.ex. 17:00 och 23:30');
  const shift = st && et ? minutesBetween(st, et) : null;
  const kind = str(input, 'kind') === 'travel' ? 'travel' : 'work';
  const minutes = input.minutes != null && input.minutes !== '' ? int(input, 'minutes', 'Minuter') : String(input.hours ?? '').trim() ? parseDuration(String(input.hours ?? '')) : shift;
  if (!minutes || minutes <= 0 || minutes > 1440) throw new ValidationError('Ange tid, t.ex. 1,5 eller 1:30 (högst 24 timmar)');
  const billable = a.billing === 'internal' ? false : input.billable == null ? a.billable : bool(input, 'billable');
  return sql.begin(async (tx) => {
    const [{ id }] = await tx<{ id: number }[]>`INSERT INTO time_entries ${tx({
      company_id: actor.companyId, project_id: a.project_id, activity_id: activityId, user_id: actor.userId,
      date: date(input, 'date', 'Datum'), minutes, description: str(input, 'description'), billable,
      start_time: st || null, end_time: et || null, kind,
    })} RETURNING id`;
    await auditBy(tx, actor, 'create', 'time_entry', id);
    const [out] = await tx<TimeEntryOut[]>`SELECT ${TCOLS(tx)} FROM ${TFROM(tx)} WHERE e.id = ${id}`;
    await emit(tx, actor.companyId, 'time_entry.created', out);
    return out;
  });
}

export async function deleteTimeEntry(actor: Actor, id: number) {
  await sql.begin(async (tx) => {
    const [e] = await tx<{ invoice_id: number | null; payslip_id: number | null }[]>`SELECT invoice_id, payslip_id FROM time_entries WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!e) throw new NotFoundError('Tidraden');
    if (e.invoice_id) throw new ConflictError('Tiden är fakturerad eller avräknad och kan inte tas bort');
    if (e.payslip_id) throw new ConflictError('Tiden är överförd till lönen och kan inte tas bort');
    await tx`DELETE FROM time_entries WHERE id = ${id}`;
    await auditBy(tx, actor, 'delete', 'time_entry', id);
  });
  return { id, object: 'time_entry', deleted: true };
}

// ---------- Fakturering ----------

interface Unbilled { id: number; minutes: number; activity: string; rate: number }
async function unbilled(tx: Tx, companyId: number, projectId: number, to: string, from?: string): Promise<Unbilled[]> {
  // Timpris: personens pris på uppdraget, annars aktivitetens, annars uppdragets
  return tx<Unbilled[]>`SELECT e.id, e.minutes, a.name AS activity, COALESCE(r.rate, a.hourly_rate, p.hourly_rate)::int AS rate
    FROM time_entries e JOIN project_activities a ON a.id = e.activity_id JOIN projects p ON p.id = e.project_id
      LEFT JOIN project_user_rates r ON r.project_id = e.project_id AND r.user_id = e.user_id
    WHERE e.company_id = ${companyId} AND e.project_id = ${projectId} AND e.billable AND e.invoice_id IS NULL
      AND e.date <= ${to} ${from ? tx`AND e.date >= ${from}` : tx``}
      AND (e.status = 'approved' OR NOT (SELECT time_approval FROM companies WHERE id = ${companyId}))
    ORDER BY e.date, e.id FOR UPDATE OF e`;
}

/** Fakturaunderlag (löpande räkning): ofakturerad debiterbar tid i perioden blir ett fakturautkast, en rad per aktivitet och timpris */
export async function invoiceTime(actor: Actor, projectId: number, input: Record<string, unknown>): Promise<InvoiceOut> {
  const p = await getProject(actor.companyId, projectId);
  if (p.billing === 'internal' || p.billing === 'fixed') throw new ValidationError('Uppdraget faktureras inte per timme');
  if (p.billing === 'hour_bank') throw new ValidationError('Timbanken avräknas per månad – använd månadsavräkningen');
  const to = date(input, 'to', 'Till och med');
  const from = date(input, 'from', 'Från', false) || undefined;
  return sql.begin(async (tx) => {
    const rows = await unbilled(tx, actor.companyId, projectId, to, from);
    if (!rows.length) throw new ValidationError('Det finns ingen ofakturerad debiterbar tid i perioden');
    const lines = timeInvoiceLines(rows, { suffix: p.name, vatRate: p.vat_rate });
    const inv = await saveDraftTx(tx, actor, null, {
      customer_id: p.customer_id, invoice_date: date(input, 'invoice_date', 'Fakturadatum', false) || today(),
      notes: `Arbetad tid ${from ? `${from} – ` : 't.o.m. '}${to} enligt bifogad tidsspecifikation.`, lines,
    });
    await tx`UPDATE invoices SET project_id = ${projectId} WHERE id = ${inv.id}`;
    await tx`UPDATE time_entries SET invoice_id = ${inv.id} WHERE id IN ${tx(rows.map((r) => r.id))}`;
    await auditBy(tx, actor, 'invoice_time', 'project', projectId, { invoice: inv.id, minutes: rows.reduce((s, r) => s + r.minutes, 0) });
    return inv;
  });
}

/** Köp av timbank: fakturautkast för timmarna. Timmarna räknas in i banken när fakturan är bokförd. */
export async function buyHourBank(actor: Actor, projectId: number, input: Record<string, unknown>): Promise<InvoiceOut> {
  const p = await getProject(actor.companyId, projectId);
  if (p.billing !== 'hour_bank') throw new ValidationError('Uppdraget är inte en timbank');
  const minutes = parseDuration(String(input.hours ?? ''));
  if (!minutes || minutes <= 0) throw new ValidationError('Ange antal timmar');
  const price = rate(input, 'hourly_rate', 'Timpris') ?? p.hourly_rate;
  if (!price) throw new ValidationError('Ange timpris för timbanken');
  const d = date(input, 'date', 'Fakturadatum', false) || today();
  return sql.begin(async (tx) => {
    const inv = await saveDraftTx(tx, actor, null, {
      customer_id: p.customer_id, invoice_date: d,
      notes: 'Timbank. Timmarna dras av i takt med att de används och ni får en avräkning varje månad som visar hur många timmar som finns kvar.',
      lines: [{ description: `Timbank ${fmtHours(minutes)} – ${p.name}`, quantity: hoursQty(minutes), unit: 'h', unit_price: price, vat_rate: p.vat_rate }],
    });
    await tx`UPDATE invoices SET project_id = ${projectId} WHERE id = ${inv.id}`;
    await tx`INSERT INTO hour_bank_purchases (project_id, date, minutes, invoice_id) VALUES (${projectId}, ${d}, ${minutes}, ${inv.id})`;
    await auditBy(tx, actor, 'buy_hour_bank', 'project', projectId, { invoice: inv.id, minutes });
    return inv;
  });
}

/** Månadsavräkning av timbank: faktura som visar använda timmar och hur många som finns kvar. Timmar utöver banken faktureras. */
export async function bankStatementInvoice(actor: Actor, projectId: number, input: Record<string, unknown>): Promise<InvoiceOut> {
  const p = await getProject(actor.companyId, projectId);
  if (p.billing !== 'hour_bank') throw new ValidationError('Uppdraget är inte en timbank');
  const period = str(input, 'period');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new ValidationError('Ange månad som ÅÅÅÅ-MM');
  const [, end] = monthRange(period);
  return sql.begin(async (tx) => {
    await tx`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
    const dup = await tx`SELECT 1 FROM invoices WHERE project_id = ${projectId} AND hour_bank->>'period' = ${period} AND status <> 'credited'`;
    if (dup.length) throw new ConflictError(`Det finns redan en avräkning för ${monthName(period)}`);
    const rows = await unbilled(tx, actor.companyId, projectId, end);
    const totals = await bankTotals(tx, projectId);
    const used = rows.reduce((s, r) => s + r.minutes, 0);
    const st = bankStatement(totals.purchased, totals.drawn, used);
    const label = monthName(period);
    let lines = timeInvoiceLines(rows, { suffix: `${label} (från timbanken)`, vatRate: p.vat_rate }).map((l) => ({ ...l, unit_price: 0 }));
    if (!lines.length) lines = [{ description: `Inga timmar använda i ${label}`, quantity: 1, unit: 'st', unit_price: 0, vat_rate: p.vat_rate }];
    if (st.overage > 0) {
      lines.push({ description: `Timmar utöver timbanken, ${label}`, quantity: hoursQty(st.overage), unit: 'h', unit_price: p.hourly_rate, vat_rate: p.vat_rate });
    }
    const inv = await saveDraftTx(tx, actor, null, {
      customer_id: p.customer_id, invoice_date: str(input, 'invoice_date') || addDays(end, 1),
      notes: `Avräkning av timbank för ${label}: ${fmtHours(st.usedNow)} använda, ${fmtHours(st.remaining)} kvar.`
        + (st.overage > 0 ? ` ${fmtHours(st.overage)} utöver timbanken faktureras.` : ''),
      lines,
    });
    const hb = { period, purchased: st.purchased, drawn_before: st.drawnBefore, used_now: st.usedNow, drawn: st.drawn, overage: st.overage, remaining: st.remaining };
    await tx`UPDATE invoices SET project_id = ${projectId}, hour_bank = ${tx.json(hb)} WHERE id = ${inv.id}`;
    if (rows.length) await tx`UPDATE time_entries SET invoice_id = ${inv.id} WHERE id IN ${tx(rows.map((r) => r.id))}`;
    await auditBy(tx, actor, 'hour_bank_statement', 'project', projectId, { invoice: inv.id, ...hb });
    return { ...inv };
  });
}

/** Timbanker som saknar avräkning för en månad */
export async function pendingBankStatements(companyId: number, period: string) {
  return sql<{ id: number; name: string; customer_name: string }[]>`
    SELECT p.id, p.name, c.name AS customer_name FROM projects p JOIN customers c ON c.id = p.customer_id
    WHERE p.company_id = ${companyId} AND p.active AND p.billing = 'hour_bank'
      AND EXISTS (SELECT 1 FROM hour_bank_purchases h WHERE h.project_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.project_id = p.id AND i.hour_bank->>'period' = ${period} AND i.status <> 'credited')
    ORDER BY c.name, p.name`;
}

/** Skapar månadsavräkningar (utkast) för alla timbanker som saknar en för perioden */
export async function createBankStatements(actor: Actor, period: string): Promise<number> {
  const list = await pendingBankStatements(actor.companyId, period);
  for (const p of list) await bankStatementInvoice(actor, p.id, { period });
  return list.length;
}

/** Cron: skapar förra månadens timbanksavräkningar som utkast i alla bolag (som bolagets första ägare) */
export async function createAllBankStatements(date = today()) {
  const { previousMonth } = await import('@/lib/time');
  const period = previousMonth(date);
  const companies = await sql<{ company_id: number; user_id: number }[]>`
    SELECT DISTINCT ON (p.company_id) p.company_id, m.user_id FROM projects p JOIN memberships m ON m.company_id = p.company_id AND m.role = 'owner'
    WHERE p.billing = 'hour_bank' AND p.active ORDER BY p.company_id, m.user_id`;
  let created = 0;
  for (const c of companies) {
    created += await createBankStatements({ companyId: c.company_id, userId: c.user_id, apiKeyId: null, role: 'owner' }, period);
  }
  return { period, created };
}

export type { BankStatement };

// ---------- Timpris per person och beläggning ----------

export async function userRates(companyId: number, projectId: number) {
  return sql<{ user_id: number; name: string; rate: number | null }[]>`
    SELECT u.id AS user_id, u.name, r.rate::int AS rate FROM memberships m JOIN users u ON u.id = m.user_id
      LEFT JOIN project_user_rates r ON r.project_id = ${projectId} AND r.user_id = u.id
    WHERE m.company_id = ${companyId} AND m.role <> 'auditor' ORDER BY u.name`;
}

export async function setUserRate(actor: Actor, projectId: number, userId: number, rateOre: number | null) {
  const [p] = await sql`SELECT 1 FROM projects WHERE id = ${projectId} AND company_id = ${actor.companyId}`;
  if (!p) throw new NotFoundError('Uppdraget');
  const [m] = await sql`SELECT 1 FROM memberships WHERE company_id = ${actor.companyId} AND user_id = ${userId}`;
  if (!m) throw new ValidationError('Personen är inte användare i bolaget');
  if (rateOre == null) await sql`DELETE FROM project_user_rates WHERE project_id = ${projectId} AND user_id = ${userId}`;
  else {
    if (rateOre < 0) throw new ValidationError('Ogiltigt timpris');
    await sql`INSERT INTO project_user_rates (project_id, user_id, rate) VALUES (${projectId}, ${userId}, ${rateOre}) ON CONFLICT (project_id, user_id) DO UPDATE SET rate = EXCLUDED.rate`;
  }
  await auditBy(sql, actor, 'user_rate', 'project', projectId, { user_id: userId, rate: rateOre });
}

/**
 * Beläggning per person i en period: rapporterad tid, debiterbar tid och beläggningsgrad
 * (debiterbar tid i procent av tillgänglig tid = arbetstid per vecka enligt anställningen, annars 40 h, för vardagarna i perioden).
 */
export async function utilization(companyId: number, from: string, to: string) {
  const rows = await sql<{ user_id: number; name: string; total: number; billable: number; value: number; hours_per_week: number | null }[]>`
    SELECT u.id AS user_id, u.name,
      COALESCE(SUM(e.minutes), 0)::int AS total,
      COALESCE(SUM(e.minutes) FILTER (WHERE e.billable AND p.billing <> 'internal'), 0)::int AS billable,
      COALESCE(SUM(e.minutes * COALESCE(r.rate, a.hourly_rate, p.hourly_rate) / 60.0) FILTER (WHERE e.billable AND p.billing <> 'internal'), 0)::bigint AS value,
      (SELECT em.hours_per_week::float8 FROM employees em WHERE em.company_id = ${companyId} AND em.user_id = u.id LIMIT 1) AS hours_per_week
    FROM memberships m JOIN users u ON u.id = m.user_id
      LEFT JOIN time_entries e ON e.user_id = u.id AND e.company_id = ${companyId} AND e.date BETWEEN ${from} AND ${to}
      LEFT JOIN projects p ON p.id = e.project_id LEFT JOIN project_activities a ON a.id = e.activity_id
      LEFT JOIN project_user_rates r ON r.project_id = e.project_id AND r.user_id = e.user_id
    WHERE m.company_id = ${companyId} AND m.role IN ('owner','accountant','employee')
    GROUP BY u.id, u.name HAVING COALESCE(SUM(e.minutes), 0) > 0 ORDER BY u.name`;
  const { workdays } = await import('@/lib/absence');
  const days = workdays(from, to).length;
  return rows.map((r) => {
    const available = Math.round(((r.hours_per_week ?? 40) / 5) * days * 60);
    return { ...r, value: Number(r.value), available, utilization: available ? Math.round((r.billable / available) * 1000) / 10 : null };
  });
}
