import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { INTEREST, SUBJECTS, SURCHARGE, TAX_ACCOUNT, appealDeadline, decisionLines, requestStatus, type Subject } from '@/lib/tax-audits';
import type { Actor } from './actor';
import { date, int, str } from './input';

type Audit = { id: number; kind: 'revision' | 'inquiry'; subject: Subject; tax_year: number; reference: string; opened_on: string; status: string; memo_on: string | null; decision_on: string | null; tax_amount: number; surcharge: number; interest: number; disputed: boolean; appeal_deadline: string | null; appealed_on: string | null; outcome: string; voucher_id: number | null };

export async function overview(companyId: number) {
  const t = today();
  const audits = await sql<Audit[]>`SELECT id, kind, subject, tax_year, reference, to_char(opened_on,'YYYY-MM-DD') AS opened_on, status, to_char(memo_on,'YYYY-MM-DD') AS memo_on, to_char(decision_on,'YYYY-MM-DD') AS decision_on,
      tax_amount::float8 AS tax_amount, surcharge::float8 AS surcharge, interest::float8 AS interest, disputed, to_char(appeal_deadline,'YYYY-MM-DD') AS appeal_deadline, to_char(appealed_on,'YYYY-MM-DD') AS appealed_on, outcome, voucher_id
    FROM tax_audits WHERE company_id = ${companyId} ORDER BY CASE status WHEN 'closed' THEN 1 ELSE 0 END, opened_on DESC`;
  const reqs = audits.length ? await sql<{ id: number; audit_id: number; item: string; due_date: string; answered_on: string | null; note: string }[]>`SELECT id, audit_id, item, to_char(due_date,'YYYY-MM-DD') AS due_date, to_char(answered_on,'YYYY-MM-DD') AS answered_on, note
    FROM tax_audit_requests WHERE company_id = ${companyId} AND audit_id IN ${sql(audits.map((a) => a.id))} ORDER BY due_date` : [];
  const list = audits.map((a) => ({ ...a, total: a.tax_amount + a.surcharge + a.interest, requests: reqs.filter((r) => r.audit_id === a.id).map((r) => ({ ...r, state: requestStatus(r.due_date, r.answered_on, t) })) }));
  return { audits: list, pending: list.flatMap((a) => a.requests.filter((r) => r.state === 'late' || r.state === 'soon').map((r) => ({ ...r, audit: a }))), disputed: list.filter((a) => a.disputed && a.status !== 'closed').reduce((s, a) => s + a.total, 0) };
}

export async function open(actor: Actor, input: Record<string, unknown>) {
  const kind = input.kind === 'inquiry' ? 'inquiry' : 'revision';
  const subject = String(input.subject) as Subject;
  if (!Object.prototype.hasOwnProperty.call(SUBJECTS, subject)) throw new ValidationError('Välj vad revisionen gäller');
  const year = int(input, 'tax_year', 'Beskattningsår');
  if (year < 2000 || year > Number(today().slice(0, 4))) throw new ValidationError('Ogiltigt beskattningsår');
  const [r] = await sql<{ id: number }[]>`INSERT INTO tax_audits ${sql({ company_id: actor.companyId, kind, subject, tax_year: year, reference: str(input, 'reference', { max: 60 }), opened_on: date(input, 'opened_on', 'Inledd'), appeal_deadline: appealDeadline(year), created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'tax_audit', 'tax_audit', r.id, { kind, subject, year });
  return r.id;
}

const own = async (actor: Actor, id: number) => {
  const [a] = await sql<Audit[]>`SELECT id, subject, tax_year, status, voucher_id, disputed, tax_amount::float8 AS tax_amount, surcharge::float8 AS surcharge, interest::float8 AS interest FROM tax_audits WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!a) throw new NotFoundError('Ärendet');
  return a;
};

export async function addRequest(actor: Actor, id: number, input: Record<string, unknown>) {
  const a = await own(actor, id);
  if (a.status === 'closed') throw new ConflictError('Ärendet är avslutat');
  await sql`INSERT INTO tax_audit_requests ${sql({ audit_id: id, company_id: actor.companyId, item: str(input, 'item', { required: true, label: 'Begärd handling', max: 500 }), due_date: date(input, 'due_date', 'Svara senast') })}`;
}

export async function answer(actor: Actor, requestId: number, input: Record<string, unknown>) {
  const r = await sql`UPDATE tax_audit_requests SET answered_on = ${today()}, note = ${str(input, 'note', { max: 1000 })} WHERE id = ${requestId} AND company_id = ${actor.companyId} AND answered_on IS NULL`;
  if (!r.count) throw new NotFoundError('Begäran');
}

