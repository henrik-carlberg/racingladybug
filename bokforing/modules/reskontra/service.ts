import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { sendMail } from '@/lib/server/mail';
import { formatAmount } from '@/lib/money';
import { today } from '@/lib/format';
import type { Actor } from '@/lib/services/actor';
import { optInt, str } from '@/lib/services/input';
import { saveDraftTx } from '@/lib/services/invoices';
import { aging, daysBetween, lateInterest, nextAction } from './calc';

type Db = Tx | typeof sql;

export interface Settings {
  first_days: number; second_days: number; collection_days: number; fee: number; reference_rate: number | null; interest_extra: number;
  fee_account: number; interest_account: number; auto_remind: boolean; message: string;
}
const DEFAULTS: Settings = { first_days: 7, second_days: 21, collection_days: 35, fee: 6000, reference_rate: null, interest_extra: 8, fee_account: 3990, interest_account: 8313, auto_remind: false, message: '' };

export async function settings(db: Db, companyId: number): Promise<Settings> {
  const [s] = await db<Settings[]>`SELECT first_days, second_days, collection_days, fee::bigint AS fee, reference_rate::float8 AS reference_rate, interest_extra::float8 AS interest_extra,
    fee_account, interest_account, auto_remind, message FROM rk_settings WHERE company_id = ${companyId}`;
  return s ? { ...s, fee: Number(s.fee) } : { ...DEFAULTS };
}

export async function saveSettings(actor: Actor, input: Record<string, unknown>) {
  const n = (k: string, l: string, def: number) => { const v = optInt(input, k, l) ?? def; if (v < 0) throw new ValidationError(`${l} kan inte vara negativt`); return v; };
  const fee = n('fee', 'Påminnelseavgift', 6000);
  if (fee > 6000) throw new ValidationError('Påminnelseavgiften får vara högst 60 kr (lag 1981:739 om ersättning för inkassokostnader)');
  const rateRaw = String(input.reference_rate ?? '').replace(',', '.').trim();
  const rate = rateRaw === '' ? null : Number(rateRaw);
  if (rate != null && (!Number.isFinite(rate) || rate < -5 || rate > 20)) throw new ValidationError('Ogiltig referensränta');
  const f = {
    first_days: n('first_days', 'Dagar till påminnelse 1', 7), second_days: n('second_days', 'Dagar till påminnelse 2', 21), collection_days: n('collection_days', 'Dagar till inkasso', 35),
    fee, reference_rate: rate, interest_extra: 8, fee_account: n('fee_account', 'Konto för avgift', 3990), interest_account: n('interest_account', 'Konto för ränta', 8313),
    auto_remind: input.auto_remind === true || input.auto_remind === 'on' || input.auto_remind === 'true', message: str(input, 'message'),
  };
  if (!(f.first_days < f.second_days && f.second_days < f.collection_days)) throw new ValidationError('Dagarna måste öka: påminnelse 1 < påminnelse 2 < inkasso');
  await sql`INSERT INTO rk_settings ${sql({ ...f, company_id: actor.companyId })} ON CONFLICT (company_id) DO UPDATE SET ${sql(f)}`;
  await auditBy(sql, actor, 'settings', 'reskontra', 0);
}

export const interestRate = (s: Settings) => (s.reference_rate == null ? 0 : Math.max(0, s.reference_rate + s.interest_extra));

// ---------- Öppna fakturor och åldersanalys ----------

export interface OpenInvoice {
  id: number; number: number; customer_id: number; customer: string; email: string; invoice_date: string; due_date: string; total: number; days_overdue: number;
  levels: number[]; last_reminder: string | null; in_collection: boolean; interest: number; action: ReturnType<typeof nextAction>;
}

export async function openInvoices(companyId: number, f: { customer_id?: number } = {}, at = today()): Promise<OpenInvoice[]> {
  const s = await settings(sql, companyId);
  const rows = await sql<Omit<OpenInvoice, 'days_overdue' | 'interest' | 'action'>[]>`
    SELECT i.id, i.invoice_number AS number, i.customer_id, c.name AS customer, c.email, to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date,
      to_char(i.due_date,'YYYY-MM-DD') AS due_date, i.total::bigint AS total,
      COALESCE((SELECT array_agg(level ORDER BY level) FROM rk_reminders r WHERE r.invoice_id = i.id), '{}') AS levels,
      (SELECT to_char(max(date),'YYYY-MM-DD') FROM rk_reminders r WHERE r.invoice_id = i.id) AS last_reminder,
      EXISTS (SELECT 1 FROM rk_collections k WHERE k.invoice_id = i.id) AS in_collection
    FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.company_id = ${companyId} AND i.status = 'booked' AND i.total > 0 ${f.customer_id ? sql`AND i.customer_id = ${f.customer_id}` : sql``}
    ORDER BY i.due_date, i.invoice_number`;
  return rows.map((r) => {
    const total = Number(r.total), days = daysBetween(r.due_date, at);
    return { ...r, total, days_overdue: Math.max(0, days), interest: lateInterest(total, r.due_date, at, interestRate(s)), action: nextAction(Math.max(0, days), r.levels, r.in_collection, s) };
  });
}

