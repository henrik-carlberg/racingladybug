import 'server-only';
import { sql } from '@/lib/db';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { audit } from '@/lib/server/audit';
import { openingBalances } from '@/lib/server/ledger';
import { addDays } from '@/lib/format';
import { CHECKPOINTS, drawSample, ledgerEvidence, materialitySuggestion, musSample, seeded, summary, type LedgerItem, type SampleMethod, type VoucherInfo } from '@/lib/audit-work';
import { accountSums } from '@/lib/server/ledger';
import type { Ctx } from '@/lib/server/auth';
import { OPINIONS, reportText, suggestedRemarks, type Opinion } from '@/lib/audit-report';
import { warning as capitalWarning } from '@/lib/capital-control';

// Granskningen ändrar inte bokföringen. Bara revisorn (rollen revisor) granskar; bolaget ser resultatet och svarar på anmärkningar.
const log = (ctx: Ctx, action: string, entity: string, id: number | null, details?: unknown) => audit(sql, { companyId: ctx.company.id, userId: ctx.user.id, action, entity, entityId: id, details });
const reviewer = (ctx: Ctx) => { if (ctx.role !== 'auditor') throw new ForbiddenError('Bara revisorn granskar'); };

export async function engagementFor(ctx: Ctx, fyId: number, create = false) {
  const [fy] = await sql<{ id: number; start: string; end: string }[]>`SELECT id, to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS "end" FROM fiscal_years WHERE id = ${fyId} AND company_id = ${ctx.company.id}`;
  if (!fy) throw new NotFoundError('Räkenskapsåret');
  let [e] = await sql<{ id: number; materiality: number; status: string; conclusion: string }[]>`SELECT id, materiality::float8 AS materiality, status, conclusion FROM audit_engagements WHERE company_id = ${ctx.company.id} AND fiscal_year_id = ${fyId}`;
  if (!e && create) {
    reviewer(ctx);
    [e] = await sql<{ id: number; materiality: number; status: string; conclusion: string }[]>`INSERT INTO audit_engagements (company_id, fiscal_year_id, created_by) VALUES (${ctx.company.id}, ${fyId}, ${ctx.user.id})
      ON CONFLICT (company_id, fiscal_year_id) DO UPDATE SET company_id = EXCLUDED.company_id RETURNING id, materiality::float8 AS materiality, status, conclusion`;
    for (const c of CHECKPOINTS) await sql`INSERT INTO audit_checkpoints (engagement_id, key) VALUES (${e.id}, ${c.key}) ON CONFLICT DO NOTHING`;
    await log(ctx, 'start_audit', 'audit_engagement', e.id, { fiscal_year: fyId });
  }
  return { fy, engagement: e ?? null };
}

async function ownEngagement(ctx: Ctx, id: number, open = true) {
  const [e] = await sql<{ id: number; fiscal_year_id: number; status: string; start: string; end: string }[]>`SELECT e.id, e.fiscal_year_id, e.status, to_char(f.start_date,'YYYY-MM-DD') AS start, to_char(f.end_date,'YYYY-MM-DD') AS "end"
    FROM audit_engagements e JOIN fiscal_years f ON f.id = e.fiscal_year_id WHERE e.id = ${id} AND e.company_id = ${ctx.company.id}`;
  if (!e) throw new NotFoundError('Granskningen');
  if (open && e.status !== 'open') throw new ValidationError('Granskningen är avslutad');
  return e;
}

