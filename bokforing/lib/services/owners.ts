import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { normalizePersonalNumber } from '@/lib/validate';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';

export interface Owner { id: number; name: string; personal_number: string; share_pct: number; cost_basis: number; saved_space: number }

export async function listOwners(companyId: number): Promise<Owner[]> {
  const rows = await sql<Owner[]>`SELECT id, name, personal_number, share_pct::float AS share_pct, cost_basis, saved_space FROM company_owners WHERE company_id = ${companyId} ORDER BY share_pct DESC, name`;
  return rows.map((o) => ({ ...o, cost_basis: Number(o.cost_basis), saved_space: Number(o.saved_space) }));
}

export async function saveOwner(actor: Actor, id: number | null, input: Record<string, unknown>) {
  const name = str(input, 'name', { required: true, label: 'Namn', max: 200 });
  const raw = str(input, 'personal_number');
  const pnr = raw ? normalizePersonalNumber(raw) : '';
  if (pnr === null) throw new ValidationError('Personnumret är inte giltigt');
  const share = Number(String(input.share_pct ?? '').replace(',', '.'));
  if (!(share > 0 && share <= 100)) throw new ValidationError('Ägarandelen ska vara mellan 0 och 100 %');
  const cost = optInt(input, 'cost_basis', 'Omkostnadsbelopp') ?? 0, saved = optInt(input, 'saved_space', 'Sparat utdelningsutrymme') ?? 0;
  if (cost < 0 || saved < 0) throw new ValidationError('Beloppen kan inte vara negativa');
  const others = await sql<{ s: number }[]>`SELECT COALESCE(SUM(share_pct), 0)::float AS s FROM company_owners WHERE company_id = ${actor.companyId} AND id IS DISTINCT FROM ${id}`;
  if (others[0].s + share > 100.0001) throw new ValidationError(`Ägarandelarna blir mer än 100 % (övriga äger ${others[0].s.toLocaleString('sv-SE')} %)`);
  if (id) {
    const r = await sql`UPDATE company_owners SET name = ${name}, personal_number = ${pnr}, share_pct = ${share}, cost_basis = ${cost}, saved_space = ${saved} WHERE id = ${id} AND company_id = ${actor.companyId}`;
    if (!r.count) throw new NotFoundError('Ägaren');
  } else {
    [{ id }] = await sql<{ id: number }[]>`INSERT INTO company_owners (company_id, name, personal_number, share_pct, cost_basis, saved_space) VALUES (${actor.companyId}, ${name}, ${pnr}, ${share}, ${cost}, ${saved}) RETURNING id`;
  }
  await auditBy(sql, actor, 'save', 'company_owner', id!);
  return id!;
}

export async function removeOwner(actor: Actor, id: number) {
  await sql`DELETE FROM company_owners WHERE id = ${id} AND company_id = ${actor.companyId}`;
  await auditBy(sql, actor, 'delete', 'company_owner', id);
}

/** Underlag för K10: lönesumman i bolaget och ägarens egen lön året före inkomståret, och utdelning under inkomståret */
export async function k10Basis(companyId: number, year: number, owner: Owner) {
  const [w] = await sql<{ wages: number; own: number }[]>`
    SELECT COALESCE(SUM(p.gross_cash), 0)::bigint AS wages,
      COALESCE(SUM(p.gross_cash) FILTER (WHERE e.personal_number <> '' AND e.personal_number = ${owner.personal_number}), 0)::bigint AS own
    FROM payslips p JOIN payroll_runs r ON r.id = p.run_id JOIN employees e ON e.id = p.employee_id
    WHERE r.company_id = ${companyId} AND r.status = 'booked' AND r.payment_date BETWEEN ${`${year - 1}-01-01`} AND ${`${year - 1}-12-31`}`;
  const [d] = await sql<{ v: number }[]>`
    SELECT COALESCE(SUM(l.amount), 0)::bigint AS v FROM dividend_payout_lines l JOIN dividend_payouts p ON p.id = l.payout_id
    WHERE p.company_id = ${companyId} AND l.owner_id = ${owner.id} AND p.date BETWEEN ${`${year}-01-01`} AND ${`${year}-12-31`}`;
  return { wages: Number(w.wages), ownSalary: Number(w.own), dividends: Number(d.v) };
}