export async function agingReport(companyId: number, at = today()) {
  const open = await openInvoices(companyId, {}, at);
  const customers = new Map<number, { customer: string; items: { due_date: string; amount: number }[] }>();
  for (const i of open) {
    const c = customers.get(i.customer_id) ?? { customer: i.customer, items: [] };
    c.items.push({ due_date: i.due_date, amount: i.total });
    customers.set(i.customer_id, c);
  }
  return {
    total: aging(open.map((i) => ({ due_date: i.due_date, amount: i.total })), at),
    customers: [...customers.entries()].map(([id, c]) => ({ customer_id: id, customer: c.customer, ...aging(c.items, at) })).sort((a, b) => b.total - a.total),
    open,
  };
}

/** Kundreskontra för en kund: fakturor, krediteringar och betalningar med löpande saldo */
export async function customerLedger(companyId: number, customerId: number) {
  const rows = await sql<{ date: string; text: string; amount: number; invoice_id: number }[]>`
    SELECT to_char(invoice_date,'YYYY-MM-DD') AS date, CASE WHEN credit_of_id IS NULL THEN 'Faktura ' ELSE 'Kreditfaktura ' END || invoice_number AS text, total::bigint AS amount, id AS invoice_id
      FROM invoices WHERE company_id = ${companyId} AND customer_id = ${customerId} AND status IN ('booked', 'paid', 'credited') AND total <> 0
    UNION ALL
    SELECT to_char(paid_date,'YYYY-MM-DD'), 'Betalning faktura ' || invoice_number, -total::bigint, id
      FROM invoices WHERE company_id = ${companyId} AND customer_id = ${customerId} AND status = 'paid' AND credit_of_id IS NULL AND paid_date IS NOT NULL AND total <> 0
    ORDER BY 1, 2`;
  let balance = 0;
  return rows.map((r) => { balance += Number(r.amount); return { ...r, amount: Number(r.amount), balance }; });
}

// ---------- Påminnelser ----------

function reminderText(o: { company: string; customer: string; number: number; invoice_date: string; due_date: string; total: number; fee: number; interest: number; level: number; bankgiro: string; ocr: string | null; message: string }) {
  return [
    `${o.level === 1 ? 'Påminnelse' : 'Andra påminnelsen'}: faktura ${o.number} från ${o.company}`,
    '',
    `Hej ${o.customer},`,
    '',
    `Enligt vår bokföring är faktura ${o.number} (fakturadatum ${o.invoice_date}) på ${formatAmount(o.total)} kr fortfarande obetald. Förfallodagen var ${o.due_date}.`,
    o.fee ? `En påminnelseavgift på ${formatAmount(o.fee)} kr tillkommer.` : '',
    o.interest ? `Dröjsmålsränta enligt räntelagen har hittills uppgått till ${formatAmount(o.interest)} kr och debiteras separat.` : '',
    '',
    `Vänligen betala ${formatAmount(o.total)} kr snarast till bankgiro ${o.bankgiro || '–'}${o.ocr ? ` med OCR ${o.ocr}` : ''}.`,
    o.level === 2 ? 'Om betalning inte sker kan fordran komma att lämnas till inkasso.' : 'Har du redan betalat kan du bortse från denna påminnelse.',
    o.message ? `\n${o.message}` : '',
    '',
    `Med vänliga hälsningar\n${o.company}`,
  ].filter((x) => x !== '').join('\n');
}

