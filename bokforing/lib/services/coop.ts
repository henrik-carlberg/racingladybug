import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, createVoucher, fiscalYears } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import {
  exitDates, fulfilment, GRANT_DEBT_ACCOUNT, grantLines, INSATS_ACCOUNT, insatsLines, ORG_FORM_LABEL, proportional, PURPOSE_ACCOUNT,
  REFUND_ACCOUNT, REFUND_DEBT_ACCOUNT, refundLines, yieldOf, type OrgForm,
} from '@/lib/coop';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function kronor(input: Record<string, unknown>, k: string, label: string, required = true) {
  const raw = String(input[k] ?? '').trim();
  if (!raw && !required) return 0;
  const v = parseAmount(raw);
  if (v == null || v < 0 || (required && v === 0)) throw new ValidationError(`Ange ${label.toLowerCase()} i kronor`);
  return v;
}
function bankOf(input: Record<string, unknown>) {
  const b = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (b < 1900 || b > 1999) throw new ValidationError('Bankkontot ska vara 19xx');
  return b;
}

export async function orgForm(companyId: number): Promise<string | null> {
  const [c] = await sql<{ f: string | null }[]>`SELECT org_form AS f FROM companies WHERE id = ${companyId}`;
  return c?.f ?? null;
}
async function requireForm(companyId: number, f: OrgForm) {
  if ((await orgForm(companyId)) !== f) throw new ValidationError(`Slå på läget ${ORG_FORM_LABEL[f].toLowerCase()} först`);
}

/** Byter organisationsform till ekonomisk förening eller stiftelse (eller stänger av). Andra föreningslägen måste stängas av först. */
export async function setForm(actor: Actor, form: OrgForm | null) {
  const cur = await orgForm(actor.companyId);
  if (cur && cur !== 'ek' && cur !== 'stiftelse') throw new ConflictError('Stäng först av läget för ideell förening eller bostadsrättsförening');
  await sql.begin(async (tx) => {
    await tx`UPDATE companies SET org_form = ${form} WHERE id = ${actor.companyId}`;
    await tx`INSERT INTO coop_settings (company_id) VALUES (${actor.companyId}) ON CONFLICT DO NOTHING`;
    const accs: [number, string][] = form === 'ek'
      ? [[INSATS_ACCOUNT, 'Medlemsinsatser'], [REFUND_ACCOUNT, 'Återbäring till medlemmar'], [REFUND_DEBT_ACCOUNT, 'Beslutad ej utbetald återbäring']]
      : form === 'stiftelse'
        ? [[2068, 'Balanserat kapital'], [2069, 'Årets resultat'], [2010, 'Grundkapital'], [PURPOSE_ACCOUNT, 'Lämnade bidrag (ändamålet)'], [GRANT_DEBT_ACCOUNT, 'Beviljade ej utbetalda bidrag']]
        : [];
    for (const [n, name] of accs) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n}, ${name}) ON CONFLICT DO NOTHING`;
    await auditBy(tx, actor, form ? 'enable' : 'disable', 'org_form', actor.companyId, { form });
  });
}

export async function saveSettings(actor: Actor, input: Record<string, unknown>) {
  const f = await orgForm(actor.companyId);
  if (f !== 'ek' && f !== 'stiftelse') throw new ValidationError('Välj ekonomisk förening eller stiftelse först');
  const insats = f === 'ek' ? kronor(input, 'insats', 'Insats', false) : 0;
  const purpose = str(input, 'purpose', { max: 2000 });
  await sql`INSERT INTO coop_settings ${sql({ company_id: actor.companyId, insats, purpose })}
    ON CONFLICT (company_id) DO UPDATE SET insats = EXCLUDED.insats, purpose = EXCLUDED.purpose`;
  await auditBy(sql, actor, 'settings', 'org_form', actor.companyId, { insats });
}

// ---------- Ekonomisk förening ----------
/** Ny medlem: registreras i medlemsregistret och som kund, så att medlemmens köp ger underlag för återbäring */
export async function addMember(actor: Actor, input: Record<string, unknown>) {
  await requireForm(actor.companyId, 'ek');
  const name = str(input, 'name', { required: true, label: 'Namn', max: 200 });
  const email = str(input, 'email', { max: 200 });
  if (email && !EMAIL.test(email)) throw new ValidationError('Ogiltig e-postadress');
  const joined = date(input, 'joined', 'Inträde', false) || today();
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(74001, ${actor.companyId})`;
    const [{ n }] = await tx<{ n: number }[]>`SELECT COALESCE(MAX(member_no), 0) + 1 AS n FROM members WHERE company_id = ${actor.companyId}`;
    const [c] = await tx<{ id: number }[]>`INSERT INTO customers ${tx({ company_id: actor.companyId, name, email })} RETURNING id`;
    const [m] = await tx<{ id: number; member_no: number }[]>`INSERT INTO members ${tx({
      company_id: actor.companyId, member_no: n, name, email, address: str(input, 'address', { max: 300 }), category: 'Medlem', joined, customer_id: c.id,
    })} RETURNING id, member_no`;
    await auditBy(tx, actor, 'create', 'member', m.id, { name });
    return m;
  });
}

