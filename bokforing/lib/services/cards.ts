import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { matchReceipts } from '@/lib/cards';
import type { Actor } from './actor';
import { reconcile } from './bank';
import { pushEnabled, sendToUsers } from './push';

export interface CardAccount { id: number; name: string; ledger_account: number; holder_id: number | null; holder: string | null; missing: number; missing_amount: number }
export interface MissingTx { id: number; account: string; date: string; amount: number; text: string; age: number; holder: string | null }

/** Bankkonton markerade som företagskort, med antal kortköp som saknar kvitto */
export async function cardAccounts(companyId: number): Promise<CardAccount[]> {
  return [...await sql<CardAccount[]>`SELECT a.id, a.name, a.ledger_account, a.card_holder_user_id AS holder_id, u.name AS holder,
      count(t.id)::int AS missing, COALESCE(-SUM(t.amount), 0)::float8 AS missing_amount
    FROM bank_accounts a LEFT JOIN users u ON u.id = a.card_holder_user_id
      LEFT JOIN bank_transactions t ON t.bank_account_id = a.id AND t.status = 'unmatched' AND t.amount < 0
    WHERE a.company_id = ${companyId} AND a.is_card GROUP BY a.id, u.name ORDER BY a.name`];
}

/** Kortköp utan kvitto (äldst först). Begränsas till ett konto eller en kortinnehavare. */
export async function missingReceipts(companyId: number, f: { accountId?: number; holderId?: number } = {}): Promise<MissingTx[]> {
  return [...await sql<MissingTx[]>`SELECT t.id, a.name AS account, to_char(t.booking_date,'YYYY-MM-DD') AS date, t.amount::float8 AS amount,
      COALESCE(NULLIF(t.counterparty,''), t.description) AS text, (current_date - t.booking_date)::int AS age, u.name AS holder
    FROM bank_transactions t JOIN bank_accounts a ON a.id = t.bank_account_id LEFT JOIN users u ON u.id = a.card_holder_user_id
    WHERE t.company_id = ${companyId} AND a.is_card AND t.status = 'unmatched' AND t.amount < 0
      ${f.accountId ? sql`AND a.id = ${f.accountId}` : sql``} ${f.holderId ? sql`AND a.card_holder_user_id = ${f.holderId}` : sql``}
    ORDER BY t.booking_date, t.id LIMIT 500`];
}