export async function createReminder(actor: Actor, invoiceId: number, opts: { email?: boolean } = {}) {
  const s = await settings(sql, actor.companyId);
  const [inv] = (await openInvoices(actor.companyId)).filter((i) => i.id === invoiceId);
  if (!inv) throw new ValidationError('Fakturan är inte obetald');
  if (inv.days_overdue <= 0) throw new ValidationError('Fakturan har inte förfallit');
  if (inv.in_collection) throw new ConflictError('Fakturan är lämnad till inkasso');
  const level = inv.levels.includes(1) ? 2 : 1;
  if (inv.levels.includes(2)) throw new ConflictError('Två påminnelser är redan skickade – överväg inkasso');
  const [co] = await sql<{ name: string; bankgiro: string }[]>`SELECT name, bankgiro FROM companies WHERE id = ${actor.companyId}`;
  const [ocr] = await sql<{ ocr: string | null }[]>`SELECT ocr FROM invoices WHERE id = ${invoiceId}`;
  const text = reminderText({ company: co.name, customer: inv.customer, number: inv.number, invoice_date: inv.invoice_date, due_date: inv.due_date, total: inv.total,
    fee: s.fee, interest: inv.interest, level, bankgiro: co.bankgiro, ocr: ocr.ocr, message: s.message });
  let emailed: string | null = null;
  if (opts.email && inv.email && (await sendMail(inv.email, text.split('\n')[0], text))) emailed = inv.email;
  const [{ id }] = await sql<{ id: number }[]>`INSERT INTO rk_reminders (company_id, invoice_id, level, date, fee, interest, emailed_to, created_by)
    VALUES (${actor.companyId}, ${invoiceId}, ${level}, ${today()}, ${s.fee}, ${inv.interest}, ${emailed}, ${actor.userId}) RETURNING id`;
  await auditBy(sql, actor, 'reminder', 'invoice', invoiceId, { level, emailed });
  await sql.begin((tx) => emit(tx, actor.companyId, 'reskontra.reminder.created', { id, invoice_id: invoiceId, level, emailed_to: emailed }));
  return { id, level, emailed, text };
}

export async function reminderLetter(companyId: number, reminderId: number) {
  const [r] = await sql<{ invoice_id: number; level: number; date: string; fee: number; interest: number }[]>`
    SELECT invoice_id, level, to_char(date,'YYYY-MM-DD') AS date, fee::bigint AS fee, interest::bigint AS interest FROM rk_reminders WHERE id = ${reminderId} AND company_id = ${companyId}`;
  if (!r) throw new NotFoundError('Påminnelsen');
  const [i] = await sql<{ number: number; customer: string; invoice_date: string; due_date: string; total: number; ocr: string | null; address: string; postal: string; city: string }[]>`
    SELECT i.invoice_number AS number, c.name AS customer, to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date, to_char(i.due_date,'YYYY-MM-DD') AS due_date, i.total::bigint AS total, i.ocr,
      c.address, c.postal_code AS postal, c.city FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${r.invoice_id}`;
  const [co] = await sql<{ name: string; bankgiro: string }[]>`SELECT name, bankgiro FROM companies WHERE id = ${companyId}`;
  const s = await settings(sql, companyId);
  return { ...r, fee: Number(r.fee), interest: Number(r.interest), invoice: { ...i, total: Number(i.total) },
    text: reminderText({ company: co.name, customer: i.customer, number: i.number, invoice_date: i.invoice_date, due_date: i.due_date, total: Number(i.total), fee: Number(r.fee), interest: Number(r.interest), level: r.level, bankgiro: co.bankgiro, ocr: i.ocr, message: s.message }) };
}

