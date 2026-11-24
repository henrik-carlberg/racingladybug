import 'server-only';
import { sql } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { exposure, overLimit, type Forward } from '@/lib/fx-exposure';
import type { Actor } from './actor';
import { fxBasis } from './fx-revaluation';

export async function overview(companyId: number) {
  const basis = await fxBasis(companyId, today());
  const forwards = await sql<Forward[]>`SELECT currency, direction, amount::float8 AS amount FROM fx_forwards WHERE company_id = ${companyId} AND status = 'open'`;
  const settings = await sql<{ currency: string; rate: number | null; limit_sek: number | null }[]>`SELECT currency, rate::float8 AS rate, limit_sek::float8 AS limit_sek FROM fx_exposure_settings WHERE company_id = ${companyId}`;
  const rates = Object.fromEntries(settings.map((s) => [s.currency, s.rate]));
  const rows = exposure(basis.items, forwards, rates).map((r) => {
    const s = settings.find((x) => x.currency === r.currency);
    return { ...r, limit: s?.limit_sek ?? null, manualRate: s?.rate ?? null, over: overLimit(r.unhedgedSek, s?.limit_sek ?? null) };
  });
  return { rows, items: basis.items };
}

export async function saveSettings(actor: Actor, currency: string, input: Record<string, unknown>) {
  const c = String(currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(c) || c === 'SEK') throw new ValidationError('Ogiltig valuta');
  const rs = String(input.rate ?? '').trim().replace(',', '.');
  const rate = rs ? Number(rs) : null;
  if (rate != null && !(rate > 0 && rate < 100000)) throw new ValidationError('Ogiltig kurs');
  const ls = String(input.limit ?? '').trim();
  const limit = ls ? parseAmount(ls) : null;
  if (ls && (limit == null || limit < 0)) throw new ValidationError('Ogiltig gräns');
  await sql`INSERT INTO fx_exposure_settings (company_id, currency, rate, limit_sek) VALUES (${actor.companyId}, ${c}, ${rate}, ${limit})
    ON CONFLICT (company_id, currency) DO UPDATE SET rate = EXCLUDED.rate, limit_sek = EXCLUDED.limit_sek`;
}