async function ownMember(companyId: number, id: number) {
  const [m] = await sql<{ id: number; name: string; left_on: string | null; payable_from: string | null }[]>`
    SELECT id, name, to_char(left_on,'YYYY-MM-DD') AS left_on, to_char(payable_from,'YYYY-MM-DD') AS payable_from FROM members WHERE id = ${id} AND company_id = ${companyId}`;
  if (!m) throw new NotFoundError('Medlemmen');
  return m;
}

/** Inbetald eller återbetald insats (1930 mot 2083). Återbetalning först när utträdet har verkställts och sexmånadersfristen gått ut. */
export async function insats(actor: Actor, memberId: number, input: Record<string, unknown>) {
  await requireForm(actor.companyId, 'ek');
  const kind = str(input, 'kind') === 'repaid' ? 'repaid' : 'paid';
  const d = date(input, 'date', 'Datum', false) || today();
  const bank = bankOf(input);
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(89001, ${actor.companyId})`;
    const m = await ownMember(actor.companyId, memberId);
    const [{ bal }] = await tx<{ bal: number }[]>`SELECT COALESCE(SUM(CASE WHEN kind = 'paid' THEN amount ELSE -amount END), 0)::float8 AS bal FROM coop_insatser WHERE member_id = ${memberId}`;
    let amount: number;
    if (kind === 'paid') {
      if (m.left_on) throw new ConflictError('Medlemmen har sagt upp sitt medlemskap');
      amount = kronor(input, 'amount', 'Insats');
    } else {
      if (!m.payable_from) throw new ValidationError('Registrera utträdet först – insatsen betalas tillbaka efter avgången');
      if (d < m.payable_from) throw new ValidationError(`Insatsen får betalas tillbaka tidigast ${m.payable_from} (sex månader efter avgången)`);
      if (bal <= 0) throw new ConflictError('Det finns ingen insats att betala tillbaka');
      amount = bal;
    }
    const v = await createVoucher(tx, { actor, date: d, description: `${kind === 'paid' ? 'Inbetald insats' : 'Återbetald insats'} ${m.name}`, lines: fromSigned(insatsLines(kind, amount, bank)), sourceType: 'coop_insats', sourceId: memberId });
    await tx`INSERT INTO coop_insatser ${tx({ company_id: actor.companyId, member_id: memberId, date: d, kind, amount, voucher_id: v.id })}`;
    await auditBy(tx, actor, kind, 'coop_insats', memberId, { amount });
    return { amount };
  });
}

/** Uppsägning: avgångsdag och tidigaste dag för återbetalning av insatsen */
export async function notice(actor: Actor, memberId: number, input: Record<string, unknown>) {
  await requireForm(actor.companyId, 'ek');
  const m = await ownMember(actor.companyId, memberId);
  if (m.left_on) throw new ConflictError('Uppsägningen är redan registrerad');
  const d = date(input, 'notice_on', 'Uppsägning', false) || today();
  const ex = exitDates(d, (await fiscalYears(actor.companyId)).map((f) => f.end_date));
  await sql`UPDATE members SET notice_on = ${d}, left_on = ${ex.leavesOn}, payable_from = ${ex.payableFrom} WHERE id = ${memberId} AND company_id = ${actor.companyId}`;
  await auditBy(sql, actor, 'notice', 'member', memberId, { notice_on: d, ...ex });
  return ex;
}

export async function members(companyId: number) {
  return sql<{ id: number; member_no: number; name: string; email: string; joined: string; notice_on: string | null; left_on: string | null; payable_from: string | null; insats: number }[]>`
    SELECT m.id, m.member_no, m.name, m.email, to_char(m.joined,'YYYY-MM-DD') AS joined, to_char(m.notice_on,'YYYY-MM-DD') AS notice_on,
      to_char(m.left_on,'YYYY-MM-DD') AS left_on, to_char(m.payable_from,'YYYY-MM-DD') AS payable_from,
      COALESCE((SELECT SUM(CASE WHEN i.kind = 'paid' THEN i.amount ELSE -i.amount END) FROM coop_insatser i WHERE i.member_id = m.id), 0)::float8 AS insats
    FROM members m WHERE m.company_id = ${companyId} ORDER BY m.member_no`;
}

async function fyById(companyId: number, fyId: number) {
  const f = (await fiscalYears(companyId)).find((y) => y.id === fyId);
  if (!f) throw new NotFoundError('Räkenskapsåret');
  return f;
}

/** Underlag för återbäring: medlemmarnas köp (fakturerat netto, krediteringar avräknade) under räkenskapsåret */
export async function refundBasis(companyId: number, fyId: number, total = 0) {
  const f = await fyById(companyId, fyId);
  const rows = await sql<{ member_id: number; member_no: number; name: string; base: number }[]>`
    SELECT m.id AS member_id, m.member_no, m.name, COALESCE(SUM(i.total_net), 0)::float8 AS base
    FROM members m LEFT JOIN invoices i ON i.customer_id = m.customer_id AND i.company_id = m.company_id AND i.status <> 'draft'
      AND i.invoice_date BETWEEN ${f.start_date} AND ${f.end_date}
    WHERE m.company_id = ${companyId} AND m.joined <= ${f.end_date} GROUP BY m.id ORDER BY m.member_no`;
  return { fy: f, rows: proportional(total, rows) };
}

/** Föreningsstämmans beslut om återbäring: bokas per räkenskapsårets sista dag (3739 mot 2891) och fördelas efter medlemmarnas köp */
export async function decideRefund(actor: Actor, input: Record<string, unknown>) {
  await requireForm(actor.companyId, 'ek');
  const fyId = int(input, 'fy', 'Räkenskapsår');
  const total = kronor(input, 'total', 'Återbäring');
  const decided = date(input, 'decided_on', 'Beslutsdag', false) || today();
  const { fy, rows } = await refundBasis(actor.companyId, fyId, total);
  if (!rows.some((r) => r.amount > 0)) throw new ValidationError('Inga medlemmar har köpt något under året – återbäringen kan inte fördelas');
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(89002, ${actor.companyId})`;
    const [dup] = await tx`SELECT 1 FROM coop_refunds WHERE company_id = ${actor.companyId} AND fiscal_year_id = ${fyId}`;
    if (dup) throw new ConflictError('Återbäring för året är redan beslutad');
    const v = await createVoucher(tx, { actor, date: fy.end_date, description: `Återbäring till medlemmar ${fy.start_date.slice(0, 4)} enligt föreningsstämmans beslut ${decided}`, lines: fromSigned(refundLines(total)), sourceType: 'coop_refund' });
    const [r] = await tx<{ id: number }[]>`INSERT INTO coop_refunds ${tx({ company_id: actor.companyId, fiscal_year_id: fyId, total, decided_on: decided, voucher_id: v.id })} RETURNING id`;
    for (const x of rows) if (x.amount > 0) await tx`INSERT INTO coop_refund_lines ${tx({ refund_id: r.id, member_id: x.member_id, base: Math.round(x.base), amount: x.amount })}`;
    await auditBy(tx, actor, 'decide', 'coop_refund', r.id, { total });
    return r;
  });
}