export async function setMateriality(ctx: Ctx, id: number, amount: number, o: { performance?: number | null; trivial?: number | null; basis?: string } = {}) {
  reviewer(ctx); await ownEngagement(ctx, id);
  if (!(amount >= 0)) throw new ValidationError('Ogiltigt belopp');
  // Genomförandeväsentlighet (normalt 50–75 %) och obetydlighetsgräns (normalt 5 %) – lägre än väsentligheten
  const perf = o.performance ?? Math.floor((amount * 0.75) / 10000) * 10000;
  const triv = o.trivial ?? Math.floor((amount * 0.05) / 10000) * 10000;
  if (!(perf >= 0 && perf <= amount) || !(triv >= 0 && triv <= perf)) throw new ValidationError('Genomförandeväsentligheten ska vara högst väsentligheten och obetydlighetsgränsen högst genomförandeväsentligheten');
  await sql`UPDATE audit_engagements SET materiality = ${amount}, performance = ${perf}, trivial = ${triv}, materiality_basis = ${(o.basis ?? '').slice(0, 200)} WHERE id = ${id}`;
  await log(ctx, 'materiality', 'audit_engagement', id, { amount, perf, triv });
}

/** Riktmärken för väsentlighet ur räkenskapsårets bokföring */
export async function materialityBasis(ctx: Ctx, id: number) {
  const e = await ownEngagement(ctx, id, false);
  const sums = await accountSums(ctx.company.id, e.start, e.end);
  let revenue = 0, pl = 0;
  for (const [n, v] of sums) { if (n >= 3000 && n <= 3999) revenue -= v; if (n >= 3000 && n <= 8899) pl -= v; }
  const bal = await openingBalances(ctx.company.id, addDays(e.end, 1));
  const assets = [...bal].filter(([k]) => k >= 1000 && k <= 1999).reduce((s2, [, v]) => s2 + Number(v), 0);
  return materialitySuggestion({ revenue, profit: pl, assets });
}

/** Öppna poster i kund- eller leverantörsreskontran per balansdagen, med betalningar efter balansdagen */
export async function openItems(companyId: number, kind: 'customer' | 'supplier', end: string): Promise<LedgerItem[]> {
  const rows = kind === 'customer'
    ? await sql<{ id: number; ref: string; party: string; date: string; due: string; total: number; before: number; after: number; after_date: string | null }[]>`
      SELECT i.id, i.invoice_number::text AS ref, c.name AS party, to_char(i.invoice_date,'YYYY-MM-DD') AS date, to_char(i.due_date,'YYYY-MM-DD') AS due, i.total::float8 AS total,
        COALESCE((SELECT SUM(p.amount) FROM invoice_payments p WHERE p.invoice_id = i.id AND p.date <= ${end}), 0)::float8 AS before,
        COALESCE((SELECT SUM(p.amount) FROM invoice_payments p WHERE p.invoice_id = i.id AND p.date > ${end}), 0)::float8 AS after,
        (SELECT to_char(MAX(p.date),'YYYY-MM-DD') FROM invoice_payments p WHERE p.invoice_id = i.id AND p.date > ${end}) AS after_date
      FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.company_id = ${companyId} AND i.status IN ('booked','paid') AND i.invoice_date <= ${end} AND i.total > 0 AND i.credit_of_id IS NULL AND i.invoice_number IS NOT NULL`
    : await sql<{ id: number; ref: string; party: string; date: string; due: string; total: number; before: number; after: number; after_date: string | null }[]>`
      SELECT s.id, s.invoice_number AS ref, p.name AS party, to_char(s.invoice_date,'YYYY-MM-DD') AS date, to_char(s.due_date,'YYYY-MM-DD') AS due, s.total::float8 AS total,
        COALESCE((SELECT SUM(x.amount) FROM supplier_invoice_payments x WHERE x.supplier_invoice_id = s.id AND x.date <= ${end}), 0)::float8 AS before,
        COALESCE((SELECT SUM(x.amount) FROM supplier_invoice_payments x WHERE x.supplier_invoice_id = s.id AND x.date > ${end}), 0)::float8 AS after,
        (SELECT to_char(MAX(x.date),'YYYY-MM-DD') FROM supplier_invoice_payments x WHERE x.supplier_invoice_id = s.id AND x.date > ${end}) AS after_date
      FROM supplier_invoices s JOIN suppliers p ON p.id = s.supplier_id WHERE s.company_id = ${companyId} AND s.invoice_date <= ${end} AND s.total > 0`;
  return rows.map((r) => ({ id: r.id, kind, ref: r.ref, party: r.party, date: r.date, due: r.due, open: r.total - r.before, paidAfter: r.after, paidAfterDate: r.after_date }))
    .filter((r) => r.open > 0);
}

