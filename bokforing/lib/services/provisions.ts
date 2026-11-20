import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { kr } from '@/lib/format';
import { COMMITMENT_LABEL, commitmentNote, movementLines, PROVISION_ACCOUNT, PROVISION_LABEL, roll, warrantyProposal, type CommitmentKind, type Movement, type ProvisionKind } from '@/lib/provisions';
import type { Actor } from './actor';
import { date, optInt, str } from './input';

const NAMES: Record<number, string> = { 2220: 'Avsättningar för garantier', 2290: 'Övriga avsättningar' };
const kronor = (v: unknown, label: string) => { const n = parseAmount(String(v ?? '')); if (n == null || n <= 0) throw new ValidationError(`Ange ${label} i kronor`); return n; };

async function fy(companyId: number, fyId: number) {
  const [f] = await sql<{ id: number; start_date: string; end_date: string; closed: boolean }[]>`SELECT id, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, closed FROM fiscal_years WHERE id = ${fyId} AND company_id = ${companyId}`;
  if (!f) throw new NotFoundError('Räkenskapsåret');
  return f;
}

export async function addProvision(actor: Actor, input: Record<string, unknown>) {
  const kind = str(input, 'kind') as ProvisionKind;
  if (!PROVISION_LABEL[kind]) throw new ValidationError('Välj typ av avsättning');
  const cost = optInt(input, 'cost_account', 'Kostnadskonto') ?? 6900;
  if (cost < 4000 || cost > 7999) throw new ValidationError('Kostnadskontot ska vara ett konto i klass 4–7');
  const [a] = await sql`SELECT 1 FROM accounts WHERE company_id = ${actor.companyId} AND number = ${cost}`;
  if (!a) throw new ValidationError(`Konto ${cost} finns inte i kontoplanen`);
  const [r] = await sql<{ id: number }[]>`INSERT INTO provisions ${sql({ company_id: actor.companyId, kind, description: str(input, 'description', { required: true, label: 'Beskrivning', max: 300 }), account: PROVISION_ACCOUNT[kind], cost_account: cost })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'provision', r.id);
  return r.id;
}

async function movements(db: typeof sql, provisionId: number): Promise<Movement[]> {
  return db<Movement[]>`SELECT kind, to_char(date,'YYYY-MM-DD') AS date, amount::float8 AS amount FROM provision_movements WHERE provision_id = ${provisionId} ORDER BY date, id`;
}

/** Avsätt, ta i anspråk eller lös upp – ianspråktagande och upplösning får inte överstiga avsättningen */
export async function move(actor: Actor, provisionId: number, input: Record<string, unknown>) {
  const kind = str(input, 'kind') as Movement['kind'];
  if (!['set', 'use', 'release'].includes(kind)) throw new ValidationError('Välj vad som ska bokföras');
  const d = date(input, 'date', 'Datum');
  const amount = kronor(input.amount, 'beloppet');
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Bankkonto måste vara ett 19xx-konto');
  return sql.begin(async (tx) => {
    const [p] = await tx<{ description: string; account: number; cost_account: number }[]>`SELECT description, account, cost_account FROM provisions WHERE id = ${provisionId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!p) throw new NotFoundError('Avsättningen');
    const balance = roll(await movements(tx as unknown as typeof sql, provisionId), '9999-12-31', '9999-12-31').opening;
    if (kind !== 'set' && amount > balance) throw new ValidationError(`Avsättningen är bara ${kr(balance)} kr`);
    if (NAMES[p.account]) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${p.account}, ${NAMES[p.account]}) ON CONFLICT DO NOTHING`;
    const label = { set: 'Avsättning', use: 'Ianspråktagen avsättning', release: 'Upplösning av avsättning' }[kind];
    const v = await createVoucher(tx, { actor, date: d, description: `${label}: ${p.description}`, lines: fromSigned(movementLines(kind, { provision: p.account, cost: p.cost_account, amount, bank })), sourceType: 'provision', sourceId: provisionId });
    await tx`INSERT INTO provision_movements ${tx({ company_id: actor.companyId, provision_id: provisionId, kind, date: d, amount, voucher_id: v.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'provision_' + kind, 'provision', provisionId, { amount });
    return amount;
  });
}

/** Garantiavsättningen i bokslutet: ändringen mot nuvarande avsättning bokförs per bokslutsdagen */
export async function bookWarranty(actor: Actor, fyId: number, provisionId: number, input: Record<string, unknown>) {
  const f = await fy(actor.companyId, fyId);
  const w = await warrantyFor(actor.companyId, f, provisionId, input.rate_pct);
  if (!w.change) throw new ValidationError('Avsättningen stämmer redan');
  await move(actor, provisionId, { kind: w.change > 0 ? 'set' : 'release', date: f.end_date, amount: (Math.abs(w.change) / 100).toFixed(2) });
  return w;
}

