import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { sendMail } from '@/lib/server/mail';
import { lockChecks, type LockCheck } from './lockcheck';
import { requireFirm } from './firms';

const lastDay = (period: string) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
export const prevPeriod = (today: string) => { const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)); return d.toISOString().slice(0, 7); };
const validPeriod = (p: string) => { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) throw new ValidationError('Ogiltig månad'); return p; };

async function requireClient(userId: number, firmId: number, companyId: number) {
  await requireFirm(userId, firmId);
  const [c] = await sql<{ name: string; hourly_rate: number | null }[]>`SELECT c.name, fc.hourly_rate FROM firm_clients fc JOIN companies c ON c.id = fc.company_id WHERE fc.firm_id = ${firmId} AND fc.company_id = ${companyId}`;
  if (!c) throw new NotFoundError('Klienten');
  return c;
}

/** Checklistan för en klient och månad: kontrollerna inför periodlås plus lön och underlag som kunden ska skicka */
export async function monthChecks(companyId: number, period: string): Promise<LockCheck[]> {
  const until = lastDay(period);
  const checks = await lockChecks(companyId, until);
  const [x] = await sql<{ employees: number; payroll: number; docs: number }[]>`SELECT
    (SELECT count(*)::int FROM employees WHERE company_id = ${companyId} AND (employment_end IS NULL OR employment_end >= ${period + '-01'})) AS employees,
    (SELECT count(*)::int FROM payroll_runs WHERE company_id = ${companyId} AND period = ${period} AND status = 'booked') AS payroll,
    (SELECT count(*)::int FROM client_questions WHERE company_id = ${companyId} AND status = 'open' AND needs_document) AS docs`;
  const b = `/c/${companyId}`;
  if (x.employees) checks.push({ key: 'payroll', ok: x.payroll > 0, title: 'Lönen är bokförd', detail: x.payroll ? 'Lönekörningen för månaden är bokförd' : `Ingen bokförd lönekörning för ${period}`, href: `${b}/lon` });
  checks.push({ key: 'docs', ok: !x.docs, title: 'Kunden har skickat begärda underlag', detail: x.docs ? `${x.docs} underlag väntar på kunden` : 'Inga underlag väntar', href: `${b}/fragor` });
  return checks;
}

export interface CloseRow { id: number; name: string; responsible: string | null; ok: number; total: number; waiting: number; done: string | null; doneBy: string | null; reminded: string | null; checks: LockCheck[] }

/** Alla klienters månadsbokslut för en period */
export async function firmMonth(userId: number, firmId: number, period: string): Promise<CloseRow[]> {
  await requireFirm(userId, firmId);
  validPeriod(period);
  const clients = await sql<{ id: number; name: string; responsible: string | null; done: string | null; done_by: string | null; reminded: string | null }[]>`
    SELECT c.id, c.name, u.name AS responsible, to_char(mc.done_at,'YYYY-MM-DD') AS done, d.name AS done_by, to_char(mc.reminded_at,'YYYY-MM-DD') AS reminded
    FROM firm_clients fc JOIN companies c ON c.id = fc.company_id LEFT JOIN users u ON u.id = fc.responsible
      LEFT JOIN month_closes mc ON mc.firm_id = fc.firm_id AND mc.company_id = c.id AND mc.period = ${period} LEFT JOIN users d ON d.id = mc.done_by
    WHERE fc.firm_id = ${firmId} ORDER BY c.name`;
  return Promise.all(clients.map(async (c) => {
    const checks = await monthChecks(c.id, period);
    return { id: c.id, name: c.name, responsible: c.responsible, ok: checks.filter((k) => k.ok).length, total: checks.length, waiting: checks.filter((k) => !k.ok && ['docs', 'attachments'].includes(k.key)).length, done: c.done, doneBy: c.done_by, reminded: c.reminded, checks };
  }));
}

export async function markDone(userId: number, firmId: number, companyId: number, period: string, done: boolean) {
  await requireClient(userId, firmId, companyId);
  validPeriod(period);
  await sql`INSERT INTO month_closes (firm_id, company_id, period, done_by, done_at) VALUES (${firmId}, ${companyId}, ${period}, ${done ? userId : null}, ${done ? new Date() : null})
    ON CONFLICT (firm_id, company_id, period) DO UPDATE SET done_by = EXCLUDED.done_by, done_at = EXCLUDED.done_at`;
}