/** Stickprov ur reskontran per balansdagen: beloppsviktat (MUS), största posterna eller slumpmässigt */
export async function addLedgerSample(ctx: Ctx, id: number, o: { kind: 'customer' | 'supplier'; method: 'mus' | 'largest' | 'random'; count?: number }) {
  reviewer(ctx);
  const e = await ownEngagement(ctx, id);
  const [eng] = await sql<{ m: number; perf: number }[]>`SELECT materiality::float8 AS m, performance::float8 AS perf FROM audit_engagements WHERE id = ${id}`;
  const items = await openItems(ctx.company.id, o.kind, e.end);
  const n = Math.min(100, Math.max(1, o.count ?? 10));
  const kr = (x: number) => `${Math.round(x / 100).toLocaleString('sv-SE')} kr`;
  let picked: { id: number; reason: string }[];
  if (o.method === 'mus') {
    const interval = eng.perf || Math.floor(eng.m * 0.75);
    if (!interval) throw new ValidationError('Sätt väsentlighet först – intervallet för beloppsviktat urval är genomförandeväsentligheten');
    picked = musSample(items.map((i) => ({ id: i.id, amount: i.open })), interval, id * 7919 + items.length);
  } else if (o.method === 'largest') {
    picked = [...items].sort((a, b) => b.open - a.open).slice(0, n).map((i) => ({ id: i.id, reason: `Bland de största posterna (${kr(i.open)})` }));
  } else {
    const rnd = seeded(id * 31 + items.length), pool = [...items].sort((a, b) => a.id - b.id);
    for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
    picked = pool.slice(0, n).map((i) => ({ id: i.id, reason: 'Slumpmässigt urval' }));
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  let added = 0;
  for (const p of picked) {
    const it = byId.get(p.id)!;
    const r = o.kind === 'customer'
      ? await sql`INSERT INTO audit_ledger_samples (engagement_id, kind, invoice_id, open_amount, method, reason) VALUES (${id}, 'customer', ${p.id}, ${it.open}, ${o.method}, ${p.reason}) ON CONFLICT DO NOTHING RETURNING id`
      : await sql`INSERT INTO audit_ledger_samples (engagement_id, kind, supplier_invoice_id, open_amount, method, reason) VALUES (${id}, 'supplier', ${p.id}, ${it.open}, ${o.method}, ${p.reason}) ON CONFLICT DO NOTHING RETURNING id`;
    added += r.length;
  }
  await log(ctx, 'ledger_sample', 'audit_engagement', id, { kind: o.kind, method: o.method, added });
  return { added, population: items.length, value: items.reduce((s2, i) => s2 + i.open, 0) };
}

export async function reviewLedgerSample(ctx: Ctx, engId: number, sampleId: number, status: 'ok' | 'remark' | 'pending', comment: string) {
  reviewer(ctx); await ownEngagement(ctx, engId);
  if (!['ok', 'remark', 'pending'].includes(status)) throw new ValidationError('Ogiltig status');
  if (status === 'remark' && !comment.trim()) throw new ValidationError('Skriv vad anmärkningen gäller');
  const r = await sql`UPDATE audit_ledger_samples SET status = ${status}, comment = ${comment.trim().slice(0, 2000)}, reviewed_by = ${ctx.user.id}, reviewed_at = now() WHERE id = ${sampleId} AND engagement_id = ${engId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Stickprovet');
  await log(ctx, 'review_ledger_sample', 'audit_ledger_sample', sampleId, { status });
}

async function ledgerSamples(companyId: number, engId: number, end: string) {
  const rows = await sql<{ id: number; kind: 'customer' | 'supplier'; ref_id: number; open_amount: number; method: string; reason: string; status: 'pending' | 'ok' | 'remark'; comment: string; sent: boolean }[]>`
    SELECT id, kind, COALESCE(invoice_id, supplier_invoice_id) AS ref_id, open_amount::float8 AS open_amount, method, reason, status, comment, sent_at IS NOT NULL AS sent
    FROM audit_ledger_samples WHERE engagement_id = ${engId} ORDER BY kind, open_amount DESC`;
  if (!rows.length) return [];
  const items = new Map<string, LedgerItem>();
  for (const k of ['customer', 'supplier'] as const) if (rows.some((r) => r.kind === k)) for (const i of await openItems(companyId, k, end)) items.set(`${k}:${i.id}`, i);
  return rows.map((r) => {
    const it = items.get(`${r.kind}:${r.ref_id}`);
    const ev = it ? ledgerEvidence(it, end) : { status: 'paid' as const, text: 'Posten är inte längre öppen per balansdagen' };
    return { ...r, ref: it?.ref ?? '', party: it?.party ?? '', date: it?.date ?? '', due: it?.due ?? '', evidence: ev };
  });
}

export async function addSample(ctx: Ctx, id: number, o: { method: SampleMethod; count?: number; from?: number; to?: number; userId?: number; threshold?: number }) {
  reviewer(ctx);
  const e = await ownEngagement(ctx, id);
  const [{ m, perf }] = await sql<{ m: number; perf: number }[]>`SELECT materiality::float8 AS m, performance::float8 AS perf FROM audit_engagements WHERE id = ${id}`;
  if (o.method === 'mus' && !(perf || m)) throw new ValidationError('Sätt väsentlighet först – intervallet för beloppsviktat urval är genomförandeväsentligheten');
  const vs = await sql<VoucherInfo[]>`SELECT v.id, to_char(v.date,'YYYY-MM-DD') AS date, SUM(l.debit)::float8 AS amount, v.created_by AS user_id, COALESCE(v.source_type, 'manual') AS source_type, array_agg(DISTINCT l.account_number) AS accounts
    FROM vouchers v JOIN voucher_lines l ON l.voucher_id = v.id WHERE v.company_id = ${ctx.company.id} AND v.date BETWEEN ${e.start} AND ${e.end} AND COALESCE(v.source_type, '') <> 'opening_balance'
    GROUP BY v.id ORDER BY v.id`;
  const picked = drawSample(vs.map((v) => ({ ...v, amount: Number(v.amount) })), { ...o, threshold: o.threshold ?? (o.method === 'mus' ? perf || Math.floor(m * 0.75) : m), seed: id * 1000 + vs.length });
  let n = 0;
  for (const p of picked) { const r = await sql`INSERT INTO audit_samples (engagement_id, voucher_id, method, reason) VALUES (${id}, ${p.id}, ${o.method}, ${p.reason}) ON CONFLICT DO NOTHING RETURNING id`; n += r.length; }
  await log(ctx, 'sample', 'audit_engagement', id, { method: o.method, added: n });
  return n;
}

export async function reviewSample(ctx: Ctx, engId: number, sampleId: number, status: 'ok' | 'remark' | 'pending', comment: string) {
  reviewer(ctx); await ownEngagement(ctx, engId);
  if (status === 'remark' && !comment.trim()) throw new ValidationError('Skriv vad anmärkningen gäller');
  const r = await sql`UPDATE audit_samples SET status = ${status}, comment = ${comment.trim().slice(0, 2000)}, reviewed_by = ${ctx.user.id}, reviewed_at = now() WHERE id = ${sampleId} AND engagement_id = ${engId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Stickprovet');
  await log(ctx, 'review_sample', 'audit_sample', sampleId, { status });
}
export async function reviewCheckpoint(ctx: Ctx, engId: number, key: string, status: 'ok' | 'remark' | 'pending', comment: string) {
  reviewer(ctx); await ownEngagement(ctx, engId);
  if (status === 'remark' && !comment.trim()) throw new ValidationError('Skriv vad anmärkningen gäller');
  const r = await sql`UPDATE audit_checkpoints SET status = ${status}, comment = ${comment.trim().slice(0, 2000)}, reviewed_by = ${ctx.user.id}, reviewed_at = now() WHERE engagement_id = ${engId} AND key = ${key} RETURNING id`;
  if (!r.length) throw new NotFoundError('Kontrollpunkten');
  await log(ctx, 'review_checkpoint', 'audit_checkpoint', r[0].id as number, { key, status });
}

/** Anmärkningar skickas till bolaget: på stickprov som kommentar på verifikationen (bolaget svarar där), på kontrollpunkter på granskningssidan */
export async function sendRemarks(ctx: Ctx, engId: number) {
  reviewer(ctx); await ownEngagement(ctx, engId);
  const samples = await sql<{ id: number; voucher_id: number; comment: string }[]>`SELECT id, voucher_id, comment FROM audit_samples WHERE engagement_id = ${engId} AND status = 'remark' AND sent_at IS NULL`;
  const cps = await sql<{ id: number; key: string; comment: string }[]>`SELECT id, key, comment FROM audit_checkpoints WHERE engagement_id = ${engId} AND status = 'remark' AND sent_at IS NULL`;
  let ledgerSent = 0;
  await sql.begin(async (tx) => {
    for (const s of samples) {
      await tx`INSERT INTO comments (company_id, entity, entity_id, user_id, body) VALUES (${ctx.company.id}, 'voucher', ${s.voucher_id}, ${ctx.user.id}, ${`Revisionsanmärkning: ${s.comment}`})`;
      await tx`UPDATE audit_samples SET sent_at = now() WHERE id = ${s.id}`;
    }
    // Anmärkningar på kontrollpunkter visas för bolaget på granskningssidan
    for (const c of cps) await tx`UPDATE audit_checkpoints SET sent_at = now() WHERE id = ${c.id}`;
    ledgerSent = (await tx`UPDATE audit_ledger_samples SET sent_at = now() WHERE engagement_id = ${engId} AND status = 'remark' AND sent_at IS NULL RETURNING id`).length;
  });
  await log(ctx, 'send_remarks', 'audit_engagement', engId, { samples: samples.length, checkpoints: cps.length, ledger: ledgerSent });
  return samples.length + cps.length + ledgerSent;
}

export async function closeEngagement(ctx: Ctx, engId: number, conclusion: string) {
  reviewer(ctx); await ownEngagement(ctx, engId);
  const w = await workspace(ctx, engId);
  if (!w.summary.done) throw new ValidationError('Granska alla stickprov och kontrollpunkter först');
  await sql`UPDATE audit_engagements SET status = 'closed', conclusion = ${conclusion.trim().slice(0, 4000)}, closed_at = now() WHERE id = ${engId}`;
  await log(ctx, 'close_audit', 'audit_engagement', engId);
}

export async function workspace(ctx: Ctx, engId: number) {
  const e = await ownEngagement(ctx, engId, false);
  const [eng] = await sql<{ materiality: number; performance: number; trivial: number; materiality_basis: string; status: string; conclusion: string; closed: string | null }[]>`SELECT materiality::float8 AS materiality, performance::float8 AS performance, trivial::float8 AS trivial, materiality_basis, status, conclusion, to_char(closed_at,'YYYY-MM-DD') AS closed FROM audit_engagements WHERE id = ${engId}`;
  const ledger = await ledgerSamples(ctx.company.id, engId, e.end);
  const samples = await sql<{ id: number; voucher_id: number; label: string; date: string; text: string; amount: number; method: string; reason: string; status: 'pending' | 'ok' | 'remark'; comment: string; sent: boolean; attachments: number }[]>`
    SELECT s.id, s.voucher_id, v.series || v.number AS label, to_char(v.date,'YYYY-MM-DD') AS date, v.description AS text,
      (SELECT SUM(debit)::float8 FROM voucher_lines WHERE voucher_id = v.id) AS amount, s.method, s.reason, s.status, s.comment, s.sent_at IS NOT NULL AS sent,
      (SELECT count(*)::int FROM attachments a WHERE a.voucher_id = v.id) AS attachments
    FROM audit_samples s JOIN vouchers v ON v.id = s.voucher_id WHERE s.engagement_id = ${engId} ORDER BY v.date, v.id`;
  const cps = await sql<{ key: string; status: 'pending' | 'ok' | 'remark'; comment: string; sent: boolean }[]>`SELECT key, status, comment, sent_at IS NOT NULL AS sent FROM audit_checkpoints WHERE engagement_id = ${engId}`;
  const bal = await openingBalances(ctx.company.id, addDays(e.end, 1));
  const [{ unmatched }] = await sql<{ unmatched: number }[]>`SELECT count(*)::int AS unmatched FROM bank_transactions WHERE company_id = ${ctx.company.id} AND status = 'unmatched' AND booking_date <= ${e.end}`;
  const [{ old }] = await sql<{ old: number }[]>`SELECT COALESCE(SUM(total - paid_amount), 0)::float8 AS old FROM invoices WHERE company_id = ${ctx.company.id} AND status = 'booked' AND due_date < ${e.end}::date - 90`;
  const [integ] = await sql<{ errors: number; run: string }[]>`SELECT errors, to_char(run_at,'YYYY-MM-DD') AS run FROM integrity_runs WHERE company_id = ${ctx.company.id} ORDER BY run_at DESC LIMIT 1`;
  const sumRange = (a: number, b: number) => [...bal].filter(([k]) => k >= a && k <= b).reduce((s, [, v]) => s + Number(v), 0);
  const checkpoints = CHECKPOINTS.map((c) => {
    const row = cps.find((x) => x.key === c.key);
    const hints: string[] = [];
    if (c.key === 'bank' && unmatched) hints.push(`${unmatched} banktransaktioner är inte avstämda`);
    if (c.key === 'kundfordringar' && old) hints.push(`Fordringar mer än 90 dagar efter förfallodag: ${Math.round(old / 100).toLocaleString('sv-SE')} kr`);
    return { ...c, balance: c.from >= 3000 ? null : sumRange(c.from, c.to), status: row?.status ?? 'pending', comment: row?.comment ?? '', sent: !!row?.sent, hints };
  });
  return { ...e, ...eng, samples: [...samples], ledger, checkpoints, summary: summary([...samples, ...ledger], checkpoints), integrity: integ ?? null };
}

export async function engagements(companyId: number) {
  return [...await sql<{ id: number; fy: number; start: string; end: string; status: string; samples: number; remarks: number }[]>`
    SELECT e.id, f.id AS fy, to_char(f.start_date,'YYYY-MM-DD') AS start, to_char(f.end_date,'YYYY-MM-DD') AS "end", e.status,
      (SELECT count(*)::int FROM audit_samples s WHERE s.engagement_id = e.id) AS samples,
      (SELECT count(*)::int FROM audit_samples s WHERE s.engagement_id = e.id AND s.status = 'remark') + (SELECT count(*)::int FROM audit_checkpoints c WHERE c.engagement_id = e.id AND c.status = 'remark') AS remarks
    FROM audit_engagements e JOIN fiscal_years f ON f.id = e.fiscal_year_id WHERE e.company_id = ${companyId} ORDER BY f.start_date DESC`];
}

/** Förslag på anmärkningar: förbjudna lån, kapitalbrist och underskott på skattekontot på balansdagen */
export async function reportIndicators(companyId: number, end: string) {
  const bal = await openingBalances(companyId, addDays(end, 1));
  const balances = new Map([...bal].map(([k, v]) => [k, Number(v)]));
  const [loans] = await sql<{ amount: number }[]>`SELECT COALESCE(SUM(amount - repaid), 0)::float8 AS amount FROM owner_loans WHERE company_id = ${companyId}
    AND relation IN ('owner','board','ceo','related') AND purpose = 'private' AND loan_date <= ${end}`;
  const tax = balances.get(1630) ?? 0;
  return suggestedRemarks({ forbiddenLoans: loans.amount, deficit: !!capitalWarning(balances), taxDeficit: tax < 0 ? -tax : 0 });
}

export async function auditReport(companyId: number, engId: number) {
  const [r] = await sql<{ opinion: Opinion; basis: string; remarks: string; adopt: boolean; discharge: boolean; place: string; signer_name: string; signed_on: string; start: string; end: string; company: string; orgnr: string }[]>`
    SELECT r.opinion, r.basis, r.remarks, r.adopt, r.discharge, r.place, r.signer_name, to_char(r.signed_on,'YYYY-MM-DD') AS signed_on, to_char(f.start_date,'YYYY-MM-DD') AS start,
      to_char(f.end_date,'YYYY-MM-DD') AS "end", c.name AS company, c.orgnr
    FROM audit_reports r JOIN audit_engagements e ON e.id = r.engagement_id JOIN fiscal_years f ON f.id = e.fiscal_year_id JOIN companies c ON c.id = r.company_id
    WHERE r.engagement_id = ${engId} AND r.company_id = ${companyId}`;
  if (!r) return null;
  const remarks = r.remarks.split('\n').map((x) => x.trim()).filter(Boolean);
  return { ...r, remarkList: remarks, sections: reportText({ company: r.company, orgnr: r.orgnr, start: r.start, end: r.end, opinion: r.opinion, basis: r.basis, remarks, adopt: r.adopt, discharge: r.discharge, auditor: r.signer_name, place: r.place, date: r.signed_on }) };
}

/** Revisorn upprättar och signerar revisionsberättelsen när granskningen är avslutad. Den kan inte ändras efteråt. */
export async function issueReport(ctx: Ctx, engId: number, input: { opinion: string; basis: string; remarks: string; adopt: boolean; discharge: boolean; place: string; date: string }) {
  reviewer(ctx);
  const e = await ownEngagement(ctx, engId, false);
  if (e.status !== 'closed') throw new ValidationError('Avsluta granskningen innan revisionsberättelsen upprättas');
  if (!(input.opinion in OPINIONS)) throw new ValidationError('Välj uttalande');
  const opinion = input.opinion as Opinion;
  const basis = input.basis.trim().slice(0, 4000);
  if (opinion !== 'clean' && !basis) throw new ValidationError('Beskriv grunden för det modifierade uttalandet');
  const place = input.place.trim().slice(0, 100);
  if (!place) throw new ValidationError('Ange ort');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date <= e.end) throw new ValidationError('Revisionsberättelsen dateras efter räkenskapsårets slut');
  const remarks = input.remarks.trim().slice(0, 4000);
  // Anmärkning i förvaltningen och ansvarsfrihet hänger ihop: med anmärkning ska revisorn ta ställning, men tillstyrkan är möjlig
  const r = await sql`INSERT INTO audit_reports ${sql({ engagement_id: engId, company_id: ctx.company.id, opinion, basis, remarks, adopt: input.adopt, discharge: input.discharge, place,
    signed_by: ctx.user.id, signer_name: ctx.user.name, signed_on: input.date })} ON CONFLICT (engagement_id) DO NOTHING RETURNING engagement_id`;
  if (!r.length) throw new ValidationError('Revisionsberättelsen är redan signerad');
  await log(ctx, 'audit_report', 'audit_engagement', engId, { opinion, remarks: !!remarks, discharge: input.discharge });
}
