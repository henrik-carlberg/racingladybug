import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher, fiscalYears } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { NON_DEDUCTIBLE_ACCOUNTS } from '@/lib/taxforms';
import { KINDS, NON_DEDUCTIBLE, PATTERN, PAY_FROM, TAX_INTEREST, deductibleCost, looksLikePenalty, penaltyLines, reclassLines, type Kind } from '@/lib/penalties';
import type { Actor } from './actor';
import { date, int, str } from './input';

const NAMES: Record<number, string> = { [NON_DEDUCTIBLE]: 'Övriga externa kostnader, ej avdragsgilla', [TAX_INTEREST]: 'Räntekostnader för skatter och avgifter', 1630: 'Avräkning för skatter och avgifter (skattekonto)', 2890: 'Övriga kortfristiga skulder' };

export async function overview(companyId: number, fyId?: number) {
  const years = await fiscalYears(companyId);
  const fy = years.find((y) => y.id === fyId) ?? years[0];
  if (!fy) return { years, fy: null, penalties: [], accounts: [], total: 0, suspicious: [] };
  const penalties = await sql<{ id: number; kind: Kind; authority: string; reference: string; date: string; amount: number; account: number; credit_account: number; voucher_id: number | null }[]>`
    SELECT id, kind, authority, reference, to_char(date,'YYYY-MM-DD') AS date, amount::float8 AS amount, account, credit_account, voucher_id FROM penalties
    WHERE company_id = ${companyId} AND date BETWEEN ${fy.start_date} AND ${fy.end_date} ORDER BY date DESC, id DESC`;
  const accounts = await sql<{ account: number; name: string | null; amount: number }[]>`SELECT l.account_number AS account, a.name, SUM(l.debit - l.credit)::float8 AS amount FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    LEFT JOIN accounts a ON a.company_id = v.company_id AND a.number = l.account_number
    WHERE v.company_id = ${companyId} AND v.date BETWEEN ${fy.start_date} AND ${fy.end_date} AND l.account_number IN ${sql(NON_DEDUCTIBLE_ACCOUNTS)} GROUP BY 1, 2 HAVING SUM(l.debit - l.credit) <> 0 ORDER BY 1`;
  const lines = await sql<{ voucher_id: number; number: string; date: string; description: string; account: number; amount: number }[]>`
    SELECT v.id AS voucher_id, COALESCE(v.series, '') || v.number AS number, to_char(v.date,'YYYY-MM-DD') AS date, v.description, l.account_number AS account, SUM(l.debit - l.credit)::float8 AS amount
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND v.date BETWEEN ${fy.start_date} AND ${fy.end_date} AND l.account_number BETWEEN 4000 AND 8899 AND v.description ~* ${PATTERN}
      AND NOT EXISTS (SELECT 1 FROM penalty_reviews r WHERE r.voucher_id = v.id AND r.account = l.account_number)
      AND NOT EXISTS (SELECT 1 FROM penalty_reviews r WHERE r.reclass_voucher_id = v.id)
    GROUP BY 1, 2, 3, 4, 5 HAVING SUM(l.debit - l.credit) > 0 ORDER BY v.date LIMIT 200`;
  return {
    years, fy, penalties, accounts, total: accounts.reduce((s, a) => s + a.amount, 0),
    suspicious: lines.filter((l) => looksLikePenalty(l.description) && deductibleCost(l.account, NON_DEDUCTIBLE_ACCOUNTS)),
  };
}

/** Avgiften bokförs direkt på ett konto för ej avdragsgilla kostnader */
export async function add(actor: Actor, input: Record<string, unknown>) {
  const kind = String(input.kind) as Kind;
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw new ValidationError('Välj typ av avgift');
  const amount = parseAmount(String(input.amount ?? '').trim());
  if (amount == null || amount <= 0) throw new ValidationError('Ange beloppet');
  const credit = int(input, 'credit_account', 'Betald från');
  if (!Object.prototype.hasOwnProperty.call(PAY_FROM, credit)) throw new ValidationError('Välj hur avgiften betalas');
  const d = date(input, 'date', 'Datum');
  const account = KINDS[kind].account;
  const authority = str(input, 'authority', { max: 100 }), reference = str(input, 'reference', { max: 60 });
  return sql.begin(async (tx) => {
    for (const n of [account, credit]) if (NAMES[n]) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n}, ${NAMES[n]}) ON CONFLICT DO NOTHING`;
    const [r] = await tx<{ id: number }[]>`INSERT INTO penalties ${tx({ company_id: actor.companyId, kind, authority, reference, date: d, amount, account, credit_account: credit, created_by: actor.userId })} RETURNING id`;
    const v = await createVoucher(tx, { actor, date: d, description: `${KINDS[kind].label.replace(/ \(.*\)$/, '')}${authority ? ` ${authority}` : ''}${reference ? ` ${reference}` : ''} (ej avdragsgill)`, lines: fromSigned(penaltyLines(amount, account, credit)), sourceType: 'penalty', sourceId: r.id });
    await tx`UPDATE penalties SET voucher_id = ${v.id} WHERE id = ${r.id}`;
    await auditBy(tx, actor, 'penalty', 'penalty', r.id, { kind, amount });
    return { amount, account };
  });
}

/** En avgift som bokförts på ett avdragsgillt konto flyttas till 6992 (eller markeras som granskad) */
export async function review(actor: Actor, voucherId: number, accountIn: number, action: 'reclassed' | 'ignored') {
  const account = Number(accountIn);
  if (!Number.isInteger(account) || !Number.isInteger(Number(voucherId))) throw new ValidationError('Ogiltig verifikationsrad');
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${Number(voucherId)}, ${account})`;
    const [l] = await tx<{ amount: number; description: string; date: string; closed: boolean }[]>`SELECT SUM(l.debit - l.credit)::float8 AS amount, v.description, to_char(v.date,'YYYY-MM-DD') AS date,
        EXISTS (SELECT 1 FROM fiscal_years f WHERE f.company_id = v.company_id AND v.date BETWEEN f.start_date AND f.end_date AND f.closed) AS closed
      FROM vouchers v JOIN voucher_lines l ON l.voucher_id = v.id AND l.account_number = ${account} WHERE v.id = ${voucherId} AND v.company_id = ${actor.companyId} GROUP BY v.id`;
    if (!l || l.amount <= 0) throw new NotFoundError('Verifikationsraden');
    if (!deductibleCost(account, NON_DEDUCTIBLE_ACCOUNTS)) throw new ValidationError('Kontot är inte ett avdragsgillt kostnadskonto');
    const [done] = await tx`SELECT 1 FROM penalty_reviews WHERE voucher_id = ${voucherId} AND account = ${account}`;
    if (done) throw new ConflictError('Raden är redan granskad');
    let reclassId: number | null = null;
    if (action === 'reclassed') {
      if (l.closed) throw new ConflictError('Räkenskapsåret är stängt – justera i deklarationen i stället');
      await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${NON_DEDUCTIBLE}, ${NAMES[NON_DEDUCTIBLE]}) ON CONFLICT DO NOTHING`;
      reclassId = (await createVoucher(tx, { actor, date: l.date, description: `Omföring till ej avdragsgill kostnad: ${l.description}`.slice(0, 200), lines: fromSigned(reclassLines(l.amount, account)), sourceType: 'penalty' })).id;
    }
    await tx`INSERT INTO penalty_reviews ${tx({ company_id: actor.companyId, voucher_id: voucherId, account, action, reclass_voucher_id: reclassId, created_by: actor.userId })}`;
    return l.amount;
  });
}