/** Ett samlat mejl till kunden med allt som saknas för månaden (underlag som begärts och verifikationer utan underlag) */
export async function remindClient(userId: number, firmId: number, companyId: number, period: string, origin: string) {
  const client = await requireClient(userId, firmId, companyId);
  validPeriod(period);
  const [f] = await sql<{ name: string }[]>`SELECT name FROM firms WHERE id = ${firmId}`;
  const docs = await sql<{ question: string }[]>`SELECT question FROM client_questions WHERE company_id = ${companyId} AND status = 'open' ORDER BY created_at LIMIT 30`;
  const noAtt = await sql<{ ver: string; date: string; description: string }[]>`
    SELECT v.series || v.number AS ver, to_char(v.date,'YYYY-MM-DD') AS date, v.description FROM vouchers v
    WHERE v.company_id = ${companyId} AND v.date <= ${lastDay(period)} AND v.date > COALESCE((SELECT locked_until FROM companies WHERE id = ${companyId}), '1900-01-01') AND v.source_type IN ('manual','receipt','supplier_invoice')
      AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.voucher_id = v.id)
      AND NOT EXISTS (SELECT 1 FROM attachments a JOIN supplier_invoices si ON si.id = a.supplier_invoice_id WHERE si.voucher_id = v.id) ORDER BY v.date LIMIT 50`;
  if (!docs.length && !noAtt.length) throw new ConflictError('Det saknas inget hos kunden för månaden');
  const owners = await sql<{ email: string; name: string }[]>`SELECT u.email, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ${companyId} AND m.role = 'owner'`;
  const text = [
    `Hej!`, '', `${f.name} behöver några saker från er för att kunna stänga bokföringen för ${period} (${client.name}).`, '',
    ...(docs.length ? ['Frågor och underlag att skicka:', ...docs.map((d) => `• ${d.question}`), ''] : []),
    ...(noAtt.length ? ['Verifikationer som saknar kvitto eller faktura (till och med månadens slut):', ...noAtt.map((v) => `• ${v.ver} ${v.date} ${v.description}`), ''] : []),
    `Svara och ladda upp underlagen här: ${origin}/c/${companyId}/fragor`, '', `Med vänliga hälsningar\n${f.name}`,
  ].join('\n');
  let sent = 0;
  for (const o of owners) if (await sendMail(o.email, `Underlag som saknas för ${period} – ${client.name}`, text)) sent++;
  await sql`INSERT INTO month_closes (firm_id, company_id, period, reminded_at) VALUES (${firmId}, ${companyId}, ${period}, now())
    ON CONFLICT (firm_id, company_id, period) DO UPDATE SET reminded_at = now()`;
  return { sent, items: docs.length + noAtt.length, text };
}

