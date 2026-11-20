import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, createVoucher, fiscalYears, openingBalances } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { evaluate, fundLines, propose, type EfInput } from '@/lib/ef-tax';
import type { Actor } from './actor';
import { yearStatus } from './yearend';

async function fyAndType(companyId: number, fyId: number) {
  const fy = (await fiscalYears(companyId)).find((y) => y.id === fyId);
  if (!fy) throw new ValidationError('Räkenskapsåret finns inte');
  const [c] = await sql<{ t: string }[]>`SELECT company_type AS t FROM companies WHERE id = ${companyId}`;
  if (c.t !== 'EF') throw new ValidationError('Skatteplaneringen på NE gäller enskild firma');
  return fy;
}

export async function params(companyId: number, year: number) {
  const [p] = await sql<{ slr_pct: number; municipal_pct: number; brytpunkt: number }[]>`
    SELECT slr_pct::float8 AS slr_pct, municipal_pct::float8 AS municipal_pct, brytpunkt::float8 AS brytpunkt FROM ef_tax_params WHERE company_id = ${companyId} AND year = ${year}`;
  return p ?? null;
}

export async function saveParams(actor: Actor, fyId: number, input: Record<string, unknown>) {
  const fy = await fyAndType(actor.companyId, fyId);
  const num = (k: string, label: string, max: number) => { const n = Number(String(input[k] ?? '').replace(',', '.')); if (!(n >= 0 && n < max)) throw new ValidationError(`Ange ${label}`); return n; };
  const bp = parseAmount(String(input.brytpunkt ?? ''));
  if (bp == null || bp <= 0) throw new ValidationError('Ange brytpunkten för statlig skatt i kronor');
  const year = Number(fy.end_date.slice(0, 4));
  await sql`INSERT INTO ef_tax_params (company_id, year, slr_pct, municipal_pct, brytpunkt) VALUES (${actor.companyId}, ${year}, ${num('slr_pct', 'statslåneräntan i procent', 20)}, ${num('municipal_pct', 'kommunalskatten i procent', 50)}, ${bp})
    ON CONFLICT (company_id, year) DO UPDATE SET slr_pct = EXCLUDED.slr_pct, municipal_pct = EXCLUDED.municipal_pct, brytpunkt = EXCLUDED.brytpunkt`;
  await auditBy(sql, actor, 'ef_tax_params', 'fiscal_year', fyId);
}

const equity = (m: Map<number, number>) => -[...m].filter(([n]) => n >= 2000 && n <= 2049).reduce((s, [, v]) => s + v, 0);

export async function planning(companyId: number, fyId: number) {
  const fy = await fyAndType(companyId, fyId);
  const year = Number(fy.end_date.slice(0, 4));
  const s = await yearStatus(companyId, fyId);
  const ib = await openingBalances(companyId, fy.start_date);
  const ub = new Map(ib);
  for (const [n, v] of await accountSums(companyId, fy.start_date, fy.end_date)) if (n < 3000) ub.set(n, (ub.get(n) ?? 0) + v);
  const p = await params(companyId, year);
  const input: EfInput | null = p ? {
    result: s.resultBeforeTax, nonDeductible: s.nonDeductible, capitalStart: equity(ib), capitalEnd: equity(ub) + (s.resultBooked ? 0 : s.resultBeforeTax),
    expansionExisting: -(ib.get(2050) ?? 0), slrPct: p.slr_pct, municipalPct: p.municipal_pct, brytpunkt: p.brytpunkt,
  } : null;
  const [booked] = await sql<{ id: number }[]>`SELECT id FROM vouchers WHERE company_id = ${companyId} AND source_type = 'ef_funds' AND fiscal_year_id = ${fyId}
    AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = vouchers.id) LIMIT 1`;
  return { fy, year, params: p, input, proposal: input ? propose(input) : null, booked: booked?.id ?? null, closed: fy.closed };
}

/** Bokför vald periodiseringsfond och expansionsfond per bokslutsdagen (inom de gränser beräkningen tillåter) */
export async function bookFunds(actor: Actor, fyId: number, input: Record<string, unknown>) {
  const pl = await planning(actor.companyId, fyId);
  if (!pl.input || !pl.proposal) throw new ValidationError('Ange årets satser först');
  if (pl.closed) throw new ConflictError('Räkenskapsåret är stängt');
  if (pl.booked) throw new ConflictError('Fonderna är redan bokförda för året – rätta verifikationen om du vill ändra');
  const kr = (k: string) => { const v = parseAmount(String(input[k] ?? '').trim() || '0'); if (v == null || v < 0) throw new ValidationError('Ogiltigt belopp'); return v; };
  const pfond = kr('pfond'), expansion = kr('expansion');
  if (pfond > pl.proposal.pfondMax) throw new ValidationError(`Periodiseringsfonden får vara högst ${(pl.proposal.pfondMax / 100).toLocaleString('sv-SE')} kr`);
  if (expansion > pl.proposal.expMax) throw new ValidationError(`Expansionsfonden får vara högst ${(pl.proposal.expMax / 100).toLocaleString('sv-SE')} kr`);
  if (!pfond && !expansion) throw new ValidationError('Ange minst en avsättning');
  const lines = fundLines({ year: pl.year, pfond, expansion });
  return sql.begin(async (tx) => {
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, 8811, 'Avsättning till periodiseringsfond'),
      (${actor.companyId}, ${2120 + (pl.year % 10)}, ${`Periodiseringsfond ${pl.year}`}), (${actor.companyId}, 2050, 'Avsättning till expansionsfond'), (${actor.companyId}, 2010, 'Eget kapital') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: pl.fy.end_date, description: `Avsättning till fonder ${pl.year} enligt skatteplaneringen`, lines: fromSigned(lines), sourceType: 'ef_funds' });
    await auditBy(tx, actor, 'ef_funds', 'fiscal_year', fyId, { pfond, expansion, plan: evaluate(pl.input!, { interest: pl.proposal!.plan.interest, pfond, expansion }).total });
    return v;
  });
}
