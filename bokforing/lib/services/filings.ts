import 'server-only';
import { createHash } from 'node:crypto';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { buildEskd } from '@/lib/eskd';
import { authorityEnabled, authorityFor, authorityStatus, submitToAuthority, type FilingKind } from '@/lib/server/authorities';
import type { Actor } from './actor';
import { markDeadline } from './deadlines';
import { requireVerified } from './identity';
import { getVatReport } from './reports';

export const KIND_LABEL: Record<FilingKind, string> = { moms: 'Momsdeklaration', agi: 'Arbetsgivardeklaration', arsredovisning: 'Årsredovisning' };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function save(actor: Actor, f: { kind: FilingKind; period: string; deadlineKey: string; refId?: number | null; filename: string; payload: string }) {
  // Samma period: en ny version ersätter ett förberett utkast, men inte en inlämnad deklaration
  const [prev] = await sql<{ id: number; status: string }[]>`SELECT id, status FROM filings WHERE company_id = ${actor.companyId} AND kind = ${f.kind} AND period = ${f.period} ORDER BY id DESC LIMIT 1`;
  if (prev && prev.status !== 'prepared' && prev.status !== 'rejected') throw new ConflictError(`${KIND_LABEL[f.kind]} för perioden är redan inlämnad`);
  if (prev?.status === 'prepared') await sql`DELETE FROM filings WHERE id = ${prev.id}`;
  const [r] = await sql<{ id: number }[]>`INSERT INTO filings (company_id, kind, period, deadline_key, ref_id, filename, payload, sha256, created_by)
    VALUES (${actor.companyId}, ${f.kind}, ${f.period}, ${f.deadlineKey}, ${f.refId ?? null}, ${f.filename}, ${f.payload}, ${sha(f.payload)}, ${actor.userId}) RETURNING id`;
  await auditBy(sql, actor, 'prepare', 'filing', r.id, { kind: f.kind, period: f.period });
  return r.id;
}

export async function prepareVat(actor: Actor, from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new ValidationError('Ogiltig period');
  const r = await getVatReport(actor.companyId, from, to);
  const [c] = await sql<{ orgnr: string }[]>`SELECT orgnr FROM companies WHERE id = ${actor.companyId}`;
  const payload = buildEskd({ orgnr: c.orgnr, periodEnd: to, boxes: r.boxes });
  return save(actor, { kind: 'moms', period: `${from}:${to}`, deadlineKey: `vat:${from}:${to}`, filename: `moms_${to.slice(0, 7)}.eskd`, payload });
}

export async function prepareAgi(actor: Actor, runId: number) {
  const { buildAgiForRun } = await import('./payroll');
  const { filename, xml } = await buildAgiForRun(actor, runId);
  const [run] = await sql<{ period: string }[]>`SELECT period FROM payroll_runs WHERE id = ${runId} AND company_id = ${actor.companyId}`;
  return save(actor, { kind: 'agi', period: run.period, deadlineKey: `agi:${run.period}`, refId: runId, filename, payload: xml });
}

export async function prepareAnnualReport(actor: Actor, fyId: number) {
  const { annualReport } = await import('./taxreports');
  const { annualReportIxbrl } = await import('@/lib/ixbrl');
  const r = await annualReport(actor.companyId, fyId);
  if (!r.input) throw new ValidationError('Årsredovisning lämnas digitalt för aktiebolag');
  const y = r.input.years[0];
  return save(actor, { kind: 'arsredovisning', period: y.end, deadlineKey: `arsredovisning:${y.end}`, refId: fyId, filename: `arsredovisning_${y.end.slice(0, 4)}.xhtml`, payload: annualReportIxbrl(r.input) });
}

async function get(companyId: number, id: number) {
  const [f] = await sql<{ id: number; kind: FilingKind; period: string; deadline_key: string; filename: string; payload: string; status: string; external_id: string | null }[]>`
    SELECT id, kind, period, deadline_key, filename, payload, status, external_id FROM filings WHERE id = ${id} AND company_id = ${companyId}`;
  if (!f) throw new NotFoundError('Inlämningen');
  return f;
}