// ---------- Byråns tid ----------
export async function addTime(userId: number, firmId: number, input: { company_id: number; date: string; minutes: number; description: string }) {
  await requireClient(userId, firmId, input.company_id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ValidationError('Ogiltigt datum');
  if (!(input.minutes > 0 && input.minutes <= 1440)) throw new ValidationError('Ange tid mellan 1 minut och 24 timmar');
  await sql`INSERT INTO firm_time (firm_id, company_id, user_id, date, minutes, description) VALUES (${firmId}, ${input.company_id}, ${userId}, ${input.date}, ${input.minutes}, ${input.description.slice(0, 300)})`;
}

export async function timeSummary(userId: number, firmId: number, period: string) {
  await requireFirm(userId, firmId);
  validPeriod(period);
  return [...await sql<{ company_id: number; name: string; minutes: number; unbilled: number; rate: number | null }[]>`
    SELECT c.id AS company_id, c.name, COALESCE(SUM(t.minutes), 0)::int AS minutes, COALESCE(SUM(t.minutes) FILTER (WHERE t.invoice_id IS NULL), 0)::int AS unbilled, fc.hourly_rate AS rate
    FROM firm_clients fc JOIN companies c ON c.id = fc.company_id LEFT JOIN firm_time t ON t.firm_id = fc.firm_id AND t.company_id = c.id AND to_char(t.date,'YYYY-MM') = ${period}
    WHERE fc.firm_id = ${firmId} GROUP BY c.id, c.name, fc.hourly_rate ORDER BY c.name`].map((r) => ({ ...r, rate: r.rate == null ? null : Number(r.rate) }));
}

export async function setFirmBilling(userId: number, firmId: number, input: { own_company_id: number | null; rates: Record<number, number | null> }) {
  await requireFirm(userId, firmId, true);
  if (input.own_company_id) {
    const ok = await sql`SELECT 1 FROM memberships WHERE company_id = ${input.own_company_id} AND user_id = ${userId} AND role = 'owner'`;
    if (!ok.length) throw new ValidationError('Byråns eget bolag måste vara ett bolag där du är ägare');
  }
  await sql`UPDATE firms SET own_company_id = ${input.own_company_id} WHERE id = ${firmId}`;
  for (const [cid, rate] of Object.entries(input.rates)) await sql`UPDATE firm_clients SET hourly_rate = ${rate} WHERE firm_id = ${firmId} AND company_id = ${Number(cid)}`;
}

/** Fakturaunderlag: ofakturerad tid för klienten och månaden blir ett fakturautkast i byråns eget bolag */
export async function invoiceTime(userId: number, firmId: number, companyId: number, period: string) {
  const client = await requireClient(userId, firmId, companyId);
  validPeriod(period);
  const [f] = await sql<{ own: number | null }[]>`SELECT own_company_id AS own FROM firms WHERE id = ${firmId}`;
  if (!f.own) throw new ValidationError('Välj byråns eget bolag under Fakturering först');
  const member = await sql`SELECT 1 FROM memberships WHERE company_id = ${f.own} AND user_id = ${userId} AND role IN ('owner','accountant') AND (role = 'owner' OR permissions IS NULL OR 'invoicing' = ANY(permissions))`;
  if (!member.length) throw new ValidationError('Du behöver behörighet att fakturera i byråns eget bolag');
  if (!client.hourly_rate) throw new ValidationError('Ange timpris för klienten först');
  const entries = await sql<{ id: number; minutes: number }[]>`SELECT id, minutes FROM firm_time WHERE firm_id = ${firmId} AND company_id = ${companyId} AND invoice_id IS NULL AND to_char(date,'YYYY-MM') = ${period}`;
  if (!entries.length) throw new ConflictError('Ingen ofakturerad tid för månaden');
  const minutes = entries.reduce((s, e) => s + e.minutes, 0);
  const [co] = await sql<{ name: string; orgnr: string; email: string; address: string; postal_code: string; city: string }[]>`SELECT name, orgnr, email, address, postal_code, city FROM companies WHERE id = ${companyId}`;
  const { saveDraftTx } = await import('./invoices');
  return sql.begin(async (tx) => {
    let [cust] = await tx<{ id: number }[]>`SELECT id FROM customers WHERE company_id = ${f.own} AND (orgnr = ${co.orgnr} AND ${co.orgnr} <> '' OR name = ${co.name}) LIMIT 1`;
    if (!cust) [cust] = await tx<{ id: number }[]>`INSERT INTO customers (company_id, name, orgnr, email, address, postal_code, city) VALUES (${f.own}, ${co.name}, ${co.orgnr}, ${co.email}, ${co.address}, ${co.postal_code}, ${co.city}) RETURNING id`;
    const inv = await saveDraftTx(tx, { companyId: f.own!, userId, apiKeyId: null, role: 'owner' }, null, {
      customer_id: cust.id, invoice_date: new Date().toISOString().slice(0, 10), lines: [{ description: `Redovisningstjänster ${period}`, quantity: Math.round((minutes / 60) * 100) / 100, unit: 'h', unit_price: Number(client.hourly_rate), vat_rate: 25 }],
    });
    await tx`UPDATE firm_time SET invoice_id = ${inv.id} WHERE id IN ${tx(entries.map((e) => e.id))}`;
    return { invoiceId: inv.id, companyId: f.own!, minutes };
  });
}
