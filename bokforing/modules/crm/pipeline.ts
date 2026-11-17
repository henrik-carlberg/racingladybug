import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { formatAmount } from '@/lib/money';
import { computeInvoice, type InvoiceLineInput } from '@/lib/invoice';
import { today } from '@/lib/format';
import type { Actor } from '@/lib/services/actor';
import { arr, date, int, optInt, str } from '@/lib/services/input';
import { createCustomer } from '@/lib/services/customers';
import { saveDraftTx } from '@/lib/services/invoices';
import { createProject } from '@/lib/services/time';
import { createDocument, sendDocument } from '@/lib/services/documents';
import { DEFAULT_STAGES, analysis, forecast, weighted, type DealLite } from './calc';

type Db = Tx | typeof sql;

// ---------- Steg ----------

export interface Stage { id: number; name: string; probability: number; position: number; kind: 'open' | 'won' | 'lost'; active: boolean }

export async function stages(db: Db, companyId: number): Promise<Stage[]> {
  const rows = await db<Stage[]>`SELECT id, name, probability, position, kind, active FROM crm_stages WHERE company_id = ${companyId} ORDER BY position, id`;
  if (rows.length) return rows;
  await db`SELECT pg_advisory_xact_lock(${companyId}, 31)`.catch(() => undefined);
  const again = await db<Stage[]>`SELECT id FROM crm_stages WHERE company_id = ${companyId}`;
  if (!again.length) {
    await db`INSERT INTO crm_stages ${db(DEFAULT_STAGES.map((s, i) => ({ ...s, company_id: companyId, position: (i + 1) * 10 })))}`;
  }
  return db<Stage[]>`SELECT id, name, probability, position, kind, active FROM crm_stages WHERE company_id = ${companyId} ORDER BY position, id`;
}

export async function saveStage(actor: Actor, id: number | null, input: Record<string, unknown>) {
  const probability = optInt(input, 'probability', 'Sannolikhet') ?? 0;
  if (probability < 0 || probability > 100) throw new ValidationError('Sannolikhet ska vara 0–100 %');
  const f = { name: str(input, 'name', { required: true, label: 'Namn' }), probability, position: optInt(input, 'position', 'Ordning') ?? 0,
    active: input.active == null ? true : input.active === true || input.active === 'on' };
  if (id) {
    const r = await sql`UPDATE crm_stages SET ${sql(f)} WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING kind`;
    if (!r.length) throw new NotFoundError('Steget');
  } else {
    await stages(sql, actor.companyId);
    await sql`INSERT INTO crm_stages ${sql({ ...f, company_id: actor.companyId, kind: 'open' })}`;
  }
  await auditBy(sql, actor, id ? 'update' : 'create', 'crm.stage', id ?? 0);
}

// ---------- Affärer ----------

export interface QuoteLine { description: string; quantity: number; unit: string; unit_price: number; vat_rate: number }
export interface DealOut {
  id: number; object: 'crm.deal'; title: string; customer_id: number | null; customer_name: string | null; prospect_name: string; contact_name: string; contact_email: string;
  account: string; value: number; stage_id: number; stage: string; kind: 'open' | 'won' | 'lost'; probability: number; weighted: number;
  expected_close: string | null; owner_user_id: number | null; owner: string | null; source: string; next_step: string; lost_reason: string; closed_at: string | null;
  quote_valid_to: string | null; quote_notes: string; document_id: number | null; document_status: string | null; invoice_id: number | null; project_id: number | null;
  created_at: string; updated_at: string; lines: QuoteLine[]; quote: { net: number; vat: number; total: number };
}

const DCOLS = (db: Db) => db`d.id, 'crm.deal' AS object, d.title, d.customer_id, c.name AS customer_name, d.prospect_name, d.contact_name, d.contact_email,
  d.value::bigint AS value, d.stage_id, s.name AS stage, s.kind, COALESCE(d.probability, s.probability) AS probability,
  to_char(d.expected_close,'YYYY-MM-DD') AS expected_close, d.owner_user_id, u.name AS owner, d.source, d.next_step, d.lost_reason,
  to_char(d.closed_at,'YYYY-MM-DD') AS closed_at, to_char(d.quote_valid_to,'YYYY-MM-DD') AS quote_valid_to, d.quote_notes, d.document_id, doc.status AS document_status,
  d.invoice_id, d.project_id, to_char(d.created_at,'YYYY-MM-DD') AS created_at, to_char(d.updated_at,'YYYY-MM-DD') AS updated_at`;
