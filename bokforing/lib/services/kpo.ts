import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, fiscalYearFor } from '@/lib/server/ledger';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { companyChecks, exercise as exerciseCalc, grantChecks, vestedOn } from '@/lib/kpo';
import type { Actor } from './actor';
import { date, int, str } from './input';

const kronor = (v: unknown, label: string) => { const n = parseAmount(String(v ?? '').trim() || '0'); if (n == null || n < 0) throw new ValidationError(`Ange ${label} i kronor`); return n; };

async function figures(companyId: number) {
  const [e] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employees WHERE company_id = ${companyId} AND active AND (employment_end IS NULL OR employment_end >= current_date)`;
  const fy = await fiscalYearFor(sql, companyId, today());
  let turnover = 0;
  if (fy) for (const [n, v] of await accountSums(companyId, fy.start_date, fy.end_date)) if (n >= 3000 && n <= 3799) turnover -= Number(v);
  const [b] = await sql<{ b: number }[]>`SELECT COALESCE(SUM(GREATEST(x.b, 0)), 0)::float8 AS b FROM (SELECT SUM(l.debit - l.credit) AS b FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND l.account_number < 2000 GROUP BY l.account_number) x`;
  return { employees: e.n, turnover, balance: b.b };
}

async function totalValue(companyId: number, except?: number) {
  const [t] = await sql<{ v: number }[]>`SELECT COALESCE(SUM(options::numeric * share_value), 0)::float8 AS v FROM kpo_grants WHERE company_id = ${companyId} AND exercised_on IS NULL ${except ? sql`AND id <> ${except}` : sql``}`;
  return t.v;
}

export async function overview(companyId: number) {
  const f = await figures(companyId);
  const programs = await sql<{ id: number; name: string; decided_on: string; started_year: number; excluded_business: boolean }[]>`
    SELECT id, name, to_char(decided_on,'YYYY-MM-DD') AS decided_on, started_year, excluded_business FROM kpo_programs WHERE company_id = ${companyId} ORDER BY decided_on`;
  const grants = await sql<{ id: number; program_id: number; employee: string; employment_end: string | null; granted_on: string; options: number; strike: number; share_value: number; hours_per_week: number;
    exercised_on: string | null; exercised_count: number | null; qualified: boolean | null; benefit: number | null }[]>`
    SELECT g.id, g.program_id, e.first_name || ' ' || e.last_name AS employee, to_char(e.employment_end,'YYYY-MM-DD') AS employment_end, to_char(g.granted_on,'YYYY-MM-DD') AS granted_on, g.options,
      g.strike::float8 AS strike, g.share_value::float8 AS share_value, g.hours_per_week::float8 AS hours_per_week, to_char(g.exercised_on,'YYYY-MM-DD') AS exercised_on, g.exercised_count, g.qualified, g.benefit::float8 AS benefit
    FROM kpo_grants g JOIN employees e ON e.id = g.employee_id WHERE g.company_id = ${companyId} ORDER BY g.granted_on, g.id`;
  const year = Number(today().slice(0, 4));
  return {
    figures: f, total: await totalValue(companyId),
    programs: programs.map((p) => ({ ...p, checks: companyChecks({ ...f, startedYear: p.started_year, year, excluded: p.excluded_business }),
      grants: grants.filter((g) => g.program_id === p.id).map((g) => ({ ...g, vested: vestedOn(g.granted_on),
        warning: !g.exercised_on && g.employment_end && g.employment_end < vestedOn(g.granted_on) ? 'Anställningen upphör före intjänandetidens slut – optionerna är inte kvalificerade' : null })) })),
  };
}

export async function addProgram(actor: Actor, input: Record<string, unknown>) {
  const sy = int(input, 'started_year', 'Verksamheten startade år');
  if (sy < 1900 || sy > 2100) throw new ValidationError('Ange året verksamheten startade');
  const [r] = await sql<{ id: number }[]>`INSERT INTO kpo_programs ${sql({ company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Programmets namn', max: 200 }), decided_on: date(input, 'decided_on', 'Beslutat'),
    started_year: sy, excluded_business: input.excluded_business === 'on' })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'kpo_program', r.id);
  return r.id;
}

