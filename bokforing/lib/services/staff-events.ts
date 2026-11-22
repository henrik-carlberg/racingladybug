import 'server-only';
import { sql } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { ACCOUNTS, benefitWarning, eventBooking } from '@/lib/staff-events';
import type { Actor } from './actor';
import { date, str } from './input';

const kr = (v: unknown, label: string) => { const n = parseAmount(String(v ?? '').trim() || '0'); if (n == null || n < 0) throw new ValidationError(`Ange ${label} i kronor`); return n; };

export async function overview(companyId: number, year: number) {
  const events = await sql<{ id: number; date: string; title: string; persons: number; total: number; vat_deducted: number; non_deductible: number; warnings: string }[]>`
    SELECT id, to_char(date,'YYYY-MM-DD') AS date, title, persons, total::float8 AS total, vat_deducted::float8 AS vat_deducted, non_deductible::float8 AS non_deductible, warnings
    FROM staff_events WHERE company_id = ${companyId} AND extract(year from date) = ${year} ORDER BY date`;
  return { year, events, nonDeductible: events.reduce((s, e) => s + e.non_deductible, 0) };
}

export async function register(actor: Actor, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  const persons = Number(str(input, 'persons'));
  if (!Number.isInteger(persons) || persons < 1 || persons > 10000) throw new ValidationError('Ange antal deltagare');
  const o = { persons, meal: kr(input.meal, 'mat och dryck exkl. moms'), mealVat: kr(input.meal_vat, 'momsen på mat och dryck'), other: kr(input.other, 'övriga kostnader exkl. moms'), otherVat: kr(input.other_vat, 'momsen på övriga kostnader') };
  if (!o.meal && !o.other) throw new ValidationError('Ange festens kostnader');
  const guideline = str(input, 'guideline') ? kr(input.guideline, 'riktvärdet') : null;
  const r = eventBooking(o);
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('staff_events'), ${actor.companyId})`;
    const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM staff_events WHERE company_id = ${actor.companyId} AND extract(year from date) = ${Number(d.slice(0, 4))}`;
    const warnings = benefitWarning({ eventsThisYear: n, perPerson: r.perPerson, guideline });
    for (const [a, name] of [[ACCOUNTS.deductible, 'Personalrepresentation, avdragsgill'], [ACCOUNTS.nonDeductible, 'Personalrepresentation, ej avdragsgill']] as const)
      await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${a}, ${name}) ON CONFLICT DO NOTHING`;
    const title = str(input, 'title', { required: true, label: 'Tillfälle', max: 200 });
    const v = await createVoucher(tx, { actor, date: d, description: `Personalfest: ${title} (${persons} deltagare)`, lines: fromSigned(r.lines), sourceType: 'staff_event' });
    await tx`INSERT INTO staff_events ${tx({ company_id: actor.companyId, date: d, title, persons, total: r.total, vat_deducted: r.vatDed, non_deductible: r.nonDeductible, warnings: warnings.join(' '), voucher_id: v.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'staff_event', 'company', actor.companyId, { persons, total: r.total });
    return { ...r, warnings };
  });
}