export async function payRefund(actor: Actor, refundId: number, input: Record<string, unknown>) {
  await requireForm(actor.companyId, 'ek');
  const d = date(input, 'date', 'Datum', false) || today();
  const bank = bankOf(input);
  return sql.begin(async (tx) => {
    const [r] = await tx<{ total: number; paid: number | null }[]>`SELECT total::float8 AS total, paid_voucher_id AS paid FROM coop_refunds WHERE id = ${refundId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!r) throw new NotFoundError('Återbäringen');
    if (r.paid) throw new ConflictError('Återbäringen är redan utbetald');
    const v = await createVoucher(tx, { actor, date: d, description: 'Utbetald återbäring till medlemmar', lines: fromSigned([{ account: REFUND_DEBT_ACCOUNT, amount: r.total }, { account: bank, amount: -r.total }]), sourceType: 'coop_refund', sourceId: refundId });
    await tx`UPDATE coop_refunds SET paid_voucher_id = ${v.id} WHERE id = ${refundId}`;
    await auditBy(tx, actor, 'pay', 'coop_refund', refundId, { total: r.total });
  });
}

export async function refunds(companyId: number) {
  const rs = await sql<{ id: number; year: string; total: number; decided_on: string; paid: boolean }[]>`
    SELECT r.id, to_char(f.start_date,'YYYY') AS year, r.total::float8 AS total, to_char(r.decided_on,'YYYY-MM-DD') AS decided_on, r.paid_voucher_id IS NOT NULL AS paid
    FROM coop_refunds r JOIN fiscal_years f ON f.id = r.fiscal_year_id WHERE r.company_id = ${companyId} ORDER BY f.start_date DESC`;
  const lines = rs.length ? await sql<{ refund_id: number; name: string; base: number; amount: number }[]>`
    SELECT l.refund_id, m.name, l.base::float8 AS base, l.amount::float8 AS amount FROM coop_refund_lines l JOIN members m ON m.id = l.member_id
    WHERE l.refund_id IN ${sql(rs.map((r) => r.id))} ORDER BY m.member_no` : [];
  return rs.map((r) => ({ ...r, lines: lines.filter((l) => l.refund_id === r.id) }));
}

// ---------- Stiftelse ----------
export async function decideGrant(actor: Actor, input: Record<string, unknown>) {
  await requireForm(actor.companyId, 'stiftelse');
  const recipient = str(input, 'recipient', { required: true, label: 'Mottagare', max: 200 });
  const amount = kronor(input, 'amount', 'Belopp');
  const d = date(input, 'decided_on', 'Beslutsdag', false) || today();
  return sql.begin(async (tx) => {
    const v = await createVoucher(tx, { actor, date: d, description: `Beviljat bidrag ${recipient}`, lines: fromSigned(grantLines('decide', amount)), sourceType: 'foundation_grant' });
    const [g] = await tx<{ id: number }[]>`INSERT INTO foundation_grants ${tx({ company_id: actor.companyId, recipient, purpose: str(input, 'purpose', { max: 500 }), decided_on: d, amount, voucher_id: v.id })} RETURNING id`;
    await auditBy(tx, actor, 'decide', 'foundation_grant', g.id, { amount });
    return g;
  });
}

export async function payGrant(actor: Actor, id: number, input: Record<string, unknown>) {
  await requireForm(actor.companyId, 'stiftelse');
  const d = date(input, 'date', 'Datum', false) || today();
  const bank = bankOf(input);
  return sql.begin(async (tx) => {
    const [g] = await tx<{ amount: number; recipient: string; paid: number | null; decided_on: string }[]>`SELECT amount::float8 AS amount, recipient, paid_voucher_id AS paid, to_char(decided_on,'YYYY-MM-DD') AS decided_on
      FROM foundation_grants WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!g) throw new NotFoundError('Bidraget');
    if (g.paid) throw new ConflictError('Bidraget är redan utbetalt');
    if (d < g.decided_on) throw new ValidationError('Utbetalningen kan inte ske före beslutet');
    const v = await createVoucher(tx, { actor, date: d, description: `Utbetalt bidrag ${g.recipient}`, lines: fromSigned(grantLines('pay', g.amount, bank)), sourceType: 'foundation_grant', sourceId: id });
    await tx`UPDATE foundation_grants SET paid_on = ${d}, paid_voucher_id = ${v.id} WHERE id = ${id}`;
    await auditBy(tx, actor, 'pay', 'foundation_grant', id, { amount: g.amount });
  });
}