const DFROM = (db: Db) => db`crm_deals d JOIN crm_stages s ON s.id = d.stage_id LEFT JOIN customers c ON c.id = d.customer_id
  LEFT JOIN users u ON u.id = d.owner_user_id LEFT JOIN documents doc ON doc.id = d.document_id`;

type Row = Omit<DealOut, 'account' | 'weighted' | 'lines' | 'quote'>;
const shape = (r: Row, lines: QuoteLine[] = []): DealOut => {
  const value = Number(r.value);
  const t = lines.length ? computeInvoice(lines.map((l) => ({ ...l, unitPrice: l.unit_price, vatRate: l.vat_rate as InvoiceLineInput['vatRate'], account: 3001 }))) : { net: 0, vat: 0, total: 0 };
  return { ...r, value, account: r.customer_name ?? r.prospect_name, weighted: weighted(value, r.probability), lines, quote: { net: t.net, vat: t.vat, total: t.total } };
};

export async function getDeal(companyId: number, id: number, db: Db = sql): Promise<DealOut> {
  const [r] = await db<Row[]>`SELECT ${DCOLS(db)} FROM ${DFROM(db)} WHERE d.id = ${id} AND d.company_id = ${companyId}`;
  if (!r) throw new NotFoundError('Affären');
  const lines = await db<QuoteLine[]>`SELECT description, quantity::float8 AS quantity, unit, unit_price::int AS unit_price, vat_rate FROM crm_quote_lines WHERE deal_id = ${id} ORDER BY position`;
  return shape(r, lines);
}

export async function listDeals(companyId: number, f: { kind?: string; owner?: number; customer_id?: number; since?: string } = {}): Promise<DealOut[]> {
  await stages(sql, companyId);
  const rows = await sql<Row[]>`SELECT ${DCOLS(sql)} FROM ${DFROM(sql)} WHERE d.company_id = ${companyId}
    ${f.kind ? sql`AND s.kind = ${f.kind}` : sql``} ${f.owner ? sql`AND d.owner_user_id = ${f.owner}` : sql``}
    ${f.customer_id ? sql`AND d.customer_id = ${f.customer_id}` : sql``} ${f.since ? sql`AND (s.kind = 'open' OR d.closed_at >= ${f.since})` : sql``}
    ORDER BY d.expected_close NULLS LAST, d.id`;
  return rows.map((r) => shape(r));
}

async function stageOf(db: Db, companyId: number, id: number) {
  const [s] = await db<Stage[]>`SELECT id, name, probability, position, kind, active FROM crm_stages WHERE id = ${id} AND company_id = ${companyId}`;
  if (!s) throw new ValidationError('Steget finns inte');
  return s;
}

async function assertUser(db: Db, companyId: number, userId: number | null) {
  if (!userId) return;
  const [m] = await db`SELECT 1 FROM memberships WHERE company_id = ${companyId} AND user_id = ${userId}`;
  if (!m) throw new ValidationError('Säljansvarig måste vara användare i bolaget');
}

function readDeal(input: Record<string, unknown>) {
  const value = optInt(input, 'value', 'Värde') ?? 0;
  if (value < 0) throw new ValidationError('Värdet kan inte vara negativt');
  const prob = input.probability == null || input.probability === '' ? null : optInt(input, 'probability', 'Sannolikhet');
  if (prob != null && (prob < 0 || prob > 100)) throw new ValidationError('Sannolikhet ska vara 0–100 %');
  const email = str(input, 'contact_email');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError('Ogiltig e-postadress');
  return {
    title: str(input, 'title', { required: true, label: 'Affär' }), customer_id: optInt(input, 'customer_id', 'Kund'), prospect_name: str(input, 'prospect_name'),
    contact_name: str(input, 'contact_name'), contact_email: email, value, probability: prob, expected_close: date(input, 'expected_close', 'Förväntat avslut', false) || null,
    owner_user_id: optInt(input, 'owner_user_id', 'Säljansvarig'), source: str(input, 'source'), next_step: str(input, 'next_step'),
  };
}

