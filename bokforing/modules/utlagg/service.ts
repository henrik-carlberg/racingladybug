import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { RECEIPT_CATEGORIES } from '@/lib/receipts';
import { today } from '@/lib/format';
import type { Actor } from '@/lib/services/actor';
import { date, int, optInt, str } from '@/lib/services/input';
import { updatePayslip } from '@/lib/services/payroll';
import { insertAttachment, type AttachmentIn } from '@/lib/services/vouchers';
import { allowance, approvalEntries, mileage, vatPart } from './calc';

type Db = Tx | typeof sql;

export interface Settings { mileage_rate: number; allowance_full: number; allowance_half: number; allowance_night: number; liability_account: number; mileage_account: number; allowance_account: number }
const DEFAULTS: Settings = { mileage_rate: 2500, allowance_full: 30000, allowance_half: 15000, allowance_night: 15000, liability_account: 2820, mileage_account: 7331, allowance_account: 7321 };

export async function settings(db: Db, companyId: number): Promise<Settings> {
  const [s] = await db<Settings[]>`SELECT mileage_rate::bigint AS mileage_rate, allowance_full::bigint AS allowance_full, allowance_half::bigint AS allowance_half,
    allowance_night::bigint AS allowance_night, liability_account, mileage_account, allowance_account FROM exp_settings WHERE company_id = ${companyId}`;
  if (!s) return { ...DEFAULTS };
  return { ...s, mileage_rate: Number(s.mileage_rate), allowance_full: Number(s.allowance_full), allowance_half: Number(s.allowance_half), allowance_night: Number(s.allowance_night) };
}

export async function saveSettings(actor: Actor, input: Record<string, unknown>) {
  const n = (k: string, def: number) => { const v = optInt(input, k, k) ?? def; if (v < 0) throw new ValidationError('Beloppen kan inte vara negativa'); return v; };
  const f = { mileage_rate: n('mileage_rate', 2500), allowance_full: n('allowance_full', 30000), allowance_half: n('allowance_half', 15000), allowance_night: n('allowance_night', 15000),
    liability_account: n('liability_account', 2820), mileage_account: n('mileage_account', 7331), allowance_account: n('allowance_account', 7321) };
  await sql`INSERT INTO exp_settings ${sql({ ...f, company_id: actor.companyId })} ON CONFLICT (company_id) DO UPDATE SET ${sql(f)}`;
  await auditBy(sql, actor, 'settings', 'utlagg', 0);
}

export interface Line { id: number; kind: 'receipt' | 'mileage' | 'allowance'; date: string; description: string; amount: number; vat: number; account: number; km: number | null; days_full: number | null; days_half: number | null; nights: number | null; attachment_id: number | null }
export interface ClaimOut {
  id: number; object: 'utlagg.claim'; employee_id: number; employee: string; title: string; status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid'; comment: string;
  created_by: string; created_at: string; submitted_at: string | null; approved_by: string | null; approved_at: string | null; voucher_id: number | null; payroll_run_id: number | null;
  paid_voucher_id: number | null; lines: Line[]; total: number; vat: number;
}

async function load(db: Db, companyId: number, id: number): Promise<ClaimOut> {
  const [c] = await db<Omit<ClaimOut, 'object' | 'lines' | 'total' | 'vat'>[]>`SELECT c.id, c.employee_id, e.first_name || ' ' || e.last_name AS employee, c.title, c.status, c.comment,
      u.name AS created_by, to_char(c.created_at,'YYYY-MM-DD') AS created_at, to_char(c.submitted_at,'YYYY-MM-DD') AS submitted_at, a.name AS approved_by,
      to_char(c.approved_at,'YYYY-MM-DD') AS approved_at, c.voucher_id, c.payroll_run_id, c.paid_voucher_id
    FROM exp_claims c JOIN employees e ON e.id = c.employee_id JOIN users u ON u.id = c.created_by LEFT JOIN users a ON a.id = c.approved_by
    WHERE c.id = ${id} AND c.company_id = ${companyId}`;
  if (!c) throw new NotFoundError('Utläggsräkningen');
  const lines = (await db<Line[]>`SELECT id, kind, to_char(date,'YYYY-MM-DD') AS date, description, amount::bigint AS amount, vat::bigint AS vat, account, km::float8 AS km,
    days_full, days_half, nights, attachment_id FROM exp_lines WHERE claim_id = ${id} ORDER BY date, id`).map((l) => ({ ...l, amount: Number(l.amount), vat: Number(l.vat) }));
  return { ...c, object: 'utlagg.claim', lines, total: lines.reduce((s, l) => s + l.amount, 0), vat: lines.reduce((s, l) => s + l.vat, 0) };
}

export const getClaim = (companyId: number, id: number) => load(sql, companyId, id);

