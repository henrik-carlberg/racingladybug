import 'server-only';
import { sql } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher, openingBalances } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { addDays, today } from '@/lib/format';
import { CASH_ACCOUNT, COUNT_INTERVAL, countLines, running } from '@/lib/cashbook';
import type { Actor } from './actor';
import { date, str } from './input';

const balanceAt = async (companyId: number, d: string) => Number((await openingBalances(companyId, addDays(d, 1))).get(CASH_ACCOUNT) ?? 0);

/** Kassabokens poster för en period med löpande saldo, och senaste inventering */
export async function overview(companyId: number, from: string, to: string) {
  const opening = Number((await openingBalances(companyId, from)).get(CASH_ACCOUNT) ?? 0);
  const rows = await sql<{ voucher_id: number; label: string; date: string; text: string; amount: number }[]>`SELECT v.id AS voucher_id, v.series || v.number AS label, to_char(v.date,'YYYY-MM-DD') AS date,
    COALESCE(NULLIF(l.description, ''), v.description) AS text, (l.debit - l.credit)::float8 AS amount FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND l.account_number = ${CASH_ACCOUNT} AND v.date BETWEEN ${from} AND ${to} ORDER BY v.date, v.id`;
  const entries = running(opening, rows).map((e, i) => ({ ...rows[i], ...e }));
  const counts = await sql<{ id: number; date: string; counted: number; booked: number; diff: number; counted_by: string }[]>`SELECT id, to_char(date,'YYYY-MM-DD') AS date, counted::float8 AS counted,
    booked::float8 AS booked, diff::float8 AS diff, counted_by FROM cash_counts WHERE company_id = ${companyId} ORDER BY date DESC, id DESC LIMIT 12`;
  const last = counts[0]?.date ?? null;
  const used = rows.length > 0 || counts.length > 0;
  return { opening, entries, closing: entries.at(-1)?.balance ?? opening, counts, negative: entries.filter((e) => e.negative).map((e) => e.date),
    overdue: used && (!last || last < addDays(today(), -COUNT_INTERVAL)), last };
}

/** Kassainventering: räknat belopp jämförs med bokfört saldo per dagen och differensen bokförs */
export async function count(actor: Actor, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  if (d > today()) throw new ValidationError('Kassan räknas i dag eller tidigare');
  const counted = parseAmount(str(input, 'counted'));
  if (counted == null || counted < 0) throw new ValidationError('Ange räknat belopp i kronor');
  const by = str(input, 'counted_by', { required: true, label: 'Räknad av', max: 100 });
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('cashbook'), ${actor.companyId})`;
    const booked = await balanceAt(actor.companyId, d);
    const r = countLines(counted, booked);
    if (Math.abs(r.diff) > 100000 && input.confirm !== 'on') throw new ValidationError(`Differensen är ${(r.diff / 100).toLocaleString('sv-SE')} kr – kontrollera att alla kassatransaktioner är bokförda, eller kryssa i att differensen ska bokföras`);
    const v = r.lines.length ? await createVoucher(tx, { actor, date: d, description: `Kassainventering (räknad av ${by}): ${r.diff > 0 ? 'överskott' : 'underskott'} i kassan`, lines: fromSigned(r.lines), sourceType: 'cash_count' }) : null;
    await tx`INSERT INTO cash_counts ${tx({ company_id: actor.companyId, date: d, counted, booked, diff: r.diff, counted_by: by, voucher_id: v?.id ?? null, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'cash_count', 'company', actor.companyId, { counted, booked });
    return r;
  });
}
