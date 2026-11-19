import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums } from '@/lib/server/ledger';
import { monthEnd } from '@/lib/format';
import { categoryOf, DEFAULT_CATEGORIES, emissions, isActivity, type ActivityKind, type Category } from '@/lib/climate';
import type { Actor } from './actor';
import { date, str } from './input';

export async function categories(companyId: number): Promise<Category[]> {
  const o = new Map((await sql<{ key: string; factor: number }[]>`SELECT key, factor::float8 AS factor FROM climate_factors WHERE company_id = ${companyId}`).map((r) => [r.key, r.factor]));
  return DEFAULT_CATEGORIES.map((c) => ({ ...c, factor: o.get(c.key) ?? c.factor }));
}

async function activities(companyId: number, from: string, to: string) {
  return (await sql<{ kind: ActivityKind; quantity: number }[]>`SELECT kind, SUM(quantity)::float8 AS quantity FROM climate_activities WHERE company_id = ${companyId} AND date BETWEEN ${from} AND ${to} GROUP BY kind`);
}
async function privateKm(companyId: number, from: string, to: string) {
  const [r] = await sql<{ km: number }[]>`SELECT COALESCE(SUM(km), 0)::float8 AS km FROM exp_trips WHERE company_id = ${companyId} AND vehicle = 'private' AND date BETWEEN ${from} AND ${to}`;
  return r.km;
}

/** Årets klimatrapport: per kategori och scope, per månad och de leverantörer som står för mest */
export async function climateReport(companyId: number, year: number) {
  const cats = await categories(companyId);
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const total = emissions({ costs: await accountSums(companyId, from, to), categories: cats, activities: [...await activities(companyId, from, to)], privateKm: await privateKm(companyId, from, to) });
  const months = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
    const p = `${year}-${String(i + 1).padStart(2, '0')}`;
    const e = emissions({ costs: await accountSums(companyId, `${p}-01`, monthEnd(p)), categories: cats, activities: [...await activities(companyId, `${p}-01`, monthEnd(p))], privateKm: await privateKm(companyId, `${p}-01`, monthEnd(p)) });
    return { period: p, ...e.byScope, total: e.total };
  }));
  const sup = await sql<{ name: string; account: number; net: number }[]>`SELECT s.name, s.default_account AS account, SUM(i.total - i.vat)::float8 AS net FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id
    WHERE i.company_id = ${companyId} AND i.invoice_date BETWEEN ${from} AND ${to} GROUP BY s.name, s.default_account`;
  const suppliers = sup.map((s) => { const c = categoryOf(s.account, cats); return { name: s.name, category: c?.label ?? '–', kg: c ? Math.round((s.net / 100) * c.factor) : 0 }; })
    .filter((s) => s.kg > 0).sort((a, b) => b.kg - a.kg).slice(0, 8);
  const [prev] = [emissions({ costs: await accountSums(companyId, `${year - 1}-01-01`, `${year - 1}-12-31`), categories: cats,
    activities: [...await activities(companyId, `${year - 1}-01-01`, `${year - 1}-12-31`)], privateKm: await privateKm(companyId, `${year - 1}-01-01`, `${year - 1}-12-31`) })];
  const list = [...await sql<{ id: number; date: string; kind: ActivityKind; quantity: number; note: string }[]>`SELECT id, to_char(date,'YYYY-MM-DD') AS date, kind, quantity::float8 AS quantity, note
    FROM climate_activities WHERE company_id = ${companyId} AND date BETWEEN ${from} AND ${to} ORDER BY date DESC, id DESC`];
  return { ...total, months, suppliers, previous: prev.total, categories: cats, activities: list };
}

export async function addActivity(actor: Actor, input: Record<string, unknown>) {
  const kind = str(input, 'kind');
  if (!isActivity(kind)) throw new ValidationError('Välj vad mängden gäller');
  const q = Number(String(input.quantity ?? '').replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(q) || q <= 0 || q > 1e9) throw new ValidationError('Ange mängden');
  const [r] = await sql<{ id: number }[]>`INSERT INTO climate_activities (company_id, date, kind, quantity, note, created_by)
    VALUES (${actor.companyId}, ${date(input, 'date', 'Datum')}, ${kind}, ${q}, ${str(input, 'note', { max: 200 })}, ${actor.userId}) RETURNING id`;
  await auditBy(sql, actor, 'climate_activity', 'company', actor.companyId, { kind, q });
  return r.id;
}

export async function removeActivity(actor: Actor, id: number) {
  const r = await sql`DELETE FROM climate_activities WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Mängden');
}

export async function setFactor(actor: Actor, key: string, raw: string) {
  if (!DEFAULT_CATEGORIES.some((c) => c.key === key)) throw new ValidationError('Okänd kategori');
  if (raw.trim() === '') { await sql`DELETE FROM climate_factors WHERE company_id = ${actor.companyId} AND key = ${key}`; return; }
  const f = Number(raw.replace(',', '.'));
  if (!Number.isFinite(f) || f < 0 || f > 100) throw new ValidationError('Ange faktorn i kg CO2e per krona');
  await sql`INSERT INTO climate_factors (company_id, key, factor) VALUES (${actor.companyId}, ${key}, ${f}) ON CONFLICT (company_id, key) DO UPDATE SET factor = EXCLUDED.factor`;
  await auditBy(sql, actor, 'climate_factor', 'company', actor.companyId, { key, factor: f });
}