export async function createDeal(actor: Actor, input: Record<string, unknown>): Promise<DealOut> {
  const f = readDeal(input);
  if (!f.customer_id && !f.prospect_name) throw new ValidationError('Välj en kund eller ange företagets namn');
  return sql.begin(async (tx) => {
    if (f.customer_id) {
      const [c] = await tx`SELECT 1 FROM customers WHERE id = ${f.customer_id} AND company_id = ${actor.companyId}`;
      if (!c) throw new ValidationError('Kunden finns inte');
    }
    await assertUser(tx, actor.companyId, f.owner_user_id);
    const st = await stages(tx, actor.companyId);
    const stageId = optInt(input, 'stage_id', 'Steg') ?? st.find((s) => s.kind === 'open' && s.active)!.id;
    const s = await stageOf(tx, actor.companyId, stageId);
    if (s.kind !== 'open') throw new ValidationError('En ny affär måste börja i ett öppet steg');
    const [{ id }] = await tx<{ id: number }[]>`INSERT INTO crm_deals ${tx({ ...f, stage_id: stageId, owner_user_id: f.owner_user_id ?? actor.userId, company_id: actor.companyId, created_by: actor.userId })} RETURNING id`;
    await tx`INSERT INTO crm_stage_history (deal_id, to_stage, changed_by) VALUES (${id}, ${stageId}, ${actor.userId})`;
    await auditBy(tx, actor, 'create', 'crm.deal', id);
    const out = await getDeal(actor.companyId, id, tx);
    await emit(tx, actor.companyId, 'crm.deal.created', out);
    return out;
  });
}

export async function updateDeal(actor: Actor, id: number, input: Record<string, unknown>): Promise<DealOut> {
  const f = readDeal(input);
  return sql.begin(async (tx) => {
    const cur = await getDeal(actor.companyId, id, tx);
    if (!f.customer_id && !f.prospect_name && !cur.customer_id) throw new ValidationError('Välj en kund eller ange företagets namn');
    await assertUser(tx, actor.companyId, f.owner_user_id);
    await tx`UPDATE crm_deals SET ${tx({ ...f, customer_id: f.customer_id ?? cur.customer_id })}, updated_at = now() WHERE id = ${id}`;
    await auditBy(tx, actor, 'update', 'crm.deal', id);
    return getDeal(actor.companyId, id, tx);
  });
}

async function logDeal(tx: Tx, actor: Actor, d: { id: number; customer_id: number | null }, subject: string) {
  await tx`INSERT INTO crm_activities (company_id, customer_id, deal_id, kind, subject, created_by) VALUES (${actor.companyId}, ${d.customer_id}, ${d.id}, 'system', ${subject}, ${actor.userId})`;
}

/** Flyttar affären till ett steg. Vunnen kräver kund (skapas från prospektet), förlorad kräver orsak. */
export async function moveDeal(actor: Actor, id: number, input: Record<string, unknown>): Promise<DealOut> {
  return sql.begin(async (tx) => moveDealTx(tx, actor, id, input));
}