/** Faktura för påminnelseavgifter och dröjsmålsränta (utan moms) för en kund */
export async function chargeFees(actor: Actor, customerId: number) {
  const s = await settings(sql, actor.companyId);
  return sql.begin(async (tx) => {
    const rem = await tx<{ id: number; fee: number; interest: number; number: number; level: number }[]>`
      SELECT r.id, r.fee::bigint AS fee, r.interest::bigint AS interest, i.invoice_number AS number, r.level FROM rk_reminders r JOIN invoices i ON i.id = r.invoice_id
      WHERE r.company_id = ${actor.companyId} AND i.customer_id = ${customerId} AND r.charge_invoice_id IS NULL AND (r.fee > 0 OR r.interest > 0) ORDER BY r.id FOR UPDATE OF r`;
    if (!rem.length) throw new ValidationError('Inga avgifter eller räntor att fakturera');
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${s.fee_account}, 'Påminnelseavgifter'), (${actor.companyId}, ${s.interest_account}, 'Ränteintäkter från kundfordringar')
      ON CONFLICT (company_id, number) DO NOTHING`;
    // Ränta tas bara med från senaste påminnelsen per faktura (den är beräknad till och med det datumet)
    const latest = new Map<number, typeof rem[number]>();
    for (const r of rem) latest.set(r.number, r);
    const lines = [
      ...rem.filter((r) => Number(r.fee) > 0).map((r) => ({ description: `Påminnelseavgift faktura ${r.number} (påminnelse ${r.level})`, quantity: 1, unit: 'st', unit_price: Number(r.fee), vat_rate: 0, account: s.fee_account })),
      ...[...latest.values()].filter((r) => Number(r.interest) > 0).map((r) => ({ description: `Dröjsmålsränta faktura ${r.number}`, quantity: 1, unit: 'st', unit_price: Number(r.interest), vat_rate: 0, account: s.interest_account })),
    ];
    const inv = await saveDraftTx(tx, actor, null, { customer_id: customerId, invoice_date: today(), notes: 'Påminnelseavgift och dröjsmålsränta enligt räntelagen. Momsfritt.', lines });
    await tx`UPDATE rk_reminders SET charge_invoice_id = ${inv.id} WHERE id IN ${tx(rem.map((r) => r.id))}`;
    await auditBy(tx, actor, 'charge_fees', 'customer', customerId, { invoice: inv.id });
    return inv;
  });
}

export async function markCollection(actor: Actor, invoiceId: number, note: string) {
  const [i] = await sql`SELECT 1 FROM invoices WHERE id = ${invoiceId} AND company_id = ${actor.companyId} AND status = 'booked'`;
  if (!i) throw new ValidationError('Fakturan är inte obetald');
  await sql`INSERT INTO rk_collections (invoice_id, company_id, date, note, created_by) VALUES (${invoiceId}, ${actor.companyId}, ${today()}, ${note}, ${actor.userId})
    ON CONFLICT (invoice_id) DO UPDATE SET note = EXCLUDED.note`;
  await auditBy(sql, actor, 'collection', 'invoice', invoiceId);
}

export async function unmarkCollection(actor: Actor, invoiceId: number) {
  await sql`DELETE FROM rk_collections WHERE invoice_id = ${invoiceId} AND company_id = ${actor.companyId}`;
  await auditBy(sql, actor, 'collection_undo', 'invoice', invoiceId);
}

/** Skapar alla påminnelser som står på tur (används av knappen och nattkörningen) */
export async function remindDue(actor: Actor, email: boolean) {
  const due = (await openInvoices(actor.companyId)).filter((i) => i.action === 'reminder1' || i.action === 'reminder2');
  const out: { invoice: number; level: number; emailed: string | null }[] = [];
  for (const i of due) {
    const r = await createReminder(actor, i.id, { email });
    out.push({ invoice: i.number, level: r.level, emailed: r.emailed });
  }
  return out;
}

/** Cron: automatiska påminnelser för bolag som har aktiverat det */
export async function remindAll() {
  const companies = await sql<{ company_id: number; user_id: number }[]>`
    SELECT DISTINCT ON (s.company_id) s.company_id, m.user_id FROM rk_settings s
    JOIN company_modules cm ON cm.company_id = s.company_id AND cm.module_id = 'reskontra'
    JOIN memberships m ON m.company_id = s.company_id AND m.role = 'owner'
    WHERE s.auto_remind ORDER BY s.company_id, m.user_id`;
  let n = 0;
  for (const c of companies) n += (await remindDue({ companyId: c.company_id, userId: c.user_id, apiKeyId: null, role: 'owner' }, true)).length;
  return { reminders: n };
}

export async function remindersFor(companyId: number, invoiceId?: number) {
  return sql<{ id: number; invoice_id: number; number: number; customer: string; level: number; date: string; fee: number; interest: number; emailed_to: string | null; charge_invoice_id: number | null }[]>`
    SELECT r.id, r.invoice_id, i.invoice_number AS number, c.name AS customer, r.level, to_char(r.date,'YYYY-MM-DD') AS date, r.fee::bigint AS fee, r.interest::bigint AS interest, r.emailed_to, r.charge_invoice_id
    FROM rk_reminders r JOIN invoices i ON i.id = r.invoice_id JOIN customers c ON c.id = i.customer_id
    WHERE r.company_id = ${companyId} ${invoiceId ? sql`AND r.invoice_id = ${invoiceId}` : sql``} ORDER BY r.date DESC, r.id DESC LIMIT 200`;
}


