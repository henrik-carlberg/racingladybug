import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { MEAL_COST, mealBenefit, mealValuesFor, mealVatLines, representationLines, restaurantZLines, TIPS_LIABILITY } from '@/lib/restaurant';
import { PAYMENT_ACCOUNTS, type PaymentMethod } from '@/lib/shop';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';

function kronor(v: unknown, label: string) {
  const raw = String(v ?? '').trim();
  if (!raw) return 0;
  const n = parseAmount(raw);
  if (n == null || n < 0) throw new ValidationError(`Ange ${label} i kronor`);
  return n;
}
const count = (v: unknown, label: string) => {
  const n = Number(String(v ?? '').trim() || '0');
  if (!Number.isInteger(n) || n < 0 || n > 1000) throw new ValidationError(`Ogiltigt antal ${label}`);
  return n;
};
const ACCOUNT_NAMES: Record<number, string> = { 1910: 'Kassa', 1580: 'Fordringar för kontokort', 1930: 'Företagskonto', [TIPS_LIABILITY]: 'Dricks att betala ut till personalen', [MEAL_COST]: 'Övriga kostnader för förmåner', 6072: 'Representation, ej avdragsgill' };
async function ensure(db: typeof sql, companyId: number, accounts: number[]) {
  for (const n of accounts) if (ACCOUNT_NAMES[n]) await db`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${n}, ${ACCOUNT_NAMES[n]}) ON CONFLICT DO NOTHING`;
}

/** Restaurangens dagskassa: mat 12 %, alkohol 25 %, kortdricks som skuld till personalen */
export async function zReport(actor: Actor, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum', false) || today();
  const food = kronor(input.food, 'mat'), alcohol = kronor(input.alcohol, 'alkohol'), tips = kronor(input.tips, 'dricks');
  if (!food && !alcohol) throw new ValidationError('Ange försäljningen');
  const payments: Partial<Record<PaymentMethod, number>> = {};
  for (const m of ['cash', 'card', 'swish'] as PaymentMethod[]) { const v = kronor(input[`pay_${m}`], m); if (v) payments[m] = v; }
  const allow = input.allow_diff === 'on' || input.allow_diff === true;
  let z;
  try { z = restaurantZLines({ food, alcohol, tips, payments, maxDiff: allow ? 10000 : 0 }); } catch (e) { throw new ValidationError((e as Error).message + (allow ? '' : '. Kryssa i "Kassadifferens" om skillnaden är högst 100 kr.')); }
  const register = str(input, 'register', { max: 60 }) || 'Restaurang';
  const zn = str(input, 'z_number', { max: 40 });
  if (!zn) throw new ValidationError('Ange Z-rapportens nummer');
  try {
    return await sql.begin(async (tx) => {
      await ensure(tx as unknown as typeof sql, actor.companyId, [...Object.keys(payments).map((m) => PAYMENT_ACCOUNTS[m as PaymentMethod]), TIPS_LIABILITY]);
      const v = await createVoucher(tx, { actor, date: d, description: `Dagskassa ${register}, Z-rapport ${zn}${tips ? ' (med kortdricks)' : ''}`, lines: fromSigned(z.lines), sourceType: 'cash_report' });
      await tx`INSERT INTO cash_reports (company_id, date, register, z_number, data, voucher_id, created_by)
        VALUES (${actor.companyId}, ${d}, ${register}, ${zn}, ${tx.json({ restaurant: true, gross: { 12: food, 25: alcohol }, payments, tips } as never)}, ${v.id}, ${actor.userId})`;
      await auditBy(tx, actor, 'create', 'cash_report', v.id, { tips });
      return { voucherId: v.id, diff: z.diff };
    });
  } catch (e) {
    if (String((e as Error).message).includes('cash_reports_company_id_register_z_number_date_key')) throw new ConflictError('Z-rapporten är redan registrerad');
    throw e;
  }
}

