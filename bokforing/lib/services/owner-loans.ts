import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { assess, OWNER_LOAN_ACCOUNT, RELATION_LABEL, settleLines, unregistered, type Relation } from '@/lib/owner-loans';
import type { Actor } from './actor';
import { date, optInt, str } from './input';

const kronor = (v: unknown, label: string) => { const n = parseAmount(String(v ?? '')); if (n == null || n <= 0) throw new ValidationError(`Ange ${label} i kronor`); return n; };
async function balance(companyId: number, account: number, at = today()) {
  const [b] = await sql<{ b: number }[]>`SELECT COALESCE(SUM(l.debit - l.credit), 0)::float8 AS b FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND v.date <= ${at} AND l.account_number = ${account}`;
  return b.b;
}

export async function overview(companyId: number) {
  const [c] = await sql<{ t: string; owners: number }[]>`SELECT company_type AS t, (SELECT count(*)::int FROM company_owners o WHERE o.company_id = c.id) AS owners FROM companies c WHERE id = ${companyId}`;
  // Fåmansföretag: högst fyra ägare (förenklat); utan registrerade ägare antas bolaget vara ett fåmansföretag
  const closelyHeld = c.t === 'AB' && c.owners <= 4;
  const loans = await sql<{ id: number; borrower: string; relation: Relation; purpose: 'private' | 'business'; loan_date: string; amount: number; repaid: number; account: number; note: string }[]>`
    SELECT id, borrower, relation, purpose, to_char(loan_date,'YYYY-MM-DD') AS loan_date, amount::float8 AS amount, repaid::float8 AS repaid, account, note FROM owner_loans WHERE company_id = ${companyId} ORDER BY loan_date, id`;
  const rows = loans.map((l) => ({ ...l, label: RELATION_LABEL[l.relation], ...assess(l, closelyHeld) }));
  const onAccount = await balance(companyId, OWNER_LOAN_ACCOUNT);
  const registered = rows.filter((r) => r.account === OWNER_LOAN_ACCOUNT).reduce((s, r) => s + r.outstanding, 0);
  return { rows, closelyHeld, onAccount, unregistered: unregistered(onAccount, registered), dividendDebt: -(await balance(companyId, 2898)), prohibited: rows.filter((r) => r.prohibited).reduce((s, r) => s + r.outstanding, 0) };
}

export async function addLoan(actor: Actor, input: Record<string, unknown>) {
  const relation = str(input, 'relation') as Relation;
  if (!RELATION_LABEL[relation]) throw new ValidationError('Välj låntagarens förhållande till bolaget');
  const account = optInt(input, 'account', 'Konto') ?? OWNER_LOAN_ACCOUNT;
  if (account < 1300 || account > 1699) throw new ValidationError('Fordran ska ligga på ett konto 1300–1699');
  const [r] = await sql<{ id: number }[]>`INSERT INTO owner_loans ${sql({ company_id: actor.companyId, borrower: str(input, 'borrower', { required: true, label: 'Låntagare', max: 200 }), relation,
    purpose: str(input, 'purpose') === 'business' ? 'business' : 'private', loan_date: date(input, 'loan_date', 'Datum'), amount: kronor(input.amount, 'beloppet'), account, note: str(input, 'note', { max: 300 }), created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'owner_loan', r.id, { relation });
  return r.id;
}

/** Lånet regleras: återbetalning till banken eller kvittning mot beslutad utdelning */
export async function settle(actor: Actor, id: number, input: Record<string, unknown>) {
  const kind = str(input, 'kind') === 'dividend' ? 'dividend' : 'repay';
  const d = date(input, 'date', 'Datum', false) || today();
  const amount = kronor(input.amount, 'beloppet');
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Bankkonto måste vara ett 19xx-konto');
  return sql.begin(async (tx) => {
    // En reglering åt gången per bolag – annars kan samma beslutade utdelning kvittas mot två lån
    await tx`SELECT pg_advisory_xact_lock(119001, ${actor.companyId})`;
    const [l] = await tx<{ borrower: string; amount: number; repaid: number; account: number }[]>`SELECT borrower, amount::float8 AS amount, repaid::float8 AS repaid, account FROM owner_loans WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!l) throw new NotFoundError('Lånet');
    if (amount > l.amount - l.repaid) throw new ValidationError('Beloppet är större än det som återstår av lånet');
    if (kind === 'dividend') {
      const [b] = await tx<{ b: number }[]>`SELECT COALESCE(-SUM(l.debit - l.credit), 0)::float8 AS b FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${actor.companyId} AND l.account_number = 2898`;
      if (amount > b.b) throw new ValidationError('Det finns inte så mycket beslutad, obetald utdelning på 2898 att kvitta mot');
    }
    const v = await createVoucher(tx, { actor, date: d, description: `${kind === 'repay' ? 'Återbetalning av lån' : 'Kvittning mot utdelning av lån'}: ${l.borrower}`, lines: fromSigned(settleLines(kind, amount, l.account, bank)), sourceType: 'owner_loan', sourceId: id });
    await tx`UPDATE owner_loans SET repaid = repaid + ${amount} WHERE id = ${id}`;
    await auditBy(tx, actor, 'owner_loan_' + kind, 'owner_loan', id, { amount, voucher: v.id });
    return amount;
  });
}
