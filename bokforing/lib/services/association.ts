import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { sendMail } from '@/lib/server/mail';
import { today } from '@/lib/format';
import { parseAmount } from '@/lib/money';
import {
  ASSOC_EQUITY_BALANCED, ASSOC_EQUITY_RESULT, auditReportHtml, DEFAULT_AGENDA, FEE_ACCOUNT, GIFT_ACCOUNT, GRANT_ACCOUNT, giftLines,
  memberStats, membersToInvoice, noticeDeadline, noticeHtml, reportHtml, RESTRICTED_ACCOUNT, type Member,
} from '@/lib/association';
import type { Actor } from './actor';
import { bookInvoice, saveDraftTx } from './invoices';
import { createDocument } from './documents';
import { statements } from './statements';
import { date, int, optInt, str } from './input';

function kronor(input: Record<string, unknown>, k: string, label: string, min: number) {
  const v = parseAmount(String(input[k] ?? ''));
  if (v == null || v < min) throw new ValidationError(`Ange ${label.toLowerCase()} i kronor`);
  return v;
}
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Slår på föreningsanpassad bokföring: eget kapital 2068/2069, medlemsavgifter, gåvor och bidrag */
export async function setAssociation(actor: Actor, on: boolean) {
  await sql.begin(async (tx) => {
    await tx`UPDATE companies SET org_form = ${on ? 'ideell' : null} WHERE id = ${actor.companyId}`;
    if (on) await tx`INSERT INTO accounts (company_id, number, name) VALUES
      (${actor.companyId}, ${RESTRICTED_ACCOUNT}, 'Ändamålsbestämda medel'), (${actor.companyId}, ${ASSOC_EQUITY_BALANCED}, 'Balanserat resultat'),
      (${actor.companyId}, ${ASSOC_EQUITY_RESULT}, 'Årets resultat'), (${actor.companyId}, ${FEE_ACCOUNT}, 'Medlemsavgifter'),
      (${actor.companyId}, ${GRANT_ACCOUNT}, 'Erhållna bidrag'), (${actor.companyId}, ${GIFT_ACCOUNT}, 'Erhållna gåvor') ON CONFLICT DO NOTHING`;
    await auditBy(tx, actor, on ? 'enable' : 'disable', 'association', actor.companyId);
  });
}

export async function isAssociation(companyId: number) {
  const [c] = await sql<{ org_form: string | null }[]>`SELECT org_form FROM companies WHERE id = ${companyId}`;
  return c?.org_form === 'ideell';
}

async function requireAssociation(companyId: number) {
  if (!(await isAssociation(companyId))) throw new ValidationError('Slå på föreningsläget först');
}

// ---------- Medlemmar ----------
export async function listMembers(companyId: number) {
  return sql<(Member & { member_no: number; email: string; phone: string; address: string })[]>`
    SELECT id, member_no, name, email, phone, address, category, to_char(joined,'YYYY-MM-DD') AS joined, to_char(left_on,'YYYY-MM-DD') AS left_on
    FROM members WHERE company_id = ${companyId} ORDER BY member_no`;
}