export async function listClaims(companyId: number, f: { status?: string; employee_id?: number } = {}) {
  const ids = await sql<{ id: number }[]>`SELECT id FROM exp_claims WHERE company_id = ${companyId} ${f.status ? sql`AND status = ${f.status}` : sql``}
    ${f.employee_id ? sql`AND employee_id = ${f.employee_id}` : sql``} ORDER BY created_at DESC LIMIT 200`;
  return Promise.all(ids.map((r) => load(sql, companyId, r.id)));
}

export async function createClaim(actor: Actor, input: Record<string, unknown>) {
  const emp = int(input, 'employee_id', 'Anställd');
  if (!(await sql`SELECT 1 FROM employees WHERE id = ${emp} AND company_id = ${actor.companyId}`).length) throw new ValidationError('Den anställda finns inte');
  const [{ id }] = await sql<{ id: number }[]>`INSERT INTO exp_claims (company_id, employee_id, title, created_by) VALUES (${actor.companyId}, ${emp},
    ${str(input, 'title') || `Utlägg ${today().slice(0, 7)}`}, ${actor.userId}) RETURNING id`;
  await auditBy(sql, actor, 'create', 'utlagg.claim', id);
  return getClaim(actor.companyId, id);
}

async function draft(db: Db, companyId: number, id: number) {
  const c = await load(db, companyId, id);
  if (c.status !== 'draft' && c.status !== 'rejected') throw new ConflictError('Räkningen är inskickad och kan inte ändras');
  return c;
}

/** Lägger till en rad: kvitto (kategori → konto och moms), milersättning (km) eller traktamente (dagar/nätter) */
export async function addLine(actor: Actor, id: number, input: Record<string, unknown>, file?: AttachmentIn | null) {
  const s = await settings(sql, actor.companyId);
  const kind = str(input, 'kind') as Line['kind'];
  const d = date(input, 'date', 'Datum');
  let row: Omit<Line, 'id' | 'date' | 'attachment_id'>;
  if (kind === 'receipt') {
    const cat = RECEIPT_CATEGORIES.find((c) => c.key === str(input, 'category'));
    if (!cat) throw new ValidationError('Välj vad kvittot gäller');
    const amount = int(input, 'amount', 'Belopp');
    if (amount <= 0) throw new ValidationError('Ange kvittots belopp');
    row = { kind, description: str(input, 'description') || cat.label, amount, vat: vatPart(amount, cat.vat), account: cat.account, km: null, days_full: null, days_half: null, nights: null };
  } else if (kind === 'mileage') {
    const km = Number(String(input.km ?? '').replace(',', '.'));
    if (!Number.isFinite(km) || km <= 0 || km > 10000) throw new ValidationError('Ange antal kilometer');
    row = { kind, description: str(input, 'description') || 'Resa med egen bil', amount: mileage(km, s.mileage_rate), vat: 0, account: s.mileage_account, km, days_full: null, days_half: null, nights: null };
  } else if (kind === 'allowance') {
    const full = optInt(input, 'days_full', 'Hela dagar') ?? 0, half = optInt(input, 'days_half', 'Halva dagar') ?? 0, nights = optInt(input, 'nights', 'Nätter') ?? 0;
    if (full < 0 || half < 0 || nights < 0 || full + half + nights === 0) throw new ValidationError('Ange antal dagar eller nätter');
    row = { kind, description: str(input, 'description') || 'Traktamente tjänsteresa', amount: allowance(full, half, nights, { full: s.allowance_full, half: s.allowance_half, night: s.allowance_night }),
      vat: 0, account: s.allowance_account, km: null, days_full: full, days_half: half, nights };
  } else throw new ValidationError('Okänd typ');
  return sql.begin(async (tx) => {
    await draft(tx, actor.companyId, id);
    const attachmentId = file ? await insertAttachment(tx, actor, null, file) : null;
    await tx`INSERT INTO exp_lines ${tx({ ...row, claim_id: id, date: d, attachment_id: attachmentId })}`;
    await auditBy(tx, actor, 'add_line', 'utlagg.claim', id, { kind, amount: row.amount });
    return load(tx, actor.companyId, id);
  });
}

export async function removeLine(actor: Actor, id: number, lineId: number) {
  await sql.begin(async (tx) => {
    await draft(tx, actor.companyId, id);
    await tx`DELETE FROM exp_lines WHERE id = ${lineId} AND claim_id = ${id}`;
  });
}

export async function submit(actor: Actor, id: number) {
  return sql.begin(async (tx) => {
    const c = await draft(tx, actor.companyId, id);
    if (!c.lines.length) throw new ValidationError('Lägg till minst en rad');
    const missing = c.lines.filter((l) => l.kind === 'receipt' && !l.attachment_id);
    if (missing.length) throw new ValidationError(`Kvitto saknas för: ${missing.map((l) => l.description).join(', ')}`);
    await tx`UPDATE exp_claims SET status = 'submitted', submitted_at = now() WHERE id = ${id}`;
    await auditBy(tx, actor, 'submit', 'utlagg.claim', id);
    return load(tx, actor.companyId, id);
  });
}

