import 'server-only';
import { sql } from '@/lib/db';
import { ForbiddenError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { paymentLines, room } from '@/lib/ef-pension';
import type { Actor } from './actor';
import { date, str } from './input';

async function soleTrader(companyId: number) {
  const [c] = await sql<{ t: string }[]>`SELECT company_type AS t FROM companies WHERE id = ${companyId}`;
  if (c.t !== 'EF') throw new ForbiddenError('Avdrag för pensionssparande i näringsverksamhet gäller enskild näringsidkare');
}

export async function overview(companyId: number, year: number) {
  let result = 0;
  for (const [n, v] of await accountSums(companyId, `${year}-01-01`, `${year}-12-31`)) if (n >= 3000 && n <= 8999) result -= Number(v);
  const [s] = await sql<{ income: number | null; has_occupational: boolean }[]>`SELECT income::float8 AS income, has_occupational FROM ef_pension_settings WHERE company_id = ${companyId} AND year = ${year}`;
  const payments = await sql<{ id: number; date: string; amount: number; insurer: string }[]>`SELECT id, to_char(date,'YYYY-MM-DD') AS date, amount::float8 AS amount, insurer FROM ef_pension_payments
    WHERE company_id = ${companyId} AND extract(year from date) = ${year} ORDER BY date`;
  const paid = payments.reduce((x, p) => x + p.amount, 0);
  const income = s?.income ?? result;
  return { year, bookedResult: result, income, manual: s?.income != null, hasOccupational: !!s?.has_occupational, payments, paid, ...room({ income, year, paid }) };
}

export async function saveSettings(actor: Actor, input: Record<string, unknown>) {
  await soleTrader(actor.companyId);
  const year = Number(str(input, 'year'));
  const raw = str(input, 'income');
  const income = raw ? parseAmount(raw) : null;
  if (raw && income == null) throw new ValidationError('Ange inkomsten i kronor');
  await sql`INSERT INTO ef_pension_settings ${sql({ company_id: actor.companyId, year, income, has_occupational: input.has_occupational === 'on' })}
    ON CONFLICT (company_id, year) DO UPDATE SET income = EXCLUDED.income, has_occupational = EXCLUDED.has_occupational`;
}

/** Premien betalas från företagskontot: ett privat uttag (avdraget görs i deklarationen) */
export async function pay(actor: Actor, input: Record<string, unknown>) {
  await soleTrader(actor.companyId);
  const amount = parseAmount(str(input, 'amount'));
  if (amount == null || amount <= 0) throw new ValidationError('Ange premien i kronor');
  const d = date(input, 'date', 'Betalningsdag');
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('ef_pension'), ${actor.companyId})`;
    const o = await overview(actor.companyId, Number(d.slice(0, 4)));
    if (o.hasOccupational) throw new ValidationError('Avdrag för eget pensionssparande kräver att du saknar tjänstepension i anställning');
    if (amount > o.left) throw new ValidationError(`Avdragsutrymmet ${d.slice(0, 4)} räcker till ${(o.left / 100).toLocaleString('sv-SE')} kr`);
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, 2013, 'Övriga egna uttag') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: `Pensionspremie (privat uttag), ${str(input, 'insurer') || 'pensionsförsäkring'}`, lines: fromSigned(paymentLines(amount)), sourceType: 'ef_pension' });
    await tx`INSERT INTO ef_pension_payments ${tx({ company_id: actor.companyId, date: d, amount, insurer: str(input, 'insurer', { max: 100 }), voucher_id: v.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'ef_pension', 'company', actor.companyId, { amount });
  });
}