export async function addMember(actor: Actor, input: Record<string, unknown>) {
  await requireAssociation(actor.companyId);
  const name = str(input, 'name', { required: true, label: 'Namn', max: 200 });
  const email = str(input, 'email', { max: 200 });
  if (email && !EMAIL.test(email)) throw new ValidationError('Ogiltig e-postadress');
  const category = str(input, 'category', { max: 60 }) || 'Ordinarie';
  const joined = date(input, 'joined', 'Inträde', false) || today();
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(74001, ${actor.companyId})`;
    const [{ n }] = await tx<{ n: number }[]>`SELECT COALESCE(MAX(member_no), 0) + 1 AS n FROM members WHERE company_id = ${actor.companyId}`;
    const [m] = await tx<{ id: number; member_no: number }[]>`INSERT INTO members ${tx({
      company_id: actor.companyId, member_no: n, name, email, phone: str(input, 'phone', { max: 40 }), address: str(input, 'address', { max: 300 }), category, joined,
    })} RETURNING id, member_no`;
    await auditBy(tx, actor, 'create', 'member', m.id, { name });
    return m;
  });
}

export async function leaveMember(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'left_on', 'Utträde', false) || today();
  const r = await sql`UPDATE members SET left_on = ${d} WHERE id = ${id} AND company_id = ${actor.companyId} AND left_on IS NULL RETURNING id`;
  if (!r.length) throw new NotFoundError('Medlemmen');
  await auditBy(sql, actor, 'leave', 'member', id, { left_on: d });
}

// ---------- Medlemsavgifter ----------
export async function feeRates(companyId: number, year: number) {
  return sql<{ category: string; amount: number }[]>`SELECT category, amount::float8 AS amount FROM member_fee_rates WHERE company_id = ${companyId} AND year = ${year} ORDER BY category`;
}

export async function setFeeRate(actor: Actor, input: Record<string, unknown>) {
  await requireAssociation(actor.companyId);
  const year = int(input, 'year', 'År');
  if (year < 2000 || year > 2100) throw new ValidationError('Ogiltigt år');
  const category = str(input, 'category', { max: 60 }) || 'Ordinarie';
  const amount = kronor(input, 'amount', 'Avgift', 0);
  await sql`INSERT INTO member_fee_rates (company_id, year, category, amount) VALUES (${actor.companyId}, ${year}, ${category}, ${amount})
    ON CONFLICT (company_id, year, category) DO UPDATE SET amount = EXCLUDED.amount`;
  await auditBy(sql, actor, 'fee_rate', 'association', actor.companyId, { year, category, amount });
}

/**
 * Aviserar årets medlemsavgift: en momsfri faktura per medlem på 3890 (kund skapas vid behov).
 * Fakturan bokförs direkt och får OCR – medlemmen betalar med Swish, autogiro eller bankgiro som vanliga kundfakturor.
 */
export async function invoiceFees(actor: Actor, input: Record<string, unknown>) {
  await requireAssociation(actor.companyId);
  const year = int(input, 'year', 'År');
  const invoiceDate = date(input, 'invoice_date', 'Fakturadatum', false) || today();
  const drafts = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(74002, ${actor.companyId})`;
    const members = await tx<(Member & { email: string; address: string; phone: string; customer_id: number | null; member_no: number })[]>`
      SELECT id, member_no, name, email, phone, address, category, customer_id, to_char(joined,'YYYY-MM-DD') AS joined, to_char(left_on,'YYYY-MM-DD') AS left_on
      FROM members WHERE company_id = ${actor.companyId} ORDER BY member_no`;
    const done = new Set((await tx<{ member_id: number }[]>`SELECT f.member_id FROM member_fees f JOIN members m ON m.id = f.member_id WHERE m.company_id = ${actor.companyId} AND f.year = ${year}`).map((r) => r.member_id));
    const rates = await tx<{ category: string; amount: number }[]>`SELECT category, amount::float8 AS amount FROM member_fee_rates WHERE company_id = ${actor.companyId} AND year = ${year}`;
    const due = membersToInvoice(members, rates, year, done, invoiceDate);
    if (!due.length) throw new ValidationError('Det finns inga medlemmar att avisera (ange avgift per kategori för året)');
    const ids: number[] = [];
    for (const { member, amount } of due) {
      const m = members.find((x) => x.id === member.id)!;
      let cust = m.customer_id;
      if (cust) { const [c] = await tx`SELECT 1 FROM customers WHERE id = ${cust} AND company_id = ${actor.companyId}`; if (!c) cust = null; }
      if (!cust) {
        [{ id: cust }] = await tx<{ id: number }[]>`INSERT INTO customers ${tx({ company_id: actor.companyId, name: m.name, email: m.email, address: m.address, phone: m.phone })} RETURNING id`;
        await tx`UPDATE members SET customer_id = ${cust} WHERE id = ${m.id}`;
      }
      const inv = await saveDraftTx(tx, actor, null, {
        customer_id: cust, invoice_date: invoiceDate, your_reference: `Medlem ${m.member_no}`,
        notes: `Medlemsavgift ${year}. Betala med OCR-numret så registreras betalningen automatiskt.`,
        lines: [{ description: `Medlemsavgift ${year} – ${m.category}`, quantity: 1, unit: 'st', unit_price: amount, vat_rate: 0, account: FEE_ACCOUNT }],
      });
      await tx`INSERT INTO member_fees (member_id, year, amount, invoice_id) VALUES (${m.id}, ${year}, ${amount}, ${inv.id})`;
      ids.push(inv.id);
    }
    await auditBy(tx, actor, 'invoice_fees', 'association', actor.companyId, { year, count: ids.length });
    return ids;
  });
  for (const id of drafts) await bookInvoice(actor, id);
  return drafts.length;
}