/** Personalmåltider för en anställd under en månad */
export async function addMeals(actor: Actor, input: Record<string, unknown>) {
  const period = str(input, 'period');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new ValidationError('Ange månaden (ÅÅÅÅ-MM)');
  const employeeId = optInt(input, 'employee_id', 'Anställd');
  let name = str(input, 'name', { max: 200 });
  if (employeeId) {
    const [e] = await sql<{ name: string }[]>`SELECT first_name || ' ' || last_name AS name FROM employees WHERE id = ${employeeId} AND company_id = ${actor.companyId}`;
    if (!e) throw new ValidationError('Den anställda finns inte');
    name = e.name;
  }
  if (!name) throw new ValidationError('Välj den anställda');
  const def = mealValuesFor(Number(period.slice(0, 4)));
  const v = { breakfast: kronor(input.v_breakfast, 'frukostvärde') || def.breakfast, lunch: kronor(input.v_lunch, 'lunchvärde') || def.lunch, dinner: kronor(input.v_dinner, 'middagsvärde') || def.dinner };
  const o = { breakfasts: count(input.breakfasts, 'frukostar'), lunches: count(input.lunches, 'luncher'), dinners: count(input.dinners, 'middagar'), paid: kronor(input.paid, 'egen betalning') };
  if (!o.breakfasts && !o.lunches && !o.dinners) throw new ValidationError('Ange antal måltider');
  const b = mealBenefit(o, v);
  const [r] = await sql<{ id: number }[]>`INSERT INTO staff_meals ${sql({ company_id: actor.companyId, period, employee_id: employeeId ?? null, name, ...o, value: b.value, taxable: b.taxable, vat: b.vat })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'staff_meal', r.id, b);
  return b;
}

/** Uttagsmoms på månadens personalmat (12 % av förmånsvärdet) – bokas en gång per månad */
export async function bookMealVat(actor: Actor, input: Record<string, unknown>) {
  const period = str(input, 'period');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new ValidationError('Ange månaden (ÅÅÅÅ-MM)');
  const [y, m] = period.split('-').map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(95001, ${actor.companyId})`;
    const rows = await tx<{ id: number; vat: number }[]>`SELECT id, vat::float8 AS vat FROM staff_meals WHERE company_id = ${actor.companyId} AND period = ${period} AND voucher_id IS NULL FOR UPDATE`;
    const vat = rows.reduce((s, r) => s + r.vat, 0);
    if (!vat) throw new ConflictError('Det finns ingen obokad personalmat för månaden');
    await ensure(tx as unknown as typeof sql, actor.companyId, [MEAL_COST]);
    const v = await createVoucher(tx, { actor, date: end, description: `Uttagsmoms personalmat ${period}`, lines: fromSigned(mealVatLines(vat)), sourceType: 'staff_meals' });
    await tx`UPDATE staff_meals SET voucher_id = ${v.id} WHERE id IN ${tx(rows.map((r) => r.id))}`;
    await auditBy(tx, actor, 'book', 'staff_meal', v.id, { period, vat });
    return { vat, count: rows.length };
  });
}

/** Representation med mat och dryck: ej avdragsgill kostnad, moms avdragsgill på högst 300 kr exkl. moms per person */
export async function representation(actor: Actor, input: Record<string, unknown>) {
  const food = kronor(input.food, 'mat'), drinks = kronor(input.drinks, 'dryck');
  if (!food && !drinks) throw new ValidationError('Ange beloppen');
  const persons = int(input, 'persons', 'Antal personer');
  if (persons < 1 || persons > 500) throw new ValidationError('Ange antal deltagare');
  const purpose = str(input, 'purpose', { required: true, label: 'Syfte och deltagare', max: 500 });
  const bank = optInt(input, 'bank_account', 'Konto') ?? 1930;
  if (![1910, 1930, 1940, 2890].includes(bank)) throw new ValidationError('Välj hur måltiden betalades');
  const r = representationLines({ food, drinks, persons, bank });
  return sql.begin(async (tx) => {
    await ensure(tx as unknown as typeof sql, actor.companyId, [6072]);
    const v = await createVoucher(tx, { actor, date: date(input, 'date', 'Datum', false) || today(), description: `Representation ${persons} personer: ${purpose}`, lines: fromSigned(r.lines), sourceType: 'representation' });
    await auditBy(tx, actor, 'representation', 'voucher', v.id, { persons, deductible: r.deductible });
    return { ...r, voucherId: v.id };
  });
}

export async function overview(companyId: number, period: string) {
  const meals = await sql<{ id: number; name: string; breakfasts: number; lunches: number; dinners: number; paid: number; value: number; taxable: number; vat: number; booked: boolean }[]>`
    SELECT id, name, breakfasts, lunches, dinners, paid::float8 AS paid, value::float8 AS value, taxable::float8 AS taxable, vat::float8 AS vat, voucher_id IS NOT NULL AS booked
    FROM staff_meals WHERE company_id = ${companyId} AND period = ${period} ORDER BY name, id`;
  const [t] = await sql<{ tips: number }[]>`SELECT COALESCE(SUM(l.credit - l.debit), 0)::float8 AS tips FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND l.account_number = ${TIPS_LIABILITY}`;
  const reports = await sql<{ date: string; register: string; z_number: string; data: { gross: Record<string, number>; payments: Record<string, number>; tips: number } }[]>`
    SELECT to_char(date,'YYYY-MM-DD') AS date, register, z_number, data FROM cash_reports WHERE company_id = ${companyId} AND (data->>'restaurant')::boolean ORDER BY date DESC, id DESC LIMIT 20`;
  const employees = await sql<{ id: number; name: string }[]>`SELECT id, first_name || ' ' || last_name AS name FROM employees WHERE company_id = ${companyId} ORDER BY first_name`;
  return { meals, tipsLiability: t.tips, reports, employees, values: mealValuesFor(Number(period.slice(0, 4))) };
}