async function warrantyFor(companyId: number, f: { start_date: string; end_date: string }, provisionId: number, rate: unknown) {
  const ratePct = Number(String(rate ?? '').replace(',', '.'));
  if (!(ratePct >= 0 && ratePct <= 50)) throw new ValidationError('Ange garantiprocenten (0–50)');
  const [p] = await sql<{ kind: string }[]>`SELECT kind FROM provisions WHERE id = ${provisionId} AND company_id = ${companyId}`;
  if (p?.kind !== 'warranty') throw new NotFoundError('Garantiavsättningen');
  const sales = async (from: string, to: string) => { let s = 0; for (const [n, v] of await accountSums(companyId, from, to)) if (n >= 3000 && n <= 3799) s -= Number(v); return s; };
  const mv = await movements(sql, provisionId);
  const current = roll(mv, f.end_date, f.end_date).opening + mv.filter((m) => m.date === f.end_date).reduce((s, m) => s + (m.kind === 'set' ? m.amount : -m.amount), 0);
  const history = [];
  for (const k of [1, 2]) {
    const from = `${Number(f.start_date.slice(0, 4)) - k}${f.start_date.slice(4)}`, to = `${Number(f.end_date.slice(0, 4)) - k}${f.end_date.slice(4)}`;
    const s = await sales(from, to);
    if (s > 0) history.push({ sales: s, costs: mv.filter((m) => m.kind === 'use' && m.date >= from && m.date <= to).reduce((a, m) => a + m.amount, 0) });
  }
  return { ratePct, sales: await sales(f.start_date, f.end_date), ...warrantyProposal({ sales: await sales(f.start_date, f.end_date), ratePct, current, history }), current };
}

export async function addCommitment(actor: Actor, input: Record<string, unknown>) {
  const kind = str(input, 'kind') as CommitmentKind;
  if (!COMMITMENT_LABEL[kind]) throw new ValidationError('Välj typ');
  const from = date(input, 'from_date', 'Från');
  const to = date(input, 'to_date', 'Till', false) || null;
  if (to && to < from) throw new ValidationError('Slutdatumet ligger före startdatumet');
  const [r] = await sql<{ id: number }[]>`INSERT INTO commitments ${sql({ company_id: actor.companyId, kind, description: str(input, 'description', { required: true, label: 'Beskrivning', max: 300 }),
    beneficiary: str(input, 'beneficiary', { max: 200 }), amount: kronor(input.amount, 'beloppet'), from_date: from, to_date: to, created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'commitment', r.id);
  return r.id;
}

export async function endCommitment(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'to_date', 'Upphörde');
  const r = await sql`UPDATE commitments SET to_date = ${d} WHERE id = ${id} AND company_id = ${actor.companyId} AND from_date <= ${d} RETURNING id`;
  if (!r.length) throw new NotFoundError('Åtagandet');
  await auditBy(sql, actor, 'end', 'commitment', id, { to: d });
}

/** Noterna för årsredovisningen: avsättningarnas rörelser och åtaganden per bokslutsdagen */
export async function notes(companyId: number, from: string, to: string) {
  const ps = await sql<{ id: number; kind: ProvisionKind; description: string; account: number }[]>`SELECT id, kind, description, account FROM provisions WHERE company_id = ${companyId} ORDER BY id`;
  const provisions = [];
  for (const p of ps) { const r = roll(await movements(sql, p.id), from, to); if (r.opening || r.set || r.used || r.released || r.closing) provisions.push({ ...p, label: PROVISION_LABEL[p.kind], ...r }); }
  const cs = await sql<{ id: number; kind: CommitmentKind; description: string; beneficiary: string; amount: number; from_date: string; to_date: string | null }[]>`
    SELECT id, kind, description, beneficiary, amount::float8 AS amount, to_char(from_date,'YYYY-MM-DD') AS from_date, to_char(to_date,'YYYY-MM-DD') AS to_date FROM commitments
    WHERE company_id = ${companyId} AND from_date <= ${to} AND (to_date IS NULL OR to_date >= ${to}) ORDER BY kind, id`;
  return { provisions, commitments: cs, note: commitmentNote(cs) };
}

export async function overview(companyId: number, fyId: number, ratePct?: string) {
  const f = await fy(companyId, fyId);
  const n = await notes(companyId, f.start_date, f.end_date);
  const all = await sql<{ id: number; kind: ProvisionKind; description: string; account: number; cost_account: number }[]>`SELECT id, kind, description, account, cost_account FROM provisions WHERE company_id = ${companyId} ORDER BY id`;
  const warranty = all.find((p) => p.kind === 'warranty');
  const w = warranty && ratePct ? await warrantyFor(companyId, f, warranty.id, ratePct).catch(() => null) : null;
  const balances = [];
  for (const p of all) balances.push({ ...p, label: PROVISION_LABEL[p.kind], balance: roll(await movements(sql, p.id), '9999-12-31', '9999-12-31').opening });
  return { fy: f, ...n, all: balances, warranty: warranty ?? null, proposal: w };
}

