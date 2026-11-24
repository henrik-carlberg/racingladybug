import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { ASSET_CATEGORIES, type AssetCategory } from '@/lib/assets';
import { evaluate, financing } from '@/lib/investment';
import type { Actor } from './actor';
import { createAsset } from './assets';
import { int, str } from './input';

type Row = { id: number; name: string; category: AssetCategory; investment: number; life_years: number; annual_in: number; annual_out: number; growth_pct: number; residual: number; rate_pct: number; loan_rate_pct: number | null; lease_monthly: number | null; status: string; asset_id: number | null };
const calcOf = (r: Row) => ({ investment: r.investment, lifeYears: r.life_years, annualIn: r.annual_in, annualOut: r.annual_out, growthPct: r.growth_pct, residual: r.residual, ratePct: r.rate_pct });

export async function overview(companyId: number) {
  const rows = await sql<Row[]>`SELECT id, name, category, investment::float8 AS investment, life_years, annual_in::float8 AS annual_in, annual_out::float8 AS annual_out, growth_pct::float8 AS growth_pct, residual::float8 AS residual,
      rate_pct::float8 AS rate_pct, loan_rate_pct::float8 AS loan_rate_pct, lease_monthly::float8 AS lease_monthly, status, asset_id FROM investment_calcs WHERE company_id = ${companyId} ORDER BY status, id DESC`;
  return rows.map((r) => ({ ...r, ...evaluate(calcOf(r)), financing: financing(calcOf(r), r.loan_rate_pct, r.lease_monthly) }));
}

const money = (input: Record<string, unknown>, k: string, required = false) => {
  const s = String(input[k] ?? '').trim();
  if (!s) { if (required) throw new ValidationError('Ange grundinvesteringen'); return 0; }
  const v = parseAmount(s); if (v == null || v < 0) throw new ValidationError('Ogiltigt belopp'); return v;
};
const pct = (input: Record<string, unknown>, k: string, label: string, opt = false) => {
  const s = String(input[k] ?? '').trim().replace(',', '.');
  if (!s) { if (opt) return null; throw new ValidationError(`Ange ${label}`); }
  const v = Number(s); if (!Number.isFinite(v) || v < -50 || v >= 100) throw new ValidationError(`Ogiltig ${label}`); return v;
};

export async function add(actor: Actor, input: Record<string, unknown>) {
  const category = String(input.category) as AssetCategory;
  if (!ASSET_CATEGORIES[category]) throw new ValidationError('Välj kategori');
  const life = int(input, 'life_years', 'Livslängd');
  if (life < 1 || life > 50) throw new ValidationError('Livslängden ska vara 1–50 år');
  const rate = pct(input, 'rate_pct', 'kalkylränta')!;
  if (rate < 0) throw new ValidationError('Kalkylräntan kan inte vara negativ');
  const lease = String(input.lease_monthly ?? '').trim() ? money(input, 'lease_monthly') : null;
  const [r] = await sql<{ id: number }[]>`INSERT INTO investment_calcs ${sql({ company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Investering', max: 150 }), category, investment: money(input, 'investment', true),
    life_years: life, annual_in: money(input, 'annual_in'), annual_out: money(input, 'annual_out'), growth_pct: pct(input, 'growth_pct', 'årlig ökning', true) ?? 0, residual: money(input, 'residual'),
    rate_pct: rate, loan_rate_pct: pct(input, 'loan_rate_pct', 'låneränta', true), lease_monthly: lease, created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'investment_calc', 'investment_calc', r.id, {});
  const [row] = (await overview(actor.companyId)).filter((x) => x.id === r.id);
  return row;
}

/** Beslut: en godkänd investering läggs upp i anläggningsregistret med livslängden som avskrivningstid */
export async function decide(actor: Actor, id: number, approve: boolean) {
  const [r] = await sql<Row[]>`SELECT id, name, category, investment::float8 AS investment, life_years, residual::float8 AS residual, status FROM investment_calcs WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!r) throw new NotFoundError('Kalkylen');
  if (r.status !== 'draft') throw new ConflictError('Kalkylen är redan beslutad');
  if (!approve) { await sql`UPDATE investment_calcs SET status = 'rejected' WHERE id = ${id}`; return null; }
  const assetId = await createAsset(actor, { category: r.category, name: r.name, acquired_on: today(), cost: String(Math.round(r.investment)), residual: String(Math.round(r.residual)), life_months: String(r.life_years * 12), notes: 'Från investeringskalkyl' });
  await sql`UPDATE investment_calcs SET status = 'approved', asset_id = ${assetId} WHERE id = ${id}`;
  await auditBy(sql, actor, 'investment_approved', 'investment_calc', id, { asset: assetId });
  return assetId;
}