export async function grants(companyId: number) {
  return sql<{ id: number; recipient: string; purpose: string; decided_on: string; amount: number; paid_on: string | null }[]>`
    SELECT id, recipient, purpose, to_char(decided_on,'YYYY-MM-DD') AS decided_on, amount::float8 AS amount, to_char(paid_on,'YYYY-MM-DD') AS paid_on
    FROM foundation_grants WHERE company_id = ${companyId} ORDER BY decided_on DESC, id DESC`;
}

/** Fullföljdskravet per räkenskapsår med rullande femårsperiod */
export async function fulfilmentReport(companyId: number) {
  const fys = (await fiscalYears(companyId)).slice(0, 10).reverse();
  const years = [];
  for (const f of fys) {
    const y = yieldOf(await accountSums(companyId, f.start_date, f.end_date));
    years.push({ year: Number(f.start_date.slice(0, 4)), label: f.start_date.slice(0, 4) === f.end_date.slice(0, 4) ? f.start_date.slice(0, 4) : `${f.start_date.slice(0, 4)}/${f.end_date.slice(2, 4)}`, ...y });
  }
  return fulfilment(years);
}

export async function overview(companyId: number) {
  const form = await orgForm(companyId);
  const [s] = await sql<{ insats: number; purpose: string }[]>`SELECT insats::float8 AS insats, purpose FROM coop_settings WHERE company_id = ${companyId}`;
  return { form, settings: s ?? { insats: 0, purpose: '' } };
}
