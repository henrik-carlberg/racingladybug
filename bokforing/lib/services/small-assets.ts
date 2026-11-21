import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { ASSET_CATEGORIES, periodOf, type AssetCategory } from '@/lib/assets';
import { EXPENSE_ACCOUNT, activationLines, flag, halfPriceBase } from '@/lib/small-assets';
import type { Actor } from './actor';
import { ensureAccounts } from './assets';
import { str } from './input';

/** Kostnadsförda förbrukningsinventarier under året som borde bedömas, utom de som redan är bedömda */
export async function review(companyId: number, year: number) {
  const rows = await sql<{ voucherId: number; date: string; text: string; amount: number; label: string }[]>`
    SELECT v.id AS "voucherId", to_char(v.date,'YYYY-MM-DD') AS date, v.series || v.number AS label, COALESCE(NULLIF(l.description, ''), v.description) AS text, SUM(l.debit - l.credit)::float8 AS amount
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND l.account_number = ${EXPENSE_ACCOUNT} AND extract(year from v.date) = ${year}
      AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = v.id) AND v.corrects_id IS NULL
    GROUP BY v.id, v.date, v.series, v.number, COALESCE(NULLIF(l.description, ''), v.description) HAVING SUM(l.debit - l.credit) > 0 ORDER BY v.date, v.id`;
  const decided = await sql<{ voucher_id: number; decision: string; note: string; label: string; date: string }[]>`SELECT s.voucher_id, s.decision, s.note, v.series || v.number AS label, to_char(v.date,'YYYY-MM-DD') AS date
    FROM small_asset_reviews s JOIN vouchers v ON v.id = s.voucher_id WHERE s.company_id = ${companyId} AND extract(year from v.date) = ${year} ORDER BY v.date`;
  // Sambandet bedöms på alla årets inköp, även de som redan är bedömda; bara obedömda visas för beslut
  const done = new Set(decided.map((d) => d.voucher_id));
  const flagged = flag(rows, year).filter((r) => !done.has(r.voucherId)).map((r) => ({ ...r, label: rows.find((x) => x.voucherId === r.voucherId)?.label ?? '' }));
  return { year, half: halfPriceBase(year), flagged, decided };
}

/** Beslut: behåll direktavdraget (korttidsinventarie eller annan motivering) */
export async function keep(actor: Actor, voucherId: number, input: Record<string, unknown>) {
  const decision = str(input, 'decision') === 'short_life' ? 'short_life' : 'keep';
  const note = str(input, 'note', { max: 500 });
  if (decision === 'keep' && !note) throw new ValidationError('Motivera varför direktavdraget behålls');
  const [v] = await sql`SELECT 1 FROM vouchers WHERE id = ${voucherId} AND company_id = ${actor.companyId}`;
  if (!v) throw new NotFoundError('Verifikationen');
  const r = await sql`INSERT INTO small_asset_reviews ${sql({ voucher_id: voucherId, company_id: actor.companyId, decision, note, decided_by: actor.userId })} ON CONFLICT DO NOTHING RETURNING voucher_id`;
  if (!r.length) throw new ConflictError('Inköpet är redan bedömt');
  await auditBy(sql, actor, 'small_asset_keep', 'voucher', voucherId, { decision });
}

/** Aktivering: kostnaden förs om till anläggningskontot och inventariet läggs upp i anläggningsregistret med avskrivning från inköpsmånaden */
export async function activate(actor: Actor, voucherId: number, input: Record<string, unknown>) {
  const category = (str(input, 'category') || 'inventarier') as AssetCategory;
  const cat = ASSET_CATEGORIES[category];
  if (!cat || !['inventarier', 'maskiner', 'datorer', 'bilar'].includes(category)) throw new ValidationError('Välj kategori');
  return sql.begin(async (tx) => {
    const [v] = await tx<{ date: string; text: string; amount: number }[]>`SELECT to_char(v.date,'YYYY-MM-DD') AS date, v.description AS text,
      COALESCE((SELECT SUM(debit - credit) FROM voucher_lines WHERE voucher_id = v.id AND account_number = ${EXPENSE_ACCOUNT}), 0)::float8 AS amount
      FROM vouchers v WHERE v.id = ${voucherId} AND v.company_id = ${actor.companyId} FOR UPDATE`;
    if (!v) throw new NotFoundError('Verifikationen');
    if (v.amount <= 0) throw new ValidationError('Verifikationen har ingen kostnad på förbrukningsinventarier');
    const [dup] = await tx`SELECT 1 FROM small_asset_reviews WHERE voucher_id = ${voucherId}`;
    if (dup) throw new ConflictError('Inköpet är redan bedömt');
    await ensureAccounts(tx, actor.companyId, category);
    const out = await createVoucher(tx, { actor, date: v.date, description: `Aktivering av inventarie: ${v.text}`, lines: fromSigned(activationLines(v.amount, cat.asset)), sourceType: 'asset_activation', sourceId: voucherId });
    const [a] = await tx<{ id: number }[]>`INSERT INTO assets ${tx({ company_id: actor.companyId, name: v.text.slice(0, 200), category, asset_account: cat.asset, acc_dep_account: cat.accDep, dep_account: cat.dep,
      acquired_on: v.date, cost: v.amount, residual: 0, life_months: cat.life, dep_start: `${periodOf(v.date)}-01`, source_voucher_id: voucherId, notes: 'Aktiverad från förbrukningsinventarier', created_by: actor.userId })} RETURNING id`;
    await tx`INSERT INTO small_asset_reviews ${tx({ voucher_id: voucherId, company_id: actor.companyId, decision: 'activated', asset_id: a.id, voucher_out: out.id, decided_by: actor.userId })}`;
    await auditBy(tx, actor, 'small_asset_activate', 'voucher', voucherId, { asset: a.id, amount: v.amount });
    return { assetId: a.id, amount: v.amount };
  });
}
