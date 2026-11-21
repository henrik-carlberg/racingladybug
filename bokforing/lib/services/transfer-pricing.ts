import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { parseAmount } from '@/lib/money';
import { checks, METHOD_LABEL, needsDocumentation, TYPE_LABEL, type TpMethod, type TpType } from '@/lib/transfer-pricing';
import type { Actor } from './actor';
import { int, str } from './input';

const pct = (v: unknown, label: string) => { const s = String(v ?? '').trim(); if (!s) return null; const n = Number(s.replace(',', '.')); if (!Number.isFinite(n) || n < -100 || n > 1000) throw new ValidationError(`Ogiltigt värde: ${label}`); return n; };

type Row = { id: number; year: number; counterparty: string; country: string; type: TpType; description: string; amount: number; method: TpMethod; markup_pct: number | null; rate_pct: number | null; range_min: number | null; range_max: number | null; low_value: boolean; documented: boolean; documentation: string };

export async function overview(companyId: number, year: number) {
  const rows = await sql<Row[]>`SELECT id, year, counterparty, country, type, description, amount::float8 AS amount, method, markup_pct::float8 AS markup_pct, rate_pct::float8 AS rate_pct, range_min::float8 AS range_min,
    range_max::float8 AS range_max, low_value, documented, documentation FROM tp_transactions WHERE company_id = ${companyId} AND year = ${year} ORDER BY counterparty, id`;
  const group = await sql<{ name: string }[]>`SELECT c.name FROM group_links g JOIN companies c ON c.id = CASE WHEN g.parent_company_id = ${companyId} THEN g.subsidiary_company_id ELSE g.parent_company_id END
    WHERE ${companyId} IN (g.parent_company_id, g.subsidiary_company_id) ORDER BY c.name`;
  const out = rows.map((r) => {
    const t = { type: r.type, crossBorder: r.country.toUpperCase() !== 'SE', amount: r.amount, method: r.method, markupPct: r.markup_pct, ratePct: r.rate_pct, rangeMin: r.range_min, rangeMax: r.range_max, documented: r.documented, lowValue: r.low_value };
    return { ...r, typeLabel: TYPE_LABEL[r.type], methodLabel: METHOD_LABEL[r.method], needsDoc: needsDocumentation(t), warnings: checks(t) };
  });
  return { rows: out, group: group.map((g) => g.name), errors: out.reduce((s, r) => s + r.warnings.filter((w) => w.level === 'error').length, 0) };
}

export async function addTransaction(actor: Actor, input: Record<string, unknown>) {
  const type = str(input, 'type') as TpType, method = str(input, 'method') as TpMethod;
  if (!TYPE_LABEL[type]) throw new ValidationError('Välj typ av transaktion');
  if (!METHOD_LABEL[method]) throw new ValidationError('Välj prismetod');
  const country = (str(input, 'country') || 'SE').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new ValidationError('Ange landskod med två bokstäver');
  const amount = parseAmount(String(input.amount ?? '')); if (amount == null || amount < 0) throw new ValidationError('Ange årets belopp i kronor');
  const year = int(input, 'year', 'År'); if (year < 2000 || year > 2100) throw new ValidationError('Ogiltigt år');
  const [r] = await sql<{ id: number }[]>`INSERT INTO tp_transactions ${sql({ company_id: actor.companyId, year, counterparty: str(input, 'counterparty', { required: true, label: 'Motpart', max: 200 }), country, type,
    description: str(input, 'description', { max: 300 }), amount, method, markup_pct: pct(input.markup_pct, 'påslag'), rate_pct: pct(input.rate_pct, 'ränta'), range_min: pct(input.range_min, 'intervall från'), range_max: pct(input.range_max, 'intervall till'),
    low_value: input.low_value === 'on' })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'tp_transaction', r.id);
  return r.id;
}

/** Dokumentationen: var den finns och vad den innehåller (förenklad dokumentation för mindre företag) */
export async function document(actor: Actor, id: number, input: Record<string, unknown>) {
  const text = str(input, 'documentation', { required: true, label: 'Dokumentation', max: 2000 });
  const r = await sql`UPDATE tp_transactions SET documented = true, documentation = ${text} WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Transaktionen');
  await auditBy(sql, actor, 'document', 'tp_transaction', id);
}