/** Eget kapital som är beslutat men inte utbetalt (2898) och fritt eget kapital (2091–2099 minus 2898) */
export async function dividendStatus(companyId: number) {
  const [b] = await sql<{ unpaid: number; free: number }[]>`
    SELECT COALESCE(-SUM(l.debit - l.credit) FILTER (WHERE l.account_number = 2898), 0)::bigint AS unpaid,
      COALESCE(-SUM(l.debit - l.credit) FILTER (WHERE l.account_number BETWEEN 2090 AND 2099), 0)::bigint AS free
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId}`;
  return { unpaid: Number(b.unpaid), free: Number(b.free) };
}

/** Utdelning av balanserade vinstmedel enligt beslut på (extra) bolagsstämma: 2091 → 2898 */
export async function decideDividend(actor: Actor, input: Record<string, unknown>) {
  const amount = int(input, 'amount', 'Belopp');
  if (amount <= 0) throw new ValidationError('Beloppet måste vara större än noll');
  const d = date(input, 'date', 'Datum för stämman');
  const { free } = await dividendStatus(actor.companyId);
  if (amount > free) throw new ValidationError(`Utdelningen är större än det fria egna kapitalet (${(free / 100).toLocaleString('sv-SE')} kr). Försiktighetsregeln i ABL 17:3 gäller också.`);
  return sql.begin(async (tx) => {
    const v = await createVoucher(tx, { actor, date: d, description: 'Beslutad utdelning (bolagsstämma)', lines: fromSigned([{ account: 2091, amount }, { account: 2898, amount: -amount }]), sourceType: 'dividend_decision' });
    await auditBy(tx, actor, 'decide', 'dividend', v.id, { amount });
    return v;
  });
}

/** Betalar ut beslutad utdelning (2898 → bank), fördelad på ägarna efter ägarandel */
export async function payDividend(actor: Actor, input: Record<string, unknown>) {
  const amount = int(input, 'amount', 'Belopp');
  const d = date(input, 'date', 'Utbetalningsdag');
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Bankkonto måste vara ett 19xx-konto');
  const { unpaid } = await dividendStatus(actor.companyId);
  if (amount <= 0 || amount > unpaid) throw new ValidationError(`Beloppet ska vara mellan 0 och beslutad, ej utbetald utdelning (${(unpaid / 100).toLocaleString('sv-SE')} kr)`);
  const owners = await listOwners(actor.companyId);
  if (!owners.length) throw new ConflictError('Lägg upp aktieägarna först');
  const total = owners.reduce((s, o) => s + o.share_pct, 0);
  // Fördelning efter ägarandel; öresavrundningen hamnar på den största ägaren
  const split = owners.map((o) => ({ o, amount: Math.floor((amount * o.share_pct) / total) }));
  split[0].amount += amount - split.reduce((s, x) => s + x.amount, 0);
  return sql.begin(async (tx) => {
    const v = await createVoucher(tx, { actor, date: d, description: 'Utbetalning av utdelning', lines: fromSigned([{ account: 2898, amount }, { account: bank, amount: -amount }]), sourceType: 'dividend_payment' });
    const [p] = await tx<{ id: number }[]>`INSERT INTO dividend_payouts (company_id, voucher_id, date, total) VALUES (${actor.companyId}, ${v.id}, ${d}, ${amount}) RETURNING id`;
    for (const x of split) await tx`INSERT INTO dividend_payout_lines (payout_id, owner_id, name, personal_number, amount) VALUES (${p.id}, ${x.o.id}, ${x.o.name}, ${x.o.personal_number}, ${x.amount})`;
    await auditBy(tx, actor, 'pay', 'dividend', p.id, { amount });
    return { voucher: v, split: split.map((x) => ({ name: x.o.name, amount: x.amount })) };
  });
}

/** Kontrolluppgift KU31 (utdelning): summa per mottagare för kalenderåret */
export async function ku31(companyId: number, year: number) {
  return [...await sql<{ name: string; personal_number: string; amount: number }[]>`
    SELECT l.name, l.personal_number, SUM(l.amount)::bigint AS amount FROM dividend_payout_lines l JOIN dividend_payouts p ON p.id = l.payout_id
    WHERE p.company_id = ${companyId} AND p.date BETWEEN ${`${year}-01-01`} AND ${`${year}-12-31`} GROUP BY l.name, l.personal_number ORDER BY l.name`].map((r) => ({ ...r, amount: Number(r.amount) }));
}