/** Markerar ett bankkonto som företagskort och anger vem som har kortet (en medlem i bolaget) */
export async function setCard(actor: Actor, accountId: number, isCard: boolean, holderUserId: number | null) {
  if (holderUserId && !(await sql`SELECT 1 FROM memberships WHERE company_id = ${actor.companyId} AND user_id = ${holderUserId}`).length)
    throw new ValidationError('Kortinnehavaren ska vara medlem i bolaget');
  const r = await sql`UPDATE bank_accounts SET is_card = ${isCard}, card_holder_user_id = ${isCard ? holderUserId : null}
    WHERE id = ${accountId} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Bankkontot');
  await auditBy(sql, actor, 'card', 'bank_account', accountId, { is_card: isCard, holder: holderUserId });
}

/** Kortköp kopplas till bokförda kvitton med samma belopp på kortets konto (högst tre dagar isär) */
export async function matchCardReceipts(actor: Actor): Promise<number> {
  const accounts = await sql<{ id: number; ledger_account: number }[]>`SELECT id, ledger_account FROM bank_accounts WHERE company_id = ${actor.companyId} AND is_card`;
  let n = 0;
  for (const a of accounts) {
    const txs = await sql<{ id: number; date: string; amount: number; text: string }[]>`SELECT id, to_char(booking_date,'YYYY-MM-DD') AS date, amount::float8 AS amount,
        counterparty || ' ' || description AS text FROM bank_transactions
      WHERE bank_account_id = ${a.id} AND status = 'unmatched' AND amount < 0 AND booking_date > current_date - 120`;
    if (!txs.length) continue;
    const receipts = await sql<{ id: number; date: string; amount: number; text: string }[]>`SELECT v.id, to_char(v.date,'YYYY-MM-DD') AS date, v.description AS text,
        SUM(l.credit - l.debit)::float8 AS amount
      FROM vouchers v JOIN voucher_lines l ON l.voucher_id = v.id AND l.account_number = ${a.ledger_account}
      WHERE v.company_id = ${actor.companyId} AND v.source_type IN ('receipt','expense_claim') AND v.date > current_date - 130
        AND NOT EXISTS (SELECT 1 FROM bank_transactions t WHERE t.voucher_id = v.id) GROUP BY v.id HAVING SUM(l.credit - l.debit) > 0`;
    for (const m of matchReceipts(txs, receipts)) {
      try { await reconcile(actor, m.txId, { type: 'voucher', id: m.voucherId }); n++; } catch (e) { console.error('kortmatchning', m.txId, e instanceof Error ? e.message : e); }
    }
  }
  return n;
}

/** Ett nyss bokfört kvitto kopplas till kortköpet det fotades för */
export async function linkReceipt(actor: Actor, txId: number, voucherId: number) {
  return reconcile(actor, txId, { type: 'voucher', id: voucherId });
}

/** Kortkontot som ett kvitto för kortköpet ska bokföras mot (annars 1930) */
export async function cardLedger(companyId: number, txId: number) {
  const [r] = await sql<{ ledger_account: number; amount: number; date: string; text: string }[]>`SELECT a.ledger_account, t.amount::float8 AS amount,
      to_char(t.booking_date,'YYYY-MM-DD') AS date, COALESCE(NULLIF(t.counterparty,''), t.description) AS text
    FROM bank_transactions t JOIN bank_accounts a ON a.id = t.bank_account_id WHERE t.id = ${txId} AND t.company_id = ${companyId} AND t.status = 'unmatched' AND t.amount < 0`;
  return r ?? null;
}

/** Daglig påminnelse: kortköp äldre än två dagar utan kvitto. En notis per mottagare och dag, varje köp påminns om en gång i veckan. */
export async function remindMissingReceipts(): Promise<number> {
  const rows = await sql<{ id: number; company_id: number; holder: number | null }[]>`SELECT t.id, t.company_id, a.card_holder_user_id AS holder
    FROM bank_transactions t JOIN bank_accounts a ON a.id = t.bank_account_id
    WHERE a.is_card AND t.status = 'unmatched' AND t.amount < 0 AND t.booking_date <= current_date - 2 AND t.booking_date > current_date - 120
      AND (t.receipt_reminded_at IS NULL OR t.receipt_reminded_at < now() - interval '7 days')`;
  if (!rows.length) return 0;
  const groups = new Map<string, { companyId: number; users: number[]; ids: number[] }>();
  for (const r of rows) {
    const users = r.holder ? [r.holder] : (await sql<{ user_id: number }[]>`SELECT user_id FROM memberships WHERE company_id = ${r.company_id}
      AND (role = 'owner' OR (role = 'accountant' AND (permissions IS NULL OR 'ledger' = ANY(permissions))))`).map((m) => m.user_id);
    const key = `${r.company_id}:${users.join(',')}`;
    const g = groups.get(key) ?? { companyId: r.company_id, users, ids: [] };
    g.ids.push(r.id); groups.set(key, g);
  }
  let sent = 0;
  for (const g of groups.values()) {
    sent += g.ids.length;
    if (pushEnabled()) await sendToUsers(g.users, 'receipt', { title: 'Kvitton saknas', body: `${g.ids.length} kortköp saknar kvitto. Fota kvittona så bokförs de direkt.`,
      url: `/c/${g.companyId}/kort`, tag: `receipt-${g.companyId}` });
    await sql`UPDATE bank_transactions SET receipt_reminded_at = now() WHERE id IN ${sql(g.ids)}`;
  }
  return sent;
}

/** Nattlig körning: matcha kortköp mot kvitton i alla bolag med kortkonton och påminn om det som saknas */
export async function cardsDaily(): Promise<{ matched: number; reminded: number }> {
  let matched = 0;
  for (const c of await sql<{ company_id: number; owner: number }[]>`SELECT DISTINCT ON (a.company_id) a.company_id, m.user_id AS owner FROM bank_accounts a
      JOIN memberships m ON m.company_id = a.company_id AND m.role = 'owner' WHERE a.is_card ORDER BY a.company_id, m.user_id`) {
    try { matched += await matchCardReceipts({ companyId: c.company_id, userId: c.owner, apiKeyId: null, role: 'owner' }); } catch (e) { console.error('kort', c.company_id, e); }
  }
  return { matched, reminded: await remindMissingReceipts() };
}
