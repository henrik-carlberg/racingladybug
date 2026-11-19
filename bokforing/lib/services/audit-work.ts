import 'server-only';
import { sql } from '@/lib/db';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { audit } from '@/lib/server/audit';
import { openingBalances } from '@/lib/server/ledger';
import { addDays } from '@/lib/format';
import { CHECKPOINTS, drawSample, summary, type SampleMethod, type VoucherInfo } from '@/lib/audit-work';
import type { Ctx } from '@/lib/server/auth';

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

export async function setMateriality(ctx: Ctx, id: number, amount: number) {
  reviewer(ctx); await ownEngagement(ctx, id);
  if (!(amount >= 0)) throw new ValidationError('Ogiltigt belopp');
  await sql`UPDATE audit_engagements SET materiality = ${amount} WHERE id = ${id}`;
  await log(ctx, 'materiality', 'audit_engagement', id, { amount });
}

export async function addSample(ctx: Ctx, id: number, o: { method: SampleMethod; count?: number; from?: number; to?: number; userId?: number; threshold?: number }) {
  reviewer(ctx);
  const e = await ownEngagement(ctx, id);
  const [{ m }] = await sql<{ m: number }[]>`SELECT materiality::float8 AS m FROM audit_engagements WHERE id = ${id}`;
  const vs = await sql<VoucherInfo[]>`SELECT v.id, to_char(v.date,'YYYY-MM-DD') AS date, SUM(l.debit)::float8 AS amount, v.created_by AS user_id, COALESCE(v.source_type, 'manual') AS source_type, array_agg(DISTINCT l.account_number) AS accounts
    FROM vouchers v JOIN voucher_lines l ON l.voucher_id = v.id WHERE v.company_id = ${ctx.company.id} AND v.date BETWEEN ${e.start} AND ${e.end} AND COALESCE(v.source_type, '') <> 'opening_balance'
    GROUP BY v.id ORDER BY v.id`;
  const picked = drawSample(vs.map((v) => ({ ...v, amount: Number(v.amount) })), { ...o, threshold: o.threshold ?? m, seed: id * 1000 + vs.length });
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
  await sql.begin(async (tx) => {
    for (const s of samples) {
      await tx`INSERT INTO comments (company_id, entity, entity_id, user_id, body) VALUES (${ctx.company.id}, 'voucher', ${s.voucher_id}, ${ctx.user.id}, ${`Revisionsanmärkning: ${s.comment}`})`;
      await tx`UPDATE audit_samples SET sent_at = now() WHERE id = ${s.id}`;
    }
    // Anmärkningar på kontrollpunkter visas för bolaget på granskningssidan
    for (const c of cps) await tx`UPDATE audit_checkpoints SET sent_at = now() WHERE id = ${c.id}`;
  });
  await log(ctx, 'send_remarks', 'audit_engagement', engId, { samples: samples.length, checkpoints: cps.length });
  return samples.length + cps.length;
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
  const [eng] = await sql<{ materiality: number; status: string; conclusion: string; closed: string | null }[]>`SELECT materiality::float8 AS materiality, status, conclusion, to_char(closed_at,'YYYY-MM-DD') AS closed FROM audit_engagements WHERE id = ${engId}`;
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
  return { ...e, ...eng, samples: [...samples], checkpoints, summary: summary(samples, checkpoints), integrity: integ ?? null };
}

export async function engagements(companyId: number) {
  return [...await sql<{ id: number; fy: number; start: string; end: string; status: string; samples: number; remarks: number }[]>`
    SELECT e.id, f.id AS fy, to_char(f.start_date,'YYYY-MM-DD') AS start, to_char(f.end_date,'YYYY-MM-DD') AS "end", e.status,
      (SELECT count(*)::int FROM audit_samples s WHERE s.engagement_id = e.id) AS samples,
      (SELECT count(*)::int FROM audit_samples s WHERE s.engagement_id = e.id AND s.status = 'remark') + (SELECT count(*)::int FROM audit_checkpoints c WHERE c.engagement_id = e.id AND c.status = 'remark') AS remarks
    FROM audit_engagements e JOIN fiscal_years f ON f.id = e.fiscal_year_id WHERE e.company_id = ${companyId} ORDER BY f.start_date DESC`];
}