/** Tilldelning: bolagets och den anställdas villkor kontrolleras, och taket för bolagets samlade optioner */
export async function grant(actor: Actor, programId: number, input: Record<string, unknown>) {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(116001, ${actor.companyId})`;
    const [p] = await tx<{ started_year: number; excluded_business: boolean }[]>`SELECT started_year, excluded_business FROM kpo_programs WHERE id = ${programId} AND company_id = ${actor.companyId}`;
    if (!p) throw new NotFoundError('Programmet');
    const employeeId = int(input, 'employee_id', 'Anställd');
    const [e] = await tx`SELECT 1 FROM employees WHERE id = ${employeeId} AND company_id = ${actor.companyId}`;
    if (!e) throw new NotFoundError('Den anställda');
    const grantedOn = date(input, 'granted_on', 'Tilldelad');
    const options = int(input, 'options', 'Antal optioner');
    if (options <= 0) throw new ValidationError('Ange antal optioner');
    const hours = Number(String(input.hours_per_week ?? '').replace(',', '.'));
    if (!(hours > 0 && hours <= 80)) throw new ValidationError('Ange arbetstid per vecka');
    const g = { hoursPerWeek: hours, options, shareValue: kronor(input.share_value, 'aktiens värde'), premium: kronor(input.premium, 'premie'), strike: kronor(input.strike, 'lösenpris') };
    const failed = [...companyChecks({ ...(await figures(actor.companyId)), startedYear: p.started_year, year: Number(grantedOn.slice(0, 4)), excluded: p.excluded_business }), ...grantChecks(g, await totalValue(actor.companyId))].filter((c) => !c.ok);
    if (failed.length) throw new ValidationError(`Villkoren för kvalificerade personaloptioner är inte uppfyllda: ${failed.map((c) => c.text.toLowerCase()).join('; ')}`);
    const [r] = await tx<{ id: number }[]>`INSERT INTO kpo_grants ${tx({ company_id: actor.companyId, program_id: programId, employee_id: employeeId, granted_on: grantedOn, options, strike: g.strike, share_value: g.shareValue, premium: g.premium, hours_per_week: hours })} RETURNING id`;
    await auditBy(tx, actor, 'kpo_grant', 'employee', employeeId, { options, program: programId });
    return { id: r.id, vested: vestedOn(grantedOn) };
  });
}

export async function exercise(actor: Actor, grantId: number, input: Record<string, unknown>) {
  return sql.begin(async (tx) => {
    const [g] = await tx<{ granted_on: string; options: number; strike: number; exercised_on: string | null; employment_end: string | null; active: boolean }[]>`
      SELECT to_char(g.granted_on,'YYYY-MM-DD') AS granted_on, g.options, g.strike::float8 AS strike, to_char(g.exercised_on,'YYYY-MM-DD') AS exercised_on, to_char(e.employment_end,'YYYY-MM-DD') AS employment_end, e.active
      FROM kpo_grants g JOIN employees e ON e.id = g.employee_id WHERE g.id = ${grantId} AND g.company_id = ${actor.companyId} FOR UPDATE OF g`;
    if (!g) throw new NotFoundError('Tilldelningen');
    if (g.exercised_on) throw new ConflictError('Optionerna är redan utnyttjade');
    const d = date(input, 'date', 'Datum');
    if (d < g.granted_on) throw new ValidationError('Datumet ligger före tilldelningen');
    const count = int(input, 'count', 'Antal');
    if (count <= 0 || count > g.options) throw new ValidationError(`Ange antal (högst ${g.options})`);
    const price = kronor(input.market_price, 'marknadsvärdet per aktie');
    const vest = vestedOn(g.granted_on);
    const r = exerciseCalc({ grantedOn: g.granted_on, date: d, count, strike: g.strike, marketPrice: price, employedThrough: !g.employment_end || g.employment_end >= vest });
    await tx`UPDATE kpo_grants SET exercised_on = ${d}, exercised_count = ${count}, market_price = ${price}, qualified = ${r.qualified}, benefit = ${r.benefit} WHERE id = ${grantId}`;
    await auditBy(tx, actor, 'kpo_exercise', 'kpo_grant', grantId, { count, qualified: r.qualified, benefit: r.benefit });
    return r;
  });
}
