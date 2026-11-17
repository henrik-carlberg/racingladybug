import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { today } from '@/lib/format';
import type { Actor } from '@/lib/services/actor';
import { date, int, optInt, str } from '@/lib/services/input';
import { createCustomer } from '@/lib/services/customers';
import { CHANNELS, LEAD_STATUS, campaignMetrics, funnel, shouldPurge, type CampaignMetrics } from './calc';

type Db = Tx | typeof sql;
/** Konton för reklam och PR (BAS 59xx) som räknas som marknadsföringskostnad */
const MKT_FROM = 5900, MKT_TO = 5999;

// ---------- Kampanjer ----------

export interface CampaignOut {
  id: number; object: 'mkt.campaign'; name: string; channel: string; channel_label: string; start_date: string; end_date: string | null; budget: number;
  goal: string; code: string; status: 'planned' | 'active' | 'done'; cost: number; leads: number; won: number; revenue: number; metrics: CampaignMetrics;
}

async function campaigns(db: Db, companyId: number, id?: number): Promise<CampaignOut[]> {
  const rows = await db<Omit<CampaignOut, 'object' | 'channel_label' | 'metrics'>[]>`
    SELECT c.id, c.name, c.channel, to_char(c.start_date,'YYYY-MM-DD') AS start_date, to_char(c.end_date,'YYYY-MM-DD') AS end_date, c.budget::bigint AS budget, c.goal, c.code, c.status,
      COALESCE((SELECT SUM(amount) FROM mkt_costs WHERE campaign_id = c.id), 0)::bigint AS cost,
      (SELECT count(*) FROM mkt_leads WHERE campaign_id = c.id)::int AS leads,
      (SELECT count(*) FROM mkt_leads WHERE campaign_id = c.id AND status = 'won')::int AS won,
      COALESCE((SELECT SUM(i.total_net) FROM mkt_leads l JOIN invoices i ON i.customer_id = l.customer_id
        WHERE l.campaign_id = c.id AND l.status = 'won' AND i.status IN ('booked', 'paid') AND i.credit_of_id IS NULL AND i.invoice_date >= COALESCE(l.won_at, l.created_at::date)), 0)::bigint AS revenue
    FROM mkt_campaigns c WHERE c.company_id = ${companyId} ${id ? db`AND c.id = ${id}` : db``}
    ORDER BY c.start_date DESC, c.id DESC`;
  return rows.map((r) => {
    const n = { ...r, budget: Number(r.budget), cost: Number(r.cost), revenue: Number(r.revenue) };
    return { ...n, object: 'mkt.campaign', channel_label: CHANNELS[r.channel] ?? r.channel, metrics: campaignMetrics(n) };
  });
}

export const listCampaigns = (companyId: number) => campaigns(sql, companyId);
export async function getCampaign(companyId: number, id: number, db: Db = sql) {
  const [c] = await campaigns(db, companyId, id);
  if (!c) throw new NotFoundError('Kampanjen');
  return c;
}

function campaignFields(input: Record<string, unknown>) {
  const channel = str(input, 'channel') || 'other';
  if (!CHANNELS[channel]) throw new ValidationError('Okänd kanal');
  const status = str(input, 'status') || 'planned';
  if (!['planned', 'active', 'done'].includes(status)) throw new ValidationError('Ogiltig status');
  const start = date(input, 'start_date', 'Startdatum');
  const end = date(input, 'end_date', 'Slutdatum', false) || null;
  if (end && end < start) throw new ValidationError('Slutdatum är före startdatum');
  const budget = optInt(input, 'budget', 'Budget') ?? 0;
  if (budget < 0) throw new ValidationError('Budgeten kan inte vara negativ');
  return { name: str(input, 'name', { required: true, label: 'Namn' }), channel, status, start_date: start, end_date: end, budget, goal: str(input, 'goal'), code: str(input, 'code') };
}

