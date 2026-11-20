import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, createVoucher, fiscalYears, openingBalances } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { capitalOf, isPartnership, MAX_PARTNERS, n3b, ownerLines, partnerAccounts, validatePartners, type Partner } from '@/lib/partnership';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';

export async function companyType(companyId: number) {
  const [c] = await sql<{ t: string }[]>`SELECT company_type AS t FROM companies WHERE id = ${companyId}`;
  return c?.t ?? 'AB';
}

export async function listPartners(db: Tx | typeof sql, companyId: number): Promise<(Partner & { id: number; identity: string; kind: string })[]> {
  return (await db<{ id: number; n: number; name: string; identity: string; kind: string; share_pct: number; limited: boolean; contribution: number }[]>`
    SELECT id, n, name, identity, kind, share_pct::float8 AS share_pct, limited, contribution::float8 AS contribution FROM partners WHERE company_id = ${companyId} ORDER BY n`)
    .map((p) => ({ id: p.id, n: p.n, name: p.name, identity: p.identity, kind: p.kind, sharePct: p.share_pct, limited: p.limited, contribution: p.contribution }));
}

/** Delägarna (högst fyra). Delägare n får kontona 20n0 (eget kapital), 20n3 (uttag), 20n8 (insättningar) och 20n9 (årets resultat). */
export async function savePartners(actor: Actor, input: Record<string, unknown>) {
  const type = await companyType(actor.companyId);
  if (!isPartnership(type)) throw new ValidationError('Delägare finns i handels- och kommanditbolag');
  const rows: (Partner & { identity: string; kind: string })[] = [];
  for (let i = 1; i <= MAX_PARTNERS; i++) {
    const name = str(input, `name_${i}`, { max: 200 });
    if (!name) continue;
    const share = Number(String(input[`share_${i}`] ?? '').replace(',', '.'));
    if (!(share > 0 && share <= 100)) throw new ValidationError(`Ange andel i procent för ${name}`);
    const contribution = parseAmount(String(input[`contribution_${i}`] ?? '').trim() || '0');
    if (contribution == null || contribution < 0) throw new ValidationError(`Ogiltig insats för ${name}`);
    rows.push({ n: rows.length + 1, name, identity: str(input, `identity_${i}`, { max: 20 }), kind: str(input, `kind_${i}`) === 'company' ? 'company' : 'person',
      sharePct: share, limited: input[`limited_${i}`] === 'on', contribution });
  }
  const err = validatePartners(type, rows);
  if (err) throw new ValidationError(err);
  await sql.begin(async (tx) => {
    const used = await tx<{ n: number }[]>`SELECT DISTINCT ((l.account_number - 2000) / 10) AS n FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
      WHERE v.company_id = ${actor.companyId} AND l.account_number BETWEEN 2010 AND 2049`;
    for (const u of used) if (u.n > rows.length) throw new ValidationError(`Delägare ${u.n} har bokförda belopp och kan inte tas bort`);
    await tx`DELETE FROM partners WHERE company_id = ${actor.companyId}`;
    for (const p of rows) {
      await tx`INSERT INTO partners ${tx({ company_id: actor.companyId, n: p.n, name: p.name, identity: p.identity, kind: p.kind, share_pct: p.sharePct, limited: p.limited, contribution: p.contribution })}`;
      const a = partnerAccounts(p.n);
      for (const [num, label] of [[a.capital, 'Eget kapital'], [a.withdrawals, 'Egna uttag'], [a.contributions, 'Egna insättningar'], [a.result, 'Årets resultat']] as const)
        await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${num}, ${`${label}, delägare ${p.n} (${p.name})`})
          ON CONFLICT (company_id, number) DO UPDATE SET name = EXCLUDED.name`;
    }
    await auditBy(tx, actor, 'partners', 'company', actor.companyId, { count: rows.length });
  });
}

/** Uttag eller insättning för en delägare */
export async function ownerTransaction(actor: Actor, input: Record<string, unknown>) {
  const ps = await listPartners(sql, actor.companyId);
  const n = int(input, 'partner', 'Delägare');
  const p = ps.find((x) => x.n === n);
  if (!p) throw new NotFoundError('Delägaren');
  const amount = parseAmount(String(input.amount ?? ''));
  if (amount == null || amount <= 0) throw new ValidationError('Ange beloppet');
  const kind = str(input, 'kind') === 'contribution' ? 'contribution' : 'withdrawal';
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Bankkontot ska vara 19xx');
  return sql.begin(async (tx) => {
    const v = await createVoucher(tx, { actor, date: date(input, 'date', 'Datum'), description: `${kind === 'withdrawal' ? 'Eget uttag' : 'Egen insättning'} ${p.name}${str(input, 'note') ? ` – ${str(input, 'note')}` : ''}`,
      lines: fromSigned(ownerLines({ n, kind, amount, bank })), sourceType: 'partner' });
    await auditBy(tx, actor, kind, 'partner', p.id, { amount });
    return v;
  });
}

async function balancesAt(companyId: number, fy: { start_date: string; end_date: string }) {
  const ub = await openingBalances(companyId, fy.start_date);
  for (const [n, v] of await accountSums(companyId, fy.start_date, fy.end_date)) if (n < 3000) ub.set(n, (ub.get(n) ?? 0) + v);
  return ub;
}

/** Delägarnas kapitalkonton, årets rörelser och underlag till N3B för räkenskapsåret */
export async function overview(companyId: number, fyId?: number) {
  const years = await fiscalYears(companyId);
  const fy = years.find((y) => y.id === fyId) ?? years.find((y) => !y.closed) ?? years[0];
  const ps = await listPartners(sql, companyId);
  if (!fy) return { fy: null, years, partners: ps, rows: [], n3b: [] };
  const ub = await balancesAt(companyId, fy);
  const ib = await openingBalances(companyId, fy.start_date);
  const sums = await accountSums(companyId, fy.start_date, fy.end_date);
  const resultBefore = -[...sums].filter(([n]) => n >= 3000 && n <= 8989).reduce((s, [, v]) => s + v, 0);
  const booked = (sums.get(8999) ?? 0) !== 0;
  const rows = ps.map((p) => {
    const a = partnerAccounts(p.n);
    return { ...p, opening: capitalOf(ib, p.n), withdrawals: sums.get(a.withdrawals) ?? 0, contributions: -(sums.get(a.contributions) ?? 0),
      result: booked ? -(sums.get(a.result) ?? 0) : Math.round((resultBefore * p.sharePct) / 100), closing: capitalOf(ub, p.n) + (booked ? 0 : Math.round((resultBefore * p.sharePct) / 100)) };
  });
  // Ej avdragsgilla kostnader (representation m.m.) läggs till i det skattemässiga resultatet
  const nonDeductible = [6072, 6982, 6992, 7623, 8423].reduce((s, n) => s + (sums.get(n) ?? 0), 0);
  return { fy, years, partners: ps, rows, resultBefore, booked, n3b: ps.length ? n3b({ result: resultBefore, nonDeductible, taxFree: 0, partners: ps }) : [], nonDeductible };
}

