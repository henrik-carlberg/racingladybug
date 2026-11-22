import 'server-only';
import { SETTLEMENT_ACCOUNT } from '@/lib/debt-settlement';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums } from '@/lib/server/ledger';
import { parseAmount } from '@/lib/money';
import { rollForward, type YearIn } from '@/lib/deficits';
import type { Actor } from './actor';
import { date, str } from './input';
import { yearStatus } from './yearend';

const signed = (v: unknown, label: string) => { const s = String(v ?? '').trim().replace('−', '-'); const neg = s.startsWith('-'); const n = parseAmount(neg ? s.slice(1) : s); if (n == null) throw new ValidationError(`Ange ${label} i kronor`); return neg ? -n : n; };

/** Underskotten år för år: skattemässigt resultat (beräknat eller justerat), mottagna koncernbidrag och eventuell ägarförändring */
export async function deficits(companyId: number) {
  const fys = await sql<{ id: number; start: string; end: string }[]>`SELECT id, to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS end FROM fiscal_years WHERE company_id = ${companyId} ORDER BY start_date`;
  const overrides = new Map((await sql<{ fy: number; taxable: number }[]>`SELECT fiscal_year_id AS fy, taxable::float8 AS taxable FROM tax_results WHERE company_id = ${companyId}`).map((r) => [r.fy, r.taxable]));
  const years: (YearIn & { fyId: number; computed: number; adjusted: boolean })[] = [];
  for (const f of fys) {
    const s = await yearStatus(companyId, f.id);
    let gc = 0, ackord = 0;
    for (const [n, v] of await accountSums(companyId, f.start, f.end)) { if (n >= 8820 && n <= 8829) gc -= Number(v); if (n === SETTLEMENT_ACCOUNT) ackord -= Number(v); }
    // Ackordsvinsten är inte skattepliktig men minskar tidigare års underskott
    const computed = s.resultBeforeTax + s.nonDeductible - ackord;
    years.push({ fyId: f.id, year: Number(f.end.slice(0, 4)), start: f.start, end: f.end, computed, adjusted: overrides.has(f.id), taxable: overrides.get(f.id) ?? computed, groupContribution: Math.max(0, gc), settlement: Math.max(0, ackord) });
  }
  const [c] = await sql<{ date: string; price: number; contributions: number; note: string }[]>`SELECT to_char(date,'YYYY-MM-DD') AS date, price::float8 AS price, contributions::float8 AS contributions, note FROM ownership_changes WHERE company_id = ${companyId}`;
  const rows = rollForward(years, c ?? null);
  const transfers = await sql<{ date: string; text: string }[]>`SELECT to_char(date,'YYYY-MM-DD') AS date, text FROM share_events WHERE company_id = ${companyId} AND kind IN ('transfer','issue') ORDER BY date DESC LIMIT 10`;
  return { rows, change: c ?? null, transfers };
}

/** Justerat skattemässigt resultat för ett år (t.ex. enligt inlämnad deklaration) – tomt värde tar bort justeringen */
export async function setTaxable(actor: Actor, fyId: number, input: Record<string, unknown>) {
  const [f] = await sql`SELECT 1 FROM fiscal_years WHERE id = ${fyId} AND company_id = ${actor.companyId}`;
  if (!f) throw new NotFoundError('Räkenskapsåret');
  const raw = String(input.taxable ?? '').trim();
  if (!raw) { await sql`DELETE FROM tax_results WHERE company_id = ${actor.companyId} AND fiscal_year_id = ${fyId}`; return null; }
  const v = signed(raw, 'skattemässigt resultat');
  await sql`INSERT INTO tax_results (company_id, fiscal_year_id, taxable, updated_by) VALUES (${actor.companyId}, ${fyId}, ${v}, ${actor.userId})
    ON CONFLICT (company_id, fiscal_year_id) DO UPDATE SET taxable = EXCLUDED.taxable, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await auditBy(sql, actor, 'tax_result', 'fiscal_year', fyId, { taxable: v });
  return v;
}

/** Ägarförändring: någon har fått bestämmande inflytande (mer än 50 % av rösterna) */
export async function setChange(actor: Actor, input: Record<string, unknown>) {
  if (input.remove === 'on' || input.remove === '1') { await sql`DELETE FROM ownership_changes WHERE company_id = ${actor.companyId}`; await auditBy(sql, actor, 'ownership_change_removed', 'company', actor.companyId); return; }
  const d = date(input, 'date', 'Datum');
  const price = parseAmount(String(input.price ?? '')); if (price == null || price < 0) throw new ValidationError('Ange köpeskillingen för det bestämmande inflytandet');
  const contributions = parseAmount(String(input.contributions ?? '0') || '0') ?? 0;
  await sql`INSERT INTO ownership_changes ${sql({ company_id: actor.companyId, date: d, price, contributions, note: str(input, 'note', { max: 300 }), created_by: actor.userId })}
    ON CONFLICT (company_id) DO UPDATE SET date = EXCLUDED.date, price = EXCLUDED.price, contributions = EXCLUDED.contributions, note = EXCLUDED.note`;
  await auditBy(sql, actor, 'ownership_change', 'company', actor.companyId, { date: d, price });
}