async function moveDealTx(tx: Tx, actor: Actor, id: number, input: Record<string, unknown>): Promise<DealOut> {
  await tx`SELECT id FROM crm_deals WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
  const d = await getDeal(actor.companyId, id, tx);
  const s = await stageOf(tx, actor.companyId, int(input, 'stage_id', 'Steg'));
  if (s.id === d.stage_id) return d;
  let customerId = d.customer_id;
  if (s.kind === 'won' && !customerId) {
    const c = await createCustomer(actor, { name: d.prospect_name, email: d.contact_email });
    customerId = c.id;
  }
  const reason = str(input, 'lost_reason');
  if (s.kind === 'lost' && !reason) throw new ValidationError('Ange varför affären förlorades');
  await tx`UPDATE crm_deals SET stage_id = ${s.id}, customer_id = ${customerId}, probability = NULL, lost_reason = ${s.kind === 'lost' ? reason : ''},
    closed_at = ${s.kind === 'open' ? null : today()}, updated_at = now() WHERE id = ${id}`;
  await tx`INSERT INTO crm_stage_history (deal_id, from_stage, to_stage, changed_by) VALUES (${id}, ${d.stage_id}, ${s.id}, ${actor.userId})`;
  await logDeal(tx, actor, { id, customer_id: customerId }, `Affären "${d.title}" flyttad till ${s.name}${s.kind === 'lost' ? ` (${reason})` : ''}`);
  await auditBy(tx, actor, 'move', 'crm.deal', id, { to: s.name });
  const out = await getDeal(actor.companyId, id, tx);
  if (s.kind !== 'open') await emit(tx, actor.companyId, s.kind === 'won' ? 'crm.deal.won' : 'crm.deal.lost', out);
  return out;
}

// ---------- Offert ----------

export async function saveQuote(actor: Actor, id: number, input: Record<string, unknown>): Promise<DealOut> {
  const lines = arr(input, 'lines', 'Offertrader').map((r, i) => {
    const quantity = Number(String(r.quantity ?? '1').replace(',', '.')) || 0;
    const vat = optInt(r, 'vat_rate', 'Moms') ?? 25;
    if (![0, 6, 12, 25].includes(vat)) throw new ValidationError('Momssats måste vara 0, 6, 12 eller 25');
    if (quantity <= 0) throw new ValidationError(`Rad ${i + 1}: ogiltigt antal`);
    return { description: str(r, 'description', { required: true, label: `Rad ${i + 1}` }), quantity, unit: str(r, 'unit') || 'st', unit_price: int(r, 'unit_price', `Rad ${i + 1}: pris`), vat_rate: vat };
  });
  return sql.begin(async (tx) => {
    const d = await getDeal(actor.companyId, id, tx);
    if (d.kind !== 'open') throw new ConflictError('Affären är avslutad');
    if (d.document_status === 'pending') throw new ConflictError('Offerten är skickad för signering – återkalla den under Dokument för att ändra');
    await tx`DELETE FROM crm_quote_lines WHERE deal_id = ${id}`;
    if (lines.length) await tx`INSERT INTO crm_quote_lines ${tx(lines.map((l, i) => ({ ...l, deal_id: id, position: i + 1 })))}`;
    const t = computeInvoice(lines.map((l) => ({ ...l, unitPrice: l.unit_price, vatRate: l.vat_rate as InvoiceLineInput['vatRate'], account: 3001 })));
    await tx`UPDATE crm_deals SET quote_valid_to = ${date(input, 'valid_to', 'Giltig till', false) || null}, quote_notes = ${str(input, 'notes')},
      value = ${lines.length ? t.net : tx`value`}, updated_at = now() WHERE id = ${id}`;
    await auditBy(tx, actor, 'quote', 'crm.deal', id);
    return getDeal(actor.companyId, id, tx);
  });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function quoteHtml(d: DealOut, co: { name: string; orgnr: string; address: string; postal_code: string; city: string; email: string; phone: string; f_skatt: boolean }) {
  const rows = d.lines.map((l) => `<tr><td>${esc(l.description)}</td><td style="text-align:right">${String(l.quantity).replace('.', ',')} ${esc(l.unit)}</td>
    <td style="text-align:right">${formatAmount(l.unit_price)}</td><td style="text-align:right">${l.vat_rate} %</td><td style="text-align:right">${formatAmount(Math.round(l.quantity * l.unit_price))}</td></tr>`).join('');
  return `<h1>Offert</h1>
<p><b>${esc(co.name)}</b> · Org.nr ${esc(co.orgnr)}<br>${esc(co.address)}, ${esc(co.postal_code)} ${esc(co.city)}<br>${esc(co.email)} ${esc(co.phone)}</p>
<p><b>Till:</b> ${esc(d.account)}${d.contact_name ? `, ${esc(d.contact_name)}` : ''}<br><b>Avser:</b> ${esc(d.title)}<br><b>Datum:</b> ${today()}${d.quote_valid_to ? `<br><b>Giltig till:</b> ${d.quote_valid_to}` : ''}</p>
<table><thead><tr><th>Beskrivning</th><th style="text-align:right">Antal</th><th style="text-align:right">À-pris</th><th style="text-align:right">Moms</th><th style="text-align:right">Belopp</th></tr></thead><tbody>${rows}</tbody></table>
<p style="text-align:right">Summa exkl. moms: ${formatAmount(d.quote.net)} kr<br>Moms: ${formatAmount(d.quote.vat)} kr<br><b>Totalt: ${formatAmount(d.quote.total)} kr</b></p>
${d.quote_notes ? `<p>${esc(d.quote_notes)}</p>` : ''}
<p>${co.f_skatt ? 'Godkänd för F-skatt. ' : ''}Genom att signera godkänner ni offerten och beställer enligt ovan.</p>`;
}

/** Skickar offerten för e-signering till kontaktpersonen. När den signeras markeras affären som vunnen. */
export async function sendQuote(actor: Actor, id: number, origin: string): Promise<DealOut> {
  const d = await getDeal(actor.companyId, id);
  if (d.kind !== 'open') throw new ConflictError('Affären är avslutad');
  if (!d.lines.length) throw new ValidationError('Lägg till offertrader först');
  if (!d.contact_name || !d.contact_email) throw new ValidationError('Ange kontaktperson med e-post som ska signera offerten');
  if (d.document_status === 'pending') throw new ConflictError('Offerten är redan skickad');
  const [co] = await sql<{ name: string; orgnr: string; address: string; postal_code: string; city: string; email: string; phone: string; f_skatt: boolean }[]>`
    SELECT name, orgnr, address, postal_code, city, email, phone, f_skatt FROM companies WHERE id = ${actor.companyId}`;
  return sql.begin(async (tx) => {
    const doc = await createDocument(actor, {
      title: `Offert – ${d.title} (${d.account})`, html: quoteHtml(d, co), source_module: 'crm', source_id: id,
      signers: [{ name: d.contact_name, email: d.contact_email }],
    }, tx);
    await sendDocument(actor, doc.id, origin, tx);
    const sent = (await stages(tx, actor.companyId)).find((s) => s.kind === 'open' && s.name.toLowerCase().includes('offert'));
    await tx`UPDATE crm_deals SET document_id = ${doc.id}, updated_at = now() WHERE id = ${id}`;
    await logDeal(tx, actor, d, `Offert skickad för signering till ${d.contact_name} (${formatAmount(d.quote.total)} kr inkl. moms)`);
    if (sent && sent.id !== d.stage_id) await moveDealTx(tx, actor, id, { stage_id: sent.id });
    return getDeal(actor.companyId, id, tx);
  });
}

/** Lyssnare: signerad offert → affären vunnen */
export async function onQuoteSigned(tx: Tx, companyId: number, dealId: number) {
  const [d] = await tx<{ id: number; created_by: number; kind: string }[]>`SELECT d.id, d.created_by, s.kind FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id
    WHERE d.id = ${dealId} AND d.company_id = ${companyId}`;
  if (!d || d.kind !== 'open') return;
  const won = (await stages(tx, companyId)).find((s) => s.kind === 'won');
  if (!won) return;
  await moveDealTx(tx, { companyId, userId: d.created_by, apiKeyId: null, role: 'owner' }, dealId, { stage_id: won.id });
}

/** Vunnen affär → fakturautkast från offertraderna (eller en rad med affärens värde) */
export async function invoiceDeal(actor: Actor, id: number) {
  return sql.begin(async (tx) => {
    const d = await getDeal(actor.companyId, id, tx);
    if (d.kind !== 'won' || !d.customer_id) throw new ValidationError('Bara vunna affärer kan faktureras');
    if (d.invoice_id) throw new ConflictError('Affären är redan fakturerad');
    const lines = d.lines.length ? d.lines : [{ description: d.title, quantity: 1, unit: 'st', unit_price: d.value, vat_rate: 25 }];
    const inv = await saveDraftTx(tx, actor, null, { customer_id: d.customer_id, invoice_date: today(), notes: `Enligt offert/avtal: ${d.title}.`, your_reference: d.contact_name, lines });
    await tx`UPDATE crm_deals SET invoice_id = ${inv.id} WHERE id = ${id}`;
    await logDeal(tx, actor, d, 'Fakturautkast skapat från affären');
    return inv;
  });
}

/** Vunnen affär → projekt/uppdrag för leveransen */
export async function projectFromDeal(actor: Actor, id: number) {
  const d = await getDeal(actor.companyId, id);
  if (d.kind !== 'won' || !d.customer_id) throw new ValidationError('Bara vunna affärer kan bli projekt');
  if (d.project_id) throw new ConflictError('Det finns redan ett projekt för affären');
  const p = await createProject(actor, { customer_id: d.customer_id, name: d.title, billing: 'fixed', activities: 'Projektarbete' });
  await sql`UPDATE crm_deals SET project_id = ${p.id} WHERE id = ${id}`;
  try {
    await sql`INSERT INTO proj_details (project_id, company_id, status, start_date, budget_revenue, manager_user_id)
      VALUES (${p.id}, ${actor.companyId}, 'active', ${today()}, ${d.value}, ${d.owner_user_id}) ON CONFLICT DO NOTHING`;
  } catch { /* projektmodulens tabeller saknas – uppdraget räcker */ }
  return p;
}

// ---------- Aktiviteter, prognos och analys ----------

export async function dealActivities(companyId: number, dealId: number) {
  return sql<{ id: number; kind: string; subject: string; body: string; due_date: string | null; done: boolean; created_by: string | null; created_at: string }[]>`
    SELECT a.id, a.kind, a.subject, a.body, to_char(a.due_date,'YYYY-MM-DD') AS due_date, a.done, u.name AS created_by, to_char(a.created_at,'YYYY-MM-DD') AS created_at
    FROM crm_activities a LEFT JOIN users u ON u.id = a.created_by WHERE a.company_id = ${companyId} AND a.deal_id = ${dealId} ORDER BY a.created_at DESC, a.id DESC`;
}

export async function addDealActivity(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = await getDeal(actor.companyId, id);
  const kind = str(input, 'kind') || 'note';
  if (!['note', 'call', 'meeting', 'email', 'task'].includes(kind)) throw new ValidationError('Ogiltig typ');
  await sql`INSERT INTO crm_activities (company_id, customer_id, deal_id, kind, subject, body, due_date, created_by) VALUES (${actor.companyId}, ${d.customer_id}, ${id}, ${kind},
    ${str(input, 'subject', { required: true, label: 'Rubrik' })}, ${str(input, 'body')}, ${date(input, 'due_date', 'Datum', false) || null}, ${actor.userId})`;
  await sql`UPDATE crm_deals SET updated_at = now() WHERE id = ${id}`;
}

const lite = (d: DealOut): DealLite => ({ value: d.value, probability: d.probability, kind: d.kind, expected_close: d.expected_close, created: d.created_at, closed_at: d.closed_at, lost_reason: d.lost_reason, owner: d.owner });

export async function report(companyId: number, months = 6) {
  const t = today();
  const since = `${Number(t.slice(0, 4)) - 1}${t.slice(4)}`;
  const deals = await listDeals(companyId, { since });
  const open = deals.filter((d) => d.kind === 'open');
  return {
    open: open.length, pipeline: open.reduce((s, d) => s + d.value, 0), weighted: open.reduce((s, d) => s + d.weighted, 0),
    forecast: forecast(deals.map(lite), t.slice(0, 7), months), analysis: analysis(deals.filter((d) => d.kind !== 'open').map(lite)),
    stale: open.filter((d) => d.updated_at < new Date(Date.parse(t) - 21 * 86400000).toISOString().slice(0, 10)),
    overdue: open.filter((d) => d.expected_close && d.expected_close < t),
  };
}

export async function users(companyId: number) {
  return sql<{ id: number; name: string }[]>`SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ${companyId} ORDER BY u.name`;
}