export async function feeStatus(companyId: number, year: number) {
  return sql<{ member_no: number; name: string; amount: number; invoice_id: number | null; invoice_number: number | null; status: string | null; ocr: string | null }[]>`
    SELECT m.member_no, m.name, f.amount::float8 AS amount, f.invoice_id, i.invoice_number, i.status, i.ocr
    FROM member_fees f JOIN members m ON m.id = f.member_id LEFT JOIN invoices i ON i.id = f.invoice_id
    WHERE m.company_id = ${companyId} AND f.year = ${year} ORDER BY m.member_no`;
}

// ---------- Gåvor och bidrag ----------
export async function registerGift(actor: Actor, input: Record<string, unknown>) {
  await requireAssociation(actor.companyId);
  const kind = str(input, 'kind') === 'grant' ? 'grant' : 'gift';
  const donor = str(input, 'donor', { required: true, label: kind === 'grant' ? 'Bidragsgivare' : 'Givare', max: 200 });
  const amount = kronor(input, 'amount', 'Belopp', 1);
  const d = date(input, 'date', 'Datum');
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (!(bank >= 1900 && bank <= 1999)) throw new ValidationError('Bankkontot ska vara 19xx');
  const restricted = input.restricted === 'on' || input.restricted === true;
  const purpose = str(input, 'purpose', { max: 300 });
  if (restricted && !purpose) throw new ValidationError('Ange ändamålet för ändamålsbestämda medel');
  return sql.begin(async (tx) => {
    const v = await createVoucher(tx, {
      actor, date: d, description: `${kind === 'grant' ? 'Bidrag' : 'Gåva'} från ${donor}${purpose ? ` – ${purpose}` : ''}`,
      lines: fromSigned(giftLines({ kind, amount, bank, restricted })), sourceType: 'assoc_gift',
    });
    const [g] = await tx<{ id: number }[]>`INSERT INTO assoc_gifts ${tx({ company_id: actor.companyId, kind, date: d, donor, amount, purpose, restricted, voucher_id: v.id })} RETURNING id`;
    await auditBy(tx, actor, 'create', 'assoc_gift', g.id, { kind, amount });
    return { id: g.id, voucher: v };
  });
}

export async function listGifts(companyId: number, year: number) {
  return sql<{ id: number; kind: string; date: string; donor: string; amount: number; purpose: string; restricted: boolean; voucher_id: number | null }[]>`
    SELECT id, kind, to_char(date,'YYYY-MM-DD') AS date, donor, amount::float8 AS amount, purpose, restricted, voucher_id
    FROM assoc_gifts WHERE company_id = ${companyId} AND date BETWEEN ${`${year}-01-01`} AND ${`${year}-12-31`} ORDER BY date, id`;
}

// ---------- Årsmöte ----------
export async function getMeeting(companyId: number, year: number) {
  const [m] = await sql<{ id: number; date: string; time: string; place: string; notice_sent_at: string | null; notice_count: number; report_doc_id: number | null; audit_doc_id: number | null }[]>`
    SELECT id, to_char(date,'YYYY-MM-DD') AS date, time, place, notice_sent_at::text, notice_count, report_doc_id, audit_doc_id FROM assoc_meetings WHERE company_id = ${companyId} AND year = ${year}`;
  return m ? { ...m, deadline: noticeDeadline(m.date) } : null;
}