export async function saveCampaign(actor: Actor, id: number | null, input: Record<string, unknown>): Promise<CampaignOut> {
  const f = campaignFields(input);
  return sql.begin(async (tx) => {
    let cid = id ?? 0;
    if (id) {
      const r = await tx`UPDATE mkt_campaigns SET ${tx(f)} WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
      if (!r.length) throw new NotFoundError('Kampanjen');
    } else {
      [{ id: cid }] = await tx<{ id: number }[]>`INSERT INTO mkt_campaigns ${tx({ ...f, company_id: actor.companyId, created_by: actor.userId })} RETURNING id`;
    }
    await auditBy(tx, actor, id ? 'update' : 'create', 'mkt.campaign', cid);
    return getCampaign(actor.companyId, cid, tx);
  });
}

// ---------- Kostnader ----------

export async function campaignCosts(companyId: number, campaignId: number) {
  return sql<{ id: number; date: string; amount: number; description: string; voucher_id: number | null; account: number | null }[]>`
    SELECT id, to_char(date,'YYYY-MM-DD') AS date, amount::bigint AS amount, description, voucher_id, account FROM mkt_costs
    WHERE company_id = ${companyId} AND campaign_id = ${campaignId} ORDER BY date, id`;
}

/** Bokförda marknadsföringskostnader (59xx) under kampanjperioden som inte är kopplade till någon kampanj */
export async function costCandidates(companyId: number, campaignId: number) {
  const c = await getCampaign(companyId, campaignId);
  const to = c.end_date ?? today();
  return sql<{ voucher_id: number; account: number; date: string; amount: number; description: string; ref: string }[]>`
    SELECT v.id AS voucher_id, l.account_number AS account, to_char(v.date,'YYYY-MM-DD') AS date, SUM(l.debit - l.credit)::bigint AS amount,
      v.description, v.series || v.number AS ref
    FROM vouchers v JOIN voucher_lines l ON l.voucher_id = v.id
    WHERE v.company_id = ${companyId} AND l.account_number BETWEEN ${MKT_FROM} AND ${MKT_TO} AND v.date BETWEEN ${c.start_date}::date - 30 AND ${to}::date + 30
      AND NOT EXISTS (SELECT 1 FROM mkt_costs m WHERE m.voucher_id = v.id AND m.account = l.account_number)
    GROUP BY v.id, l.account_number HAVING SUM(l.debit - l.credit) <> 0 ORDER BY v.date, v.id`;
}

export async function linkCost(actor: Actor, campaignId: number, input: Record<string, unknown>) {
  await getCampaign(actor.companyId, campaignId);
  const voucherId = int(input, 'voucher_id', 'Verifikation'), account = int(input, 'account', 'Konto');
  if (account < MKT_FROM || account > MKT_TO) throw new ValidationError('Bara kostnader på konton för reklam och PR (59xx) kan kopplas');
  const [v] = await sql<{ date: string; description: string; amount: number }[]>`
    SELECT to_char(v.date,'YYYY-MM-DD') AS date, v.description, SUM(l.debit - l.credit)::bigint AS amount FROM vouchers v JOIN voucher_lines l ON l.voucher_id = v.id
    WHERE v.id = ${voucherId} AND v.company_id = ${actor.companyId} AND l.account_number = ${account} GROUP BY v.id`;
  if (!v) throw new ValidationError('Verifikationen har ingen rad på kontot');
  try {
    await sql`INSERT INTO mkt_costs ${sql({ company_id: actor.companyId, campaign_id: campaignId, date: v.date, amount: Number(v.amount), description: v.description, voucher_id: voucherId, account, created_by: actor.userId })}`;
  } catch (e) {
    if (String((e as Error).message).includes('mkt_costs_voucher')) throw new ConflictError('Kostnaden är redan kopplad till en kampanj');
    throw e;
  }
  await auditBy(sql, actor, 'link_cost', 'mkt.campaign', campaignId, { voucher: voucherId, account });
  return getCampaign(actor.companyId, campaignId);
}

/** Kostnad som inte syns i bokföringen som 59xx, t.ex. eget arbete eller del av en större faktura */
export async function addCost(actor: Actor, campaignId: number, input: Record<string, unknown>) {
  await getCampaign(actor.companyId, campaignId);
  const amount = int(input, 'amount', 'Belopp');
  await sql`INSERT INTO mkt_costs ${sql({ company_id: actor.companyId, campaign_id: campaignId, date: date(input, 'date', 'Datum', false) || today(),
    amount, description: str(input, 'description', { required: true, label: 'Beskrivning' }), created_by: actor.userId })}`;
  await auditBy(sql, actor, 'add_cost', 'mkt.campaign', campaignId, { amount });
  return getCampaign(actor.companyId, campaignId);
}

export async function removeCost(actor: Actor, campaignId: number, costId: number) {
  const r = await sql`DELETE FROM mkt_costs WHERE id = ${costId} AND campaign_id = ${campaignId} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Kostnaden');
  await auditBy(sql, actor, 'remove_cost', 'mkt.campaign', campaignId, { cost: costId });
}

// ---------- Leads ----------

export interface LeadOut {
  id: number; object: 'mkt.lead'; campaign_id: number | null; campaign: string | null; name: string; company_name: string; email: string; phone: string; source: string;
  status: string; status_label: string; value: number; consent: boolean; consent_text: string; consent_at: string | null; notes: string; customer_id: number | null;
  won_at: string | null; created_at: string; updated_at: string;
}

const LCOLS = (db: Db) => db`l.id, 'mkt.lead' AS object, l.campaign_id, c.name AS campaign, l.name, l.company_name, l.email, l.phone, l.source, l.status, l.value::bigint AS value,
  l.consent, l.consent_text, to_char(l.consent_at,'YYYY-MM-DD') AS consent_at, l.notes, l.customer_id, to_char(l.won_at,'YYYY-MM-DD') AS won_at,
  to_char(l.created_at,'YYYY-MM-DD') AS created_at, to_char(l.updated_at,'YYYY-MM-DD') AS updated_at`;

const withLabel = (l: Omit<LeadOut, 'status_label'>): LeadOut => ({ ...l, value: Number(l.value), status_label: LEAD_STATUS[l.status] ?? l.status });

export async function listLeads(companyId: number, f: { status?: string; campaign_id?: number; q?: string } = {}) {
  const rows = await sql<Omit<LeadOut, 'status_label'>[]>`SELECT ${LCOLS(sql)} FROM mkt_leads l LEFT JOIN mkt_campaigns c ON c.id = l.campaign_id
    WHERE l.company_id = ${companyId} ${f.status ? sql`AND l.status = ${f.status}` : sql``} ${f.campaign_id ? sql`AND l.campaign_id = ${f.campaign_id}` : sql``}
    ${f.q ? sql`AND (l.name ILIKE ${'%' + f.q + '%'} OR l.company_name ILIKE ${'%' + f.q + '%'} OR l.email ILIKE ${'%' + f.q + '%'})` : sql``}
    ORDER BY l.updated_at DESC LIMIT 500`;
  return rows.map(withLabel);
}

export async function getLead(companyId: number, id: number, db: Db = sql): Promise<LeadOut> {
  const [l] = await db<Omit<LeadOut, 'status_label'>[]>`SELECT ${LCOLS(db)} FROM mkt_leads l LEFT JOIN mkt_campaigns c ON c.id = l.campaign_id WHERE l.id = ${id} AND l.company_id = ${companyId}`;
  if (!l) throw new NotFoundError('Leadet');
  return withLabel(l);
}

async function campaignRef(db: Db, companyId: number, input: Record<string, unknown>) {
  let id = optInt(input, 'campaign_id', 'Kampanj');
  const code = str(input, 'campaign_code');
  if (!id && code) [{ id } = { id: null as unknown as number }] = await db<{ id: number }[]>`SELECT id FROM mkt_campaigns WHERE company_id = ${companyId} AND code = ${code} LIMIT 1`;
  if (id) {
    const [c] = await db`SELECT 1 FROM mkt_campaigns WHERE id = ${id} AND company_id = ${companyId}`;
    if (!c) throw new ValidationError('Kampanjen finns inte');
  }
  return id ?? null;
}

export async function createLead(actor: Actor, input: Record<string, unknown>): Promise<LeadOut> {
  const email = str(input, 'email');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError('Ogiltig e-postadress');
  const consent = input.consent === true || input.consent === 'on' || input.consent === 'true';
  return sql.begin(async (tx) => {
    const [{ id }] = await tx<{ id: number }[]>`INSERT INTO mkt_leads ${tx({
      company_id: actor.companyId, campaign_id: await campaignRef(tx, actor.companyId, input), name: str(input, 'name', { required: true, label: 'Namn' }),
      company_name: str(input, 'company_name'), email, phone: str(input, 'phone'), source: str(input, 'source'), value: optInt(input, 'value', 'Värde') ?? 0,
      consent, consent_text: consent ? str(input, 'consent_text') || 'Samtycke till marknadsföring via e-post' : '', consent_at: consent ? new Date() : null,
      notes: str(input, 'notes'),
    })} RETURNING id`;
    await auditBy(tx, actor, 'create', 'mkt.lead', id);
    const out = await getLead(actor.companyId, id, tx);
    await emit(tx, actor.companyId, 'marknad.lead.created', out);
    return out;
  });
}

export async function updateLead(actor: Actor, id: number, input: Record<string, unknown>): Promise<LeadOut> {
  const cur = await getLead(actor.companyId, id);
  const status = str(input, 'status') || cur.status;
  if (!LEAD_STATUS[status]) throw new ValidationError('Ogiltig status');
  if (status === 'won' && !cur.customer_id) throw new ValidationError('Gör om leadet till kund för att markera det som vunnet');
  const consent = input.consent == null ? cur.consent : input.consent === true || input.consent === 'on' || input.consent === 'true';
  return sql.begin(async (tx) => {
    await tx`UPDATE mkt_leads SET status = ${status}, notes = ${input.notes == null ? cur.notes : str(input, 'notes')},
      value = ${optInt(input, 'value', 'Värde') ?? cur.value}, campaign_id = ${input.campaign_id == null ? cur.campaign_id : await campaignRef(tx, actor.companyId, input)},
      consent = ${consent}, consent_at = ${consent && !cur.consent ? new Date() : consent ? tx`consent_at` : null},
      consent_text = ${consent ? cur.consent_text || 'Samtycke till marknadsföring via e-post' : ''}, updated_at = now() WHERE id = ${id}`;
    await auditBy(tx, actor, 'update', 'mkt.lead', id, { status });
    return getLead(actor.companyId, id, tx);
  });
}

/** Gör om leadet till kund: kunden skapas i kundregistret och leadet markeras som vunnet */
export async function convertLead(actor: Actor, id: number): Promise<LeadOut> {
  const l = await getLead(actor.companyId, id);
  if (l.customer_id) throw new ConflictError('Leadet är redan kund');
  const c = await createCustomer(actor, { name: l.company_name || l.name, email: l.email });
  await sql`UPDATE mkt_leads SET customer_id = ${c.id}, status = 'won', won_at = ${today()}, updated_at = now() WHERE id = ${id}`;
  await auditBy(sql, actor, 'convert', 'mkt.lead', id, { customer: c.id });
  const out = await getLead(actor.companyId, id);
  await sql.begin((tx) => emit(tx, actor.companyId, 'marknad.lead.won', out));
  return out;
}

export async function deleteLead(actor: Actor, id: number) {
  const r = await sql`DELETE FROM mkt_leads WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Leadet');
  await auditBy(sql, actor, 'delete', 'mkt.lead', id);
  return { id, object: 'mkt.lead', deleted: true };
}

/** Gallring enligt GDPR (lagringsminimering): förlorade leads och leads utan samtycke utan aktivitet på 24 månader */
export async function purgeCandidates(companyId: number) {
  const t = today();
  const rows = await sql<{ id: number; name: string; status: string; consent: boolean; updated: string; customer_id: number | null }[]>`
    SELECT id, name, status, consent, to_char(updated_at,'YYYY-MM-DD') AS updated, customer_id FROM mkt_leads WHERE company_id = ${companyId}`;
  return rows.filter((r) => shouldPurge(r, t));
}

export async function purgeLeads(actor: Actor) {
  const ids = (await purgeCandidates(actor.companyId)).map((r) => r.id);
  if (ids.length) await sql`DELETE FROM mkt_leads WHERE company_id = ${actor.companyId} AND id IN ${sql(ids)}`;
  await auditBy(sql, actor, 'purge', 'mkt.lead', 0, { deleted: ids.length });
  return ids.length;
}

// ---------- Översikt och budget ----------

export async function overview(companyId: number, year: number) {
  const [counts, spend, budget] = await Promise.all([
    sql<{ status: string; n: number }[]>`SELECT status, count(*)::int AS n FROM mkt_leads WHERE company_id = ${companyId} GROUP BY status`,
    sql<{ month: number; amount: number }[]>`SELECT EXTRACT(MONTH FROM v.date)::int AS month, SUM(l.debit - l.credit)::bigint AS amount
      FROM vouchers v JOIN voucher_lines l ON l.voucher_id = v.id
      WHERE v.company_id = ${companyId} AND l.account_number BETWEEN ${MKT_FROM} AND ${MKT_TO} AND EXTRACT(YEAR FROM v.date) = ${year} GROUP BY 1`,
    sql<{ month: number; amount: number }[]>`SELECT month, amount::bigint AS amount FROM mkt_budgets WHERE company_id = ${companyId} AND year = ${year}`,
  ]);
  const months = [...Array(12)].map((_, i) => ({
    month: i + 1, budget: Number(budget.find((b) => b.month === i + 1)?.amount ?? 0), actual: Number(spend.find((s) => s.month === i + 1)?.amount ?? 0),
  }));
  return { funnel: funnel(Object.fromEntries(counts.map((c) => [c.status, c.n]))), months, budget: months.reduce((s, m) => s + m.budget, 0), actual: months.reduce((s, m) => s + m.actual, 0) };
}

export async function saveBudget(actor: Actor, year: number, amounts: (number | null)[]) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new ValidationError('Ogiltigt år');
  await sql.begin(async (tx) => {
    for (let m = 1; m <= 12; m++) {
      const a = amounts[m - 1] ?? 0;
      if (a < 0) throw new ValidationError('Budgeten kan inte vara negativ');
      await tx`INSERT INTO mkt_budgets (company_id, year, month, amount) VALUES (${actor.companyId}, ${year}, ${m}, ${a})
        ON CONFLICT (company_id, year, month) DO UPDATE SET amount = EXCLUDED.amount`;
    }
    await auditBy(tx, actor, 'budget', 'mkt.budget', year);
  });
}