async function decided(actor: Actor, f: { id: number; deadline_key: string }, s: { status: 'submitted' | 'accepted' | 'rejected'; receipt?: string; message?: string; external_id?: string }) {
  await sql`UPDATE filings SET status = ${s.status}, receipt = COALESCE(${s.receipt ?? null}, receipt), message = ${s.message ?? ''}, external_id = COALESCE(${s.external_id ?? null}, external_id),
    decided_at = ${s.status === 'submitted' ? null : new Date()} WHERE id = ${f.id}`;
  // Godkänd (eller manuellt inlämnad med kvittens) → deadline klar
  if (s.status === 'accepted') await markDeadline(actor, f.deadline_key, true).catch(() => {});
}

/** Skickar via myndighetens API (om det är uppsatt) */
export async function submitFiling(actor: Actor, id: number) {
  const f = await get(actor.companyId, id);
  if (!['prepared', 'rejected'].includes(f.status)) throw new ConflictError('Den är redan inlämnad');
  if (!authorityEnabled(authorityFor(f.kind))) throw new ValidationError('Direktinlämning är inte uppsatt – ladda ner filen och lämna den i myndighetens e-tjänst');
  // Tjänstens avtal med myndigheten används – bara för bolag där vi har kontrollerat att användaren företräder bolaget
  await requireVerified(actor.companyId, 'Direktinlämning');
  const [c] = await sql<{ orgnr: string }[]>`SELECT orgnr FROM companies WHERE id = ${actor.companyId}`;
  const s = await submitToAuthority(f.kind, { orgnr: c.orgnr, period: f.period, filename: f.filename, content: f.payload, contentType: f.kind === 'arsredovisning' ? 'application/xhtml+xml' : f.kind === 'moms' ? 'application/xml; charset=iso-8859-1' : 'application/xml' });
  await sql`UPDATE filings SET method = 'api', submitted_at = now() WHERE id = ${id}`;
  await decided(actor, f, { ...s, external_id: s.id || undefined });
  await auditBy(sql, actor, 'submit', 'filing', id, { kind: f.kind, status: s.status });
  return s;
}

/** Hämtar senaste status för inlämningar som väntar på beslut */
export async function refreshFiling(actor: Actor, id: number) {
  const f = await get(actor.companyId, id);
  if (f.status !== 'submitted' || !f.external_id) return null;
  const s = await authorityStatus(f.kind, f.external_id);
  await decided(actor, f, s);
  return s;
}

/** Lämnat via myndighetens e-tjänst: kvittensnumret registreras */
export async function markFiled(actor: Actor, id: number, receipt: string) {
  const f = await get(actor.companyId, id);
  if (!receipt.trim()) throw new ValidationError('Ange kvittens- eller referensnumret från myndigheten');
  await sql`UPDATE filings SET method = 'file', submitted_at = now() WHERE id = ${id}`;
  await decided(actor, f, { status: 'accepted', receipt: receipt.trim().slice(0, 100), message: 'Inlämnad via e-tjänst' });
  await auditBy(sql, actor, 'filed', 'filing', id, { receipt });
}

export async function listFilings(companyId: number) {
  return [...await sql<{ id: number; kind: FilingKind; period: string; filename: string; sha256: string; status: string; method: string | null; receipt: string | null; message: string; created_at: string; submitted_at: string | null }[]>`
    SELECT id, kind, period, filename, sha256, status, method, receipt, message, to_char(created_at,'YYYY-MM-DD HH24:MI') AS created_at, to_char(submitted_at,'YYYY-MM-DD HH24:MI') AS submitted_at
    FROM filings WHERE company_id = ${companyId} ORDER BY created_at DESC LIMIT 100`];
}
export async function filingFile(companyId: number, id: number) { const f = await get(companyId, id); return { filename: f.filename, payload: f.payload, kind: f.kind }; }