export async function saveMeeting(actor: Actor, input: Record<string, unknown>) {
  await requireAssociation(actor.companyId);
  const year = int(input, 'year', 'Verksamhetsår');
  const d = date(input, 'date', 'Datum för årsmötet');
  const time = str(input, 'time', { max: 10 }) || '18:00';
  if (!/^\d{1,2}[:.]\d{2}$/.test(time)) throw new ValidationError('Ange tiden som tt:mm');
  const place = str(input, 'place', { required: true, label: 'Plats', max: 300 });
  await sql`INSERT INTO assoc_meetings (company_id, year, date, time, place) VALUES (${actor.companyId}, ${year}, ${d}, ${time}, ${place})
    ON CONFLICT (company_id, year) DO UPDATE SET date = EXCLUDED.date, time = EXCLUDED.time, place = EXCLUDED.place`;
  await auditBy(sql, actor, 'meeting', 'association', actor.companyId, { year, date: d });
}

async function meetingOrFail(companyId: number, year: number) {
  const m = await getMeeting(companyId, year);
  if (!m) throw new ValidationError('Spara datum och plats för årsmötet först');
  return m;
}

export async function noticeFor(companyId: number, year: number, extra = '') {
  const m = await meetingOrFail(companyId, year);
  const [c] = await sql<{ name: string }[]>`SELECT name FROM companies WHERE id = ${companyId}`;
  return noticeHtml({ org: c.name, year, date: m.date, time: m.time, place: m.place, agenda: DEFAULT_AGENDA, extra });
}

/** Skickar kallelsen med e-post till alla aktiva medlemmar som har e-postadress */
export async function sendNotice(actor: Actor, input: Record<string, unknown>) {
  await requireAssociation(actor.companyId);
  const year = int(input, 'year', 'Verksamhetsår');
  const m = await meetingOrFail(actor.companyId, year);
  if (m.notice_sent_at) throw new ConflictError('Kallelsen är redan skickad');
  const extra = str(input, 'extra', { max: 2000 });
  const html = await noticeFor(actor.companyId, year, extra);
  const [c] = await sql<{ name: string }[]>`SELECT name FROM companies WHERE id = ${actor.companyId}`;
  const members = (await listMembers(actor.companyId)).filter((x) => !x.left_on && x.email);
  let sent = 0;
  for (const x of members) {
    if (await sendMail(x.email, `Kallelse till årsmöte – ${c.name}`,
      `Hej ${x.name}!\n\nDu kallas till årsmöte i ${c.name} den ${m.date} kl. ${m.time}, ${m.place}.\nKallelsen med förslag till dagordning finns bifogad.\n\nStyrelsen`,
      [{ filename: `kallelse-arsmote-${year}.html`, content: Buffer.from(html) }])) sent++;
  }
  await sql`UPDATE assoc_meetings SET notice_sent_at = now(), notice_count = ${sent} WHERE id = ${m.id}`;
  await auditBy(sql, actor, 'notice', 'association', actor.companyId, { year, sent, members: members.length });
  return { sent, members: members.length, late: today() > m.deadline };
}

async function yearFigures(companyId: number, year: number) {
  const fys = await sql<{ id: number }[]>`SELECT id FROM fiscal_years WHERE company_id = ${companyId} AND start_date <= ${`${year}-12-31`} AND end_date >= ${`${year}-01-01`} ORDER BY start_date LIMIT 1`;
  const s = await statements(companyId, { fy: fys[0] ? String(fys[0].id) : undefined, from: `${year}-01-01`, to: `${year}-12-31` });
  if (!s) throw new ValidationError('Föreningen saknar räkenskapsår');
  const income = s.income.groups.map((g) => ({ label: g.label, amount: g.total }));
  const groups: [string, (n: number) => boolean, number][] = [
    ['Anläggningstillgångar', (n) => n < 1400, 1], ['Omsättningstillgångar', (n) => n >= 1400 && n < 2000, 1],
    ['Eget kapital', (n) => n >= 2000 && n < 2100, -1], ['Skulder', (n) => n >= 2100 && n < 3000, -1],
  ];
  const balance = groups.map(([label, f, sign]) => ({ label, amount: sign * [...s.ub].filter(([n]) => f(n)).reduce((a, [, v]) => a + v, 0) }));
  // Eget kapital inkluderar årets ej avslutade resultat
  const closed = (s.ub.get(ASSOC_EQUITY_RESULT) ?? 0) !== 0;
  if (!closed) balance[2].amount += s.income.result;
  return { income, result: s.income.result, balance };
}