const money = (input: Record<string, unknown>, k: string) => { const s = String(input[k] ?? '').trim(); if (!s) return 0; const v = parseAmount(s); if (v == null || v < 0) throw new ValidationError('Ogiltigt belopp'); return v; };

/** Beslut: beloppen belastar skattekontot och bokförs; tvistiga beslut kan överklagas till och med fristen */
export async function decide(actor: Actor, id: number, input: Record<string, unknown>) {
  const a = await own(actor, id);
  if (a.status !== 'open') throw new ConflictError('Ärendet har redan ett beslut');
  const tax = money(input, 'tax_amount'), surcharge = money(input, 'surcharge'), interest = money(input, 'interest');
  const d = date(input, 'decision_on', 'Beslutsdatum');
  return sql.begin(async (tx) => {
    let voucherId: number | null = null;
    const lines = decisionLines(a.subject, tax, surcharge, interest);
    if (lines.length) {
      const names: [number, string][] = [[SUBJECTS[a.subject].account, SUBJECTS[a.subject].name], [SURCHARGE, 'Övriga externa kostnader, ej avdragsgilla'], [INTEREST, 'Räntekostnader för skatter och avgifter'], [TAX_ACCOUNT, 'Avräkning för skatter och avgifter (skattekonto)']];
      for (const [n, name] of names) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n}, ${name}) ON CONFLICT DO NOTHING`;
      voucherId = (await createVoucher(tx, { actor, date: d, description: `Beslut efter skatterevision ${SUBJECTS[a.subject].label.toLowerCase()} ${a.tax_year}`, lines: fromSigned(lines), sourceType: 'tax_audit', sourceId: id })).id;
    }
    await tx`UPDATE tax_audits SET status = 'decided', decision_on = ${d}, memo_on = COALESCE(memo_on, ${date(input, 'memo_on', 'Revisionspromemoria', false) || null}), tax_amount = ${tax}, surcharge = ${surcharge}, interest = ${interest},
      disputed = ${input.disputed === 'on'}, voucher_id = ${voucherId} WHERE id = ${id}`;
    await auditBy(tx, actor, 'tax_audit_decided', 'tax_audit', id, { total: tax + surcharge + interest });
    return { total: tax + surcharge + interest, booked: !!voucherId };
  });
}

export async function appeal(actor: Actor, id: number, input: Record<string, unknown>) {
  const [a] = await sql<{ status: string; deadline: string }[]>`SELECT status, to_char(appeal_deadline,'YYYY-MM-DD') AS deadline FROM tax_audits WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!a) throw new NotFoundError('Ärendet');
  if (a.status !== 'decided') throw new ConflictError('Bara ett beslutat ärende kan överklagas');
  const d = date(input, 'appealed_on', 'Överklagat', false) || today();
  if (d > a.deadline) throw new ValidationError(`Fristen för omprövning och överklagande gick ut ${a.deadline}`);
  await sql`UPDATE tax_audits SET status = 'appealed', appealed_on = ${d}, disputed = true WHERE id = ${id}`;
  return a.deadline;
}

/** Avslut med utfall; ändrat beslut bokförs som en ny verifikation mot skattekontot */
export async function close(actor: Actor, id: number, input: Record<string, unknown>) {
  const a = await own(actor, id);
  if (a.status === 'closed' || a.status === 'open') throw new ConflictError(a.status === 'open' ? 'Ärendet har inget beslut' : 'Ärendet är redan avslutat');
  const outcome = str(input, 'outcome', { required: true, label: 'Utfall', max: 1000 });
  const refund = money(input, 'refund');
  if (refund > a.tax_amount + a.surcharge + a.interest) throw new ValidationError('Återbetalningen kan inte vara större än det beslutade beloppet');
  await sql.begin(async (tx) => {
    if (refund) {
      // Nedsättningen fördelas i ordningen skattetillägg, ränta, skatt
      const s = Math.min(refund, a.surcharge), i = Math.min(refund - s, a.interest), tx_ = refund - s - i;
      const lines = decisionLines(a.subject, tx_, s, i).map((l) => ({ ...l, amount: -l.amount }));
      await createVoucher(tx, { actor, date: today(), description: `Ändrat beslut efter omprövning ${SUBJECTS[a.subject].label.toLowerCase()} ${a.tax_year}`, lines: fromSigned(lines), sourceType: 'tax_audit', sourceId: id });
    }
    await tx`UPDATE tax_audits SET status = 'closed', outcome = ${outcome}, disputed = false WHERE id = ${id}`;
  });
  return refund;
}
