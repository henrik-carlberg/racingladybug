import 'server-only';
import { sql } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums } from '@/lib/server/ledger';
import { parseAmount } from '@/lib/money';
import { rollForward, SIMPLIFICATION, type YearIn } from '@/lib/interest-limit';
import type { Actor } from './actor';
import { yearStatus } from './yearend';

/** Ränteintäkter och räntekostnader enligt BAS (skattefria ränteintäkter och ränta på skattekontot räknas inte) */
const isIncome = (n: number) => n >= 8300 && n <= 8399 && n !== 8314;
const isCost = (n: number) => n >= 8400 && n <= 8499 && n !== 8423;
const isDepreciation = (n: number) => n >= 7700 && n <= 7899;

export async function interestLimit(companyId: number) {
  const fys = await sql<{ id: number; start: string; end: string }[]>`SELECT id, to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS end FROM fiscal_years WHERE company_id = ${companyId} ORDER BY start_date`;
  const overrides = new Map((await sql<{ fy: number; taxable: number }[]>`SELECT fiscal_year_id AS fy, taxable::float8 AS taxable FROM tax_results WHERE company_id = ${companyId}`).map((r) => [r.fy, r.taxable]));
  const years: (YearIn & { fyId: number })[] = [];
  for (const f of fys) {
    let income = 0, cost = 0, dep = 0;
    for (const [n, v] of await accountSums(companyId, f.start, f.end)) { const x = Number(v); if (isIncome(n)) income -= x; else if (isCost(n)) cost += x; else if (isDepreciation(n)) dep += x; }
    const s = await yearStatus(companyId, f.id);
    years.push({ fyId: f.id, year: Number(f.end.slice(0, 4)), start: f.start, end: f.end, interestIncome: income, interestCost: cost, depreciation: dep, taxable: overrides.get(f.id) ?? s.resultBeforeTax + s.nonDeductible });
  }
  const [st] = await sql<{ s: number }[]>`SELECT simplification::float8 AS s FROM interest_limit_settings WHERE company_id = ${companyId}`;
  const simplification = st?.s ?? SIMPLIFICATION;
  return { simplification, rows: rollForward(years, simplification) };
}

/** Bolagets andel av förenklingsbeloppet när det ingår i en intressegemenskap (andelarna får tillsammans vara högst 5 miljoner kronor) */
export async function setSimplification(actor: Actor, input: Record<string, unknown>) {
  const v = parseAmount(String(input.simplification ?? ''));
  if (v == null || v < 0 || v > SIMPLIFICATION) throw new ValidationError('Ange en andel mellan 0 och 5 000 000 kr');
  await sql`INSERT INTO interest_limit_settings (company_id, simplification, updated_by) VALUES (${actor.companyId}, ${v}, ${actor.userId})
    ON CONFLICT (company_id) DO UPDATE SET simplification = EXCLUDED.simplification, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await auditBy(sql, actor, 'interest_simplification', 'company', actor.companyId, { simplification: v });
}