/** Attest (ägaren): bokför kostnader och moms mot skuld till den anställda */
export async function approve(actor: Actor, id: number) {
  if (actor.role !== 'owner') throw new ValidationError('Bara ägaren kan attestera utlägg');
  const s = await settings(sql, actor.companyId);
  return sql.begin(async (tx) => {
    const c = await load(tx, actor.companyId, id);
    if (c.status !== 'submitted') throw new ConflictError('Räkningen är inte inskickad');
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${s.liability_account}, 'Kortfristiga skulder till anställda'),
      (${actor.companyId}, ${s.mileage_account}, 'Skattefria bilersättningar'), (${actor.companyId}, ${s.allowance_account}, 'Skattefria traktamenten, Sverige')
      ON CONFLICT (company_id, number) DO NOTHING`;
    const v = await createVoucher(tx, {
      actor, date: today(), description: `Utlägg ${c.employee}: ${c.title}`, sourceType: 'expense_claim', sourceId: id,
      lines: fromSigned(approvalEntries(c.lines, s.liability_account)),
    });
    await tx`UPDATE exp_claims SET status = 'approved', approved_by = ${actor.userId}, approved_at = now(), voucher_id = ${v.id} WHERE id = ${id}`;
    const att = c.lines.map((l) => l.attachment_id).filter((x): x is number => !!x);
    if (att.length) await tx`UPDATE attachments SET voucher_id = ${v.id} WHERE id IN ${tx(att)} AND voucher_id IS NULL`;
    await auditBy(tx, actor, 'approve', 'utlagg.claim', id);
    const out = await load(tx, actor.companyId, id);
    await emit(tx, actor.companyId, 'utlagg.claim.approved', out);
    return out;
  });
}

export async function reject(actor: Actor, id: number, comment: string) {
  if (actor.role !== 'owner') throw new ValidationError('Bara ägaren kan avslå utlägg');
  const r = await sql`UPDATE exp_claims SET status = 'rejected', comment = ${comment} WHERE id = ${id} AND company_id = ${actor.companyId} AND status = 'submitted' RETURNING id`;
  if (!r.length) throw new ConflictError('Räkningen är inte inskickad');
  await auditBy(sql, actor, 'reject', 'utlagg.claim', id);
}

/** Utbetalning med nästa lön: skattefri ersättning i en lönekörning som inte är bokförd (nollställer skulden 2820) */
export async function payViaPayroll(actor: Actor, id: number, runId: number) {
  const s = await settings(sql, actor.companyId);
  const c = await getClaim(actor.companyId, id);
  if (c.status !== 'approved') throw new ConflictError('Räkningen är inte attesterad');
  const [run] = await sql<{ status: string }[]>`SELECT status FROM payroll_runs WHERE id = ${runId} AND company_id = ${actor.companyId}`;
  if (!run || run.status !== 'draft') throw new ValidationError('Välj en lönekörning som inte är bokförd');
  const [slip] = await sql<{ id: number; items: unknown[] }[]>`SELECT id, items FROM payslips WHERE run_id = ${runId} AND employee_id = ${c.employee_id}`;
  if (!slip) throw new ValidationError(`${c.employee} finns inte i lönekörningen`);
  await updatePayslip(actor, runId, slip.id, { items: [...slip.items, { type: 'reimbursement', description: `Utlägg: ${c.title}`, amount: c.total, account: s.liability_account }] });
  await sql`UPDATE exp_claims SET status = 'paid', payroll_run_id = ${runId} WHERE id = ${id}`;
  await auditBy(sql, actor, 'pay_payroll', 'utlagg.claim', id, { run: runId });
}

/** Utbetalning direkt från banken */
export async function payDirect(actor: Actor, id: number, input: Record<string, unknown>) {
  const s = await settings(sql, actor.companyId);
  return sql.begin(async (tx) => {
    const c = await load(tx, actor.companyId, id);
    if (c.status !== 'approved') throw new ConflictError('Räkningen är inte attesterad');
    const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
    const v = await createVoucher(tx, {
      actor, date: date(input, 'date', 'Betaldatum', false) || today(), description: `Utbetalning utlägg ${c.employee}: ${c.title}`, sourceType: 'expense_claim', sourceId: id,
      lines: fromSigned([{ account: s.liability_account, amount: c.total }, { account: bank, amount: -c.total }]),
    });
    await tx`UPDATE exp_claims SET status = 'paid', paid_voucher_id = ${v.id} WHERE id = ${id}`;
    await auditBy(tx, actor, 'pay_direct', 'utlagg.claim', id);
  });
}