function signerList(input: Record<string, unknown>, prefix: string, label: string) {
  const out: { name: string; email: string }[] = [];
  for (let i = 0; i < 8; i++) {
    const name = str(input, `${prefix}_name_${i}`, { max: 200 });
    if (!name) continue;
    const email = str(input, `${prefix}_email_${i}`, { max: 200 });
    if (email && !EMAIL.test(email)) throw new ValidationError(`${label} ${i + 1}: ogiltig e-post`);
    out.push({ name, email });
  }
  if (!out.length) throw new ValidationError(`Ange minst en ${label.toLowerCase()}`);
  return out;
}

/** Verksamhetsberättelse med resultat- och balansräkning – underskrivs digitalt av styrelsen */
export async function createReport(actor: Actor, input: Record<string, unknown>) {
  await requireAssociation(actor.companyId);
  const year = int(input, 'year', 'Verksamhetsår');
  const m = await meetingOrFail(actor.companyId, year);
  const board = signerList(input, 'board', 'Styrelseledamot');
  const [c] = await sql<{ name: string; orgnr: string }[]>`SELECT name, orgnr FROM companies WHERE id = ${actor.companyId}`;
  const f = await yearFigures(actor.companyId, year);
  const html = reportHtml({ org: c.name, orgnr: c.orgnr, year, text: str(input, 'text', { max: 20000 }), stats: memberStats(await listMembers(actor.companyId), year), ...f, board: board.map((b) => b.name) });
  return sql.begin(async (tx) => {
    const d = await createDocument(actor, { title: `Verksamhetsberättelse ${year}`, html, signers: board, source_module: 'association', source_id: m.id,
      message: 'Verksamhetsberättelsen med resultat- och balansräkning för årsmötet. Styrelsen undertecknar.' }, tx);
    await tx`UPDATE assoc_meetings SET report_doc_id = ${d.id} WHERE id = ${m.id}`;
    return d;
  });
}

/** Revisionsberättelse – underskrivs av revisorerna */
export async function createAuditReport(actor: Actor, input: Record<string, unknown>) {
  await requireAssociation(actor.companyId);
  const year = int(input, 'year', 'Verksamhetsår');
  const m = await meetingOrFail(actor.companyId, year);
  const auditors = signerList(input, 'auditor', 'Revisor');
  const [c] = await sql<{ name: string; orgnr: string }[]>`SELECT name, orgnr FROM companies WHERE id = ${actor.companyId}`;
  const html = auditReportHtml({ org: c.name, orgnr: c.orgnr, year, auditors: auditors.map((a) => a.name), remarks: str(input, 'remarks', { max: 5000 }) });
  return sql.begin(async (tx) => {
    const d = await createDocument(actor, { title: `Revisionsberättelse ${year}`, html, signers: auditors, source_module: 'association', source_id: m.id,
      message: 'Revisionsberättelsen till årsmötet. Revisorerna undertecknar.' }, tx);
    await tx`UPDATE assoc_meetings SET audit_doc_id = ${d.id} WHERE id = ${m.id}`;
    return d;
  });
}

export async function overview(companyId: number, year: number) {
  const members = await listMembers(companyId);
  return { members, stats: memberStats(members, year), rates: await feeRates(companyId, year), fees: await feeStatus(companyId, year),
    gifts: await listGifts(companyId, year), meeting: await getMeeting(companyId, year), figures: await yearFigures(companyId, year).catch(() => null) };
}
