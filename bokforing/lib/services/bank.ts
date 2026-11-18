import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { createVoucher } from '@/lib/server/ledger';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { decrypt, encrypt } from '@/lib/server/crypto';
import { fromSigned } from '@/lib/ledger-lines';
import { ACC } from '@/lib/bas';
import { addDays, today } from '@/lib/format';
import * as eb from '@/lib/bank/enablebanking';
import { decimalToOre, parseBankCsv, parseCamt053, fromEnableBanking, type BankTx } from '@/lib/bank/parse';
import { suggestMatches, type Suggestion } from '@/lib/bank/match';
import { learnKey } from '@/lib/bank/rules';
import { accountSuggestions, type AccountSuggestion } from './bank-rules';
import { dimId } from './dimensions';
import { registerPaymentTx } from './invoices';
import { paySupplierInvoiceTx } from './suppliers';
import type { Actor } from './actor';
import { int, optInt, str } from './input';

const STATE_TTL_MIN = 15;
const INITIAL_DAYS = 90;

// ---------- Konton och kopplingar ----------

export interface BankAccountOut {
  id: number; object: 'bank_account'; name: string; iban: string; currency: string; ledger_account: number;
  balance: number | null; balance_date: string | null; last_synced_at: string | null; source: 'open_banking' | 'file';
  bank: string | null; connection_status: string | null; consent_valid_until: string | null; unmatched: number;
}

export async function listBankAccounts(companyId: number): Promise<BankAccountOut[]> {
  return [...await sql<BankAccountOut[]>`
    SELECT a.id, 'bank_account' AS object, a.name, a.iban, a.currency, a.ledger_account, a.balance,
      to_char(a.balance_date,'YYYY-MM-DD') AS balance_date, a.last_synced_at,
      CASE WHEN a.connection_id IS NULL THEN 'file' ELSE 'open_banking' END AS source,
      c.aspsp_name AS bank, c.status AS connection_status, c.valid_until AS consent_valid_until,
      (SELECT count(*) FROM bank_transactions t WHERE t.bank_account_id = a.id AND t.status = 'unmatched')::int AS unmatched
    FROM bank_accounts a LEFT JOIN bank_connections c ON c.id = a.connection_id
    WHERE a.company_id = ${companyId} AND a.active ORDER BY a.id`];
}

async function ownAccount(db: Tx | typeof sql, companyId: number, id: number) {
  const [a] = await db<{ id: number; ledger_account: number; connection_id: number | null; provider_uid: string | null; last_synced_at: Date | null; name: string }[]>`
    SELECT id, ledger_account, connection_id, provider_uid, last_synced_at, name FROM bank_accounts WHERE id = ${id} AND company_id = ${companyId}`;
  if (!a) throw new NotFoundError('Bankkontot');
  return a;
}

/** Konto utan Open Banking (för filimport) */
export async function createManualAccount(actor: Actor, input: Record<string, unknown>) {
  const ledger = optInt(input, 'ledger_account', 'Bokföringskonto') ?? 1930;
  if (ledger < 1900 || ledger > 1999) throw new ValidationError('Bokföringskontot måste vara ett 19xx-konto');
  const [a] = await sql<{ id: number }[]>`INSERT INTO bank_accounts (company_id, name, iban, ledger_account)
    VALUES (${actor.companyId}, ${str(input, 'name', { required: true, label: 'Namn' })}, ${str(input, 'iban').replace(/\s/g, '')}, ${ledger}) RETURNING id`;
  await auditBy(sql, actor, 'create', 'bank_account', a.id);
  return a.id;
}

export async function updateAccountLedger(actor: Actor, id: number, ledger: number) {
  if (ledger < 1900 || ledger > 1999) throw new ValidationError('Bokföringskontot måste vara ett 19xx-konto');
  await ownAccount(sql, actor.companyId, id);
  await sql`UPDATE bank_accounts SET ledger_account = ${ledger} WHERE id = ${id}`;
  await auditBy(sql, actor, 'update', 'bank_account', id, { ledger_account: ledger });
}

// ---------- Open Banking-koppling ----------

/** Startar koppling: returnerar bankens inloggningsadress (BankID). Endast ägaren kan koppla bank. */
export async function startConnection(actor: Actor, input: Record<string, unknown>, callbackUrl: string): Promise<string> {
  if (actor.role !== 'owner') throw new ForbiddenError('Endast bolagets ägare kan koppla bankkonton');
  const aspsp = str(input, 'aspsp', { required: true, label: 'Bank' });
  const country = (str(input, 'country') || 'SE').toUpperCase();
  const psuType = str(input, 'psu_type') === 'personal' ? 'personal' : 'business';
  const banks = await eb.listAspsps(country);
  const bank = banks.find((b) => b.name === aspsp);
  if (!bank) throw new ValidationError(`Okänd bank: ${aspsp}`);
  // Samtycket får gälla högst bankens maximum (ofta 90–180 dagar)
  const maxSec = bank.maximum_consent_validity ?? 90 * 86400;
  const validUntil = new Date(Date.now() + Math.min(maxSec, 180 * 86400) * 1000 - 60_000);
  const state = randomBytes(24).toString('base64url');
  const [c] = await sql<{ id: number }[]>`INSERT INTO bank_connections (company_id, provider, aspsp_name, aspsp_country, created_by)
    VALUES (${actor.companyId}, 'enablebanking', ${aspsp}, ${country}, ${actor.userId}) RETURNING id`;
  await sql`INSERT INTO bank_auth_states (state, connection_id, user_id, expires_at)
    VALUES (${state}, ${c.id}, ${actor.userId}, ${new Date(Date.now() + STATE_TTL_MIN * 60_000)})`;
  const r = await eb.startAuthorization({ aspspName: aspsp, country, state, redirectUrl: callbackUrl, validUntil, psuType });
  await auditBy(sql, actor, 'start', 'bank_connection', c.id, { aspsp });
  return r.url;
}

/** Banken skickar tillbaka användaren med code + state. Returnerar bolagets id. */
export async function completeConnection(userId: number, state: string, code: string | null, error: string | null): Promise<number> {
  const [s] = await sql<{ connection_id: number; company_id: number; user_id: number }[]>`
    DELETE FROM bank_auth_states st USING bank_connections c
    WHERE st.state = ${state} AND c.id = st.connection_id AND st.expires_at > now()
    RETURNING st.connection_id, c.company_id, st.user_id`;
  if (!s) throw new ValidationError('Bankkopplingen har gått ut eller är ogiltig. Försök igen.');
  if (s.user_id !== userId) throw new ForbiddenError('Bankkopplingen startades av en annan användare');
  const owner = await sql`SELECT 1 FROM memberships WHERE user_id = ${userId} AND company_id = ${s.company_id} AND role = 'owner'`;
  if (!owner.length) throw new ForbiddenError('Endast bolagets ägare kan koppla bankkonton');
  const actor: Actor = { companyId: s.company_id, userId, apiKeyId: null, role: 'owner' };
  if (error || !code) {
    await sql`UPDATE bank_connections SET status = 'error', last_error = ${error ?? 'Avbruten'} WHERE id = ${s.connection_id}`;
    throw new ValidationError(error === 'access_denied' ? 'Kopplingen avbröts i banken' : `Banken returnerade ett fel: ${error}`);
  }
  const session = await eb.createSession(code);
  await sql.begin(async (tx) => {
    await tx`UPDATE bank_connections SET status = 'active', session_enc = ${encrypt(session.session_id)},
      valid_until = ${session.access.valid_until} WHERE id = ${s.connection_id}`;
    for (const a of session.accounts) {
      if (!a.uid) continue;
      const iban = a.account_id?.iban ?? a.account_id?.other?.identification ?? '';
      await tx`INSERT INTO bank_accounts (company_id, connection_id, provider_uid, name, iban, currency)
        VALUES (${s.company_id}, ${s.connection_id}, ${a.uid}, ${a.name || a.product || `${session.aspsp.name} ${iban.slice(-4)}`}, ${iban}, ${a.currency || 'SEK'})
        ON CONFLICT (company_id, connection_id, provider_uid) DO UPDATE SET active = true`;
    }
    await auditBy(tx, actor, 'connect', 'bank_connection', s.connection_id, { aspsp: session.aspsp.name, accounts: session.accounts.length });
    await emit(tx, s.company_id, 'bank.connected', { object: 'bank_connection', id: s.connection_id, bank: session.aspsp.name, valid_until: session.access.valid_until });
  });
  // Första hämtningen
  const accounts = await sql<{ id: number }[]>`SELECT id FROM bank_accounts WHERE connection_id = ${s.connection_id}`;
  for (const a of accounts) await syncAccount(actor, a.id).catch((e) => console.error('första synk', e));
  return s.company_id;
}

export async function disconnect(actor: Actor, connectionId: number) {
  if (actor.role !== 'owner') throw new ForbiddenError('Endast bolagets ägare kan koppla bort banker');
  const [c] = await sql<{ session_enc: string | null }[]>`SELECT session_enc FROM bank_connections WHERE id = ${connectionId} AND company_id = ${actor.companyId}`;
  if (!c) throw new NotFoundError('Kopplingen');
  if (c.session_enc) await eb.deleteSession(decrypt(c.session_enc)).catch((e) => console.error('delete session', e));
  await sql`UPDATE bank_connections SET status = 'revoked', session_enc = NULL WHERE id = ${connectionId}`;
  await auditBy(sql, actor, 'disconnect', 'bank_connection', connectionId);
}

// ---------- Hämta transaktioner ----------

async function insertTransactions(actor: Actor, accountId: number, list: BankTx[], source: string) {
  if (list.length === 0) return { imported: 0, duplicates: 0 };
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: number }[]>`
      INSERT INTO bank_transactions (company_id, bank_account_id, external_id, booking_date, amount, currency, description, reference, counterparty, source, raw)
      SELECT ${actor.companyId}, ${accountId}, x.external_id, x.booking_date::date, x.amount, x.currency, x.description, x.reference, x.counterparty, ${source}, x.raw
      FROM jsonb_to_recordset(${tx.json(list.map((t) => ({
        external_id: t.externalId, booking_date: t.bookingDate, amount: t.amount, currency: t.currency,
        description: t.description, reference: t.reference, counterparty: t.counterparty, raw: t.raw ?? null,
      })) as never)}) AS x(external_id text, booking_date text, amount bigint, currency text, description text, reference text, counterparty text, raw jsonb)
      ON CONFLICT (bank_account_id, external_id) DO NOTHING RETURNING id`;
    if (rows.length) {
      await auditBy(tx, actor, 'import', 'bank_transactions', accountId, { source, imported: rows.length });
      await emit(tx, actor.companyId, 'bank.transactions.imported', { object: 'bank_import', bank_account_id: accountId, source, imported: rows.length });
    }
    return { imported: rows.length, duplicates: list.length - rows.length };
  });
}

export async function syncAccount(actor: Actor, accountId: number) {
  const a = await ownAccount(sql, actor.companyId, accountId);
  if (!a.connection_id || !a.provider_uid) throw new ValidationError('Kontot är inte kopplat via Open Banking – importera fil i stället');
  const [c] = await sql<{ session_enc: string | null; status: string; valid_until: Date | null }[]>`
    SELECT session_enc, status, valid_until FROM bank_connections WHERE id = ${a.connection_id}`;
  if (!c.session_enc || c.status !== 'active') throw new ValidationError('Bankkopplingen är inte aktiv – koppla banken igen');
  if (c.valid_until && c.valid_until < new Date()) {
    await sql`UPDATE bank_connections SET status = 'expired' WHERE id = ${a.connection_id}`;
    throw new ValidationError('Bankens samtycke har gått ut – koppla banken igen (kräver BankID)');
  }
  const from = a.last_synced_at ? addDays(a.last_synced_at.toISOString().slice(0, 10), -7) : addDays(today(), -INITIAL_DAYS);
  try {
    const txs = fromEnableBanking(await eb.fetchTransactions(a.provider_uid, from));
    const result = await insertTransactions(actor, accountId, txs, 'enablebanking');
    const bal = await eb.fetchBalance(a.provider_uid).catch(() => null);
    await sql`UPDATE bank_accounts SET last_synced_at = now(),
      balance = ${bal ? decimalToOre(bal.amount) : null}, balance_date = ${bal ? bal.date ?? today() : null} WHERE id = ${accountId}`;
    return result;
  } catch (e) {
    if (e instanceof eb.BankProviderError && ['EXPIRED_SESSION', 'REVOKED_SESSION', 'CLOSED_SESSION'].includes(e.code ?? '')) {
      await sql`UPDATE bank_connections SET status = 'expired', last_error = ${e.message} WHERE id = ${a.connection_id}`;
    }
    throw e;
  }
}

/** Synkar alla aktiva Open Banking-konton (cron) */
export async function syncAllAccounts(): Promise<{ accounts: number; imported: number; errors: number; matched: number }> {
  const accts = await sql<{ id: number; company_id: number; created_by: number }[]>`
    SELECT a.id, a.company_id, c.created_by FROM bank_accounts a JOIN bank_connections c ON c.id = a.connection_id
    WHERE a.active AND c.status = 'active'`;
  let imported = 0, errors = 0;
  for (const a of accts) {
    try {
      imported += (await syncAccount({ companyId: a.company_id, userId: a.created_by, apiKeyId: null, role: 'owner' }, a.id)).imported;
    } catch (e) { errors++; console.error('bank sync', a.id, e); }
  }
  // Säkra matchningar och automatiska konteringsregler per bolag
  let matched = 0;
  for (const c of new Map(accts.map((a) => [a.company_id, a.created_by]))) {
    try { matched += await autoMatch({ companyId: c[0], userId: c[1], apiKeyId: null, role: 'owner' }); } catch (e) { console.error('automatch', c[0], e); }
  }
  return { accounts: accts.length, imported, errors, matched };
}

export async function importFile(actor: Actor, accountId: number, filename: string, content: string) {
  await ownAccount(sql, actor.companyId, accountId);
  const isXml = content.trimStart().startsWith('<');
  const list = isXml ? parseCamt053(content).transactions : parseBankCsv(content);
  if (list.length === 0) throw new ValidationError(`Hittade inga bokförda transaktioner i ${filename}`);
  return insertTransactions(actor, accountId, list, isXml ? 'camt053' : 'csv');
}

// ---------- Avstämning ----------

export interface BankTxOut {
  id: number; object: 'bank_transaction'; bank_account_id: number; booking_date: string; amount: number; currency: string;
  description: string; reference: string; counterparty: string; status: 'unmatched' | 'matched' | 'ignored';
  match_type: string | null; match_id: number | null; voucher_id: number | null; suggestions?: Suggestion[]; accountSuggestion?: AccountSuggestion;
  booked_account?: number | null; rule_id?: number | null;
}

const TCOLS = () => sql`id, 'bank_transaction' AS object, bank_account_id, to_char(booking_date,'YYYY-MM-DD') AS booking_date, amount, currency,
  description, reference, counterparty, status, match_type, match_id, voucher_id, booked_account, rule_id`;

export async function listTransactions(companyId: number, f: { status?: string; account_id?: number; limit?: number; withSuggestions?: boolean }) {
  const rows = [...await sql<BankTxOut[]>`SELECT ${TCOLS()} FROM bank_transactions WHERE company_id = ${companyId}
    ${f.status ? sql`AND status = ${f.status}` : sql``} ${f.account_id ? sql`AND bank_account_id = ${f.account_id}` : sql``}
    ORDER BY booking_date DESC, id DESC LIMIT ${Math.min(f.limit ?? 200, 1000)}`];
  if (f.withSuggestions && rows.some((r) => r.status === 'unmatched')) {
    const c = await candidates(companyId);
    for (const r of rows) {
      if (r.status !== 'unmatched') continue;
      const ledger = c.ledgerByAccount.get(r.bank_account_id) ?? 1930;
      r.suggestions = suggestMatches(
        { amount: r.amount, bookingDate: r.booking_date, description: r.description, reference: r.reference, counterparty: r.counterparty },
        { invoices: c.invoices, supplierInvoices: c.supplierInvoices, voucherLines: c.voucherLines.filter((v) => v.ledger === ledger) },
      );
    }
    const acc = await accountSuggestions(companyId, rows.filter((r) => r.status === 'unmatched'));
    for (const r of rows) { const a = acc.get(r.id); if (a) r.accountSuggestion = a; }
  }
  return rows;
}

async function candidates(companyId: number) {
  const invoices = await sql<{ id: number; number: number; ocr: string | null; total: number; customer: string }[]>`
    SELECT i.id, i.invoice_number AS number, i.ocr, i.total, c.name AS customer FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.company_id = ${companyId} AND i.status = 'booked'`;
  const supplierInvoices = await sql<{ id: number; invoiceNumber: string; paymentReference: string; total: number; supplier: string; status: string }[]>`
    SELECT i.id, i.invoice_number AS "invoiceNumber", i.payment_reference AS "paymentReference", i.total, s.name AS supplier, i.status
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.company_id = ${companyId} AND i.status IN ('booked','approved')`;
  // Bokförda rader på bankkonton som inte redan är kopplade till en banktransaktion (senaste året)
  const voucherLines = await sql<{ voucherId: number; label: string; date: string; amount: number; description: string; ledger: number }[]>`
    SELECT v.id AS "voucherId", v.series || v.number AS label, to_char(v.date,'YYYY-MM-DD') AS date,
      SUM(l.debit - l.credit)::bigint AS amount, v.description, l.account_number AS ledger
    FROM vouchers v JOIN voucher_lines l ON l.voucher_id = v.id
    WHERE v.company_id = ${companyId} AND l.account_number BETWEEN 1900 AND 1999 AND v.date > now() - interval '1 year'
      AND NOT EXISTS (SELECT 1 FROM bank_transactions t WHERE t.voucher_id = v.id)
      AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = v.id) AND v.source_type NOT IN ('reversal','opening_balance')
    GROUP BY v.id, l.account_number`;
  const accts = await sql<{ id: number; ledger_account: number }[]>`SELECT id, ledger_account FROM bank_accounts WHERE company_id = ${companyId}`;
  return { invoices: [...invoices], supplierInvoices: [...supplierInvoices], voucherLines: [...voucherLines], ledgerByAccount: new Map(accts.map((a) => [a.id, a.ledger_account])) };
}

export async function getTransaction(companyId: number, id: number): Promise<BankTxOut> {
  const [t] = await sql<BankTxOut[]>`SELECT ${TCOLS()} FROM bank_transactions WHERE id = ${id} AND company_id = ${companyId}`;
  if (!t) throw new NotFoundError('Banktransaktionen');
  return t;
}

/**
 * Stämmer av en banktransaktion:
 *  - invoice:          bokför inbetalning av kundfaktura (bank mot 1510)
 *  - supplier_invoice: bokför betalning av leverantörsfaktura (2440 mot bank), attesterar vid behov
 *  - voucher:          kopplar till en redan bokförd verifikation (ingen ny bokföring)
 *  - account:          bokför mot valfritt konto, med moms om angiven
 *  - ignore:           markeras som hanterad utan bokföring (t.ex. överföring som bokförs på annat sätt)
 */
export async function reconcile(actor: Actor, txId: number, input: Record<string, unknown>): Promise<BankTxOut> {
  const type = str(input, 'type', { required: true, label: 'Typ' });
  await sql.begin(async (tx) => {
    const [t] = await tx<{ id: number; status: string; amount: number; booking_date: string; description: string; counterparty: string; reference: string; bank_account_id: number }[]>`
      SELECT id, status, amount, to_char(booking_date,'YYYY-MM-DD') AS booking_date, description, counterparty, reference, bank_account_id
      FROM bank_transactions WHERE id = ${txId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!t) throw new NotFoundError('Banktransaktionen');
    if (t.status !== 'unmatched') throw new ConflictError('Transaktionen är redan avstämd');
    const a = await ownAccount(tx, actor.companyId, t.bank_account_id);
    let voucherId: number | null = null;
    let matchId: number | null = null;
    let booked: { account: number; vat: number; ruleId: number | null } | null = null;

    if (type === 'invoice') {
      matchId = int(input, 'id', 'Faktura');
      if (t.amount <= 0) throw new ValidationError('Endast insättningar kan matchas mot kundfakturor');
      const inv = await registerPaymentTx(tx, actor, matchId, { date: t.booking_date, amount: t.amount, bank_account: a.ledger_account });
      voucherId = inv.payment_voucher_id;
    } else if (type === 'supplier_invoice') {
      matchId = int(input, 'id', 'Leverantörsfaktura');
      const [si] = await tx<{ total: number }[]>`SELECT total FROM supplier_invoices WHERE id = ${matchId} AND company_id = ${actor.companyId}`;
      if (!si) throw new NotFoundError('Leverantörsfakturan');
      if (si.total !== -t.amount) throw new ValidationError('Beloppet stämmer inte med leverantörsfakturan');
      const out = await paySupplierInvoiceTx(tx, actor, matchId, { date: t.booking_date, bank_account: a.ledger_account }, { autoApprove: true });
      voucherId = out.payment_voucher_id;
    } else if (type === 'voucher') {
      matchId = voucherId = int(input, 'id', 'Verifikation');
      const [v] = await tx<{ amount: number }[]>`
        SELECT COALESCE(SUM(l.debit - l.credit), 0)::bigint AS amount FROM vouchers v JOIN voucher_lines l ON l.voucher_id = v.id
        WHERE v.id = ${voucherId} AND v.company_id = ${actor.companyId} AND l.account_number = ${a.ledger_account}`;
      if (!v || v.amount !== t.amount) throw new ValidationError(`Verifikationen har inte samma belopp på konto ${a.ledger_account}`);
      const used = await tx`SELECT 1 FROM bank_transactions WHERE voucher_id = ${voucherId} AND id <> ${txId}`;
      if (used.length) throw new ConflictError('Verifikationen är redan kopplad till en annan banktransaktion');
    } else if (type === 'account') {
      const account = int(input, 'account', 'Konto');
      const vatRate = optInt(input, 'vat_rate', 'Moms') ?? 0;
      if (![0, 6, 12, 25].includes(vatRate)) throw new ValidationError('Momssats måste vara 0, 6, 12 eller 25');
      const abs = Math.abs(t.amount);
      const net = Math.round((abs * 100) / (100 + vatRate));
      const vat = abs - net;
      const sign = t.amount > 0 ? 1 : -1; // insättning: kredit motkonto/utgående moms; uttag: debet motkonto/ingående moms
      const vatAccount = sign > 0 ? ACC.vatOut[vatRate] : ACC.vatIn;
      const lines = fromSigned([
        { account: a.ledger_account, amount: t.amount },
        { account, amount: -sign * net, costCenterId: dimId(input.cost_center_id), projectId: dimId(input.project_id) },
        ...(vat ? [{ account: vatAccount, amount: -sign * vat }] : []),
      ]);
      const v = await createVoucher(tx, {
        actor, date: t.booking_date, description: str(input, 'description') || t.description || t.counterparty || 'Banktransaktion',
        lines, sourceType: 'bank', sourceId: txId,
      });
      voucherId = v.id;
      const ruleId = optInt(input, 'rule_id', 'Regel') ?? null;
      booked = { account, vat: vatRate, ruleId };
      if (ruleId) await tx`UPDATE bank_rules SET hits = hits + 1, last_used_at = now() WHERE id = ${ruleId} AND company_id = ${actor.companyId}`;
    } else if (type !== 'ignore') {
      throw new ValidationError('Okänd avstämningstyp');
    }

    await tx`UPDATE bank_transactions SET status = ${type === 'ignore' ? 'ignored' : 'matched'}, match_type = ${type}, match_id = ${matchId},
      voucher_id = ${voucherId}, matched_by = ${actor.userId}, matched_at = now(),
      booked_account = ${booked?.account ?? null}, booked_vat = ${booked?.vat ?? null}, rule_id = ${booked?.ruleId ?? null},
      learn_key = ${booked ? learnKey(t as never) : null} WHERE id = ${txId}`;
    await auditBy(tx, actor, 'reconcile', 'bank_transaction', txId, { type, match_id: matchId, voucher_id: voucherId });
    const [out] = await tx<BankTxOut[]>`SELECT ${TCOLS()} FROM bank_transactions WHERE id = ${txId}`;
    await emit(tx, actor.companyId, 'bank.transaction.matched', out);
  });
  return getTransaction(actor.companyId, txId);
}

/** Ångrar en avstämning som inte skapade någon egen bokföring (koppling till verifikation eller ignorerad) */
export async function reopen(actor: Actor, txId: number) {
  const r = await sql`UPDATE bank_transactions SET status = 'unmatched', match_type = NULL, match_id = NULL, voucher_id = NULL, matched_by = NULL, matched_at = NULL
    WHERE id = ${txId} AND company_id = ${actor.companyId} AND (status = 'ignored' OR match_type = 'voucher') RETURNING id`;
  if (!r.length) throw new ConflictError('Endast ignorerade eller kopplade transaktioner kan öppnas igen. Bokförda avstämningar rättas med rättelseverifikation.');
  await auditBy(sql, actor, 'reopen', 'bank_transaction', txId);
  return getTransaction(actor.companyId, txId);
}

/** Bokför transaktioner med kontoförslag. onlyAuto: bara regler markerade som automatiska och bara där ingen faktura kan vara betald. */
export async function bookSuggestions(actor: Actor, opts: { onlyAuto: boolean; ids?: number[] }): Promise<number> {
  const rows = await listTransactions(actor.companyId, { status: 'unmatched', limit: 1000, withSuggestions: true });
  let n = 0;
  for (const r of rows) {
    const a = r.accountSuggestion;
    if (!a || (opts.ids && !opts.ids.includes(r.id))) continue;
    if (opts.onlyAuto && (a.source !== 'rule' || !a.auto || (r.suggestions ?? []).some((s) => s.score >= 80))) continue;
    try {
      await reconcile(actor, r.id, { type: 'account', account: a.account, vat_rate: a.vatRate, description: a.description, rule_id: a.ruleId ?? undefined, cost_center_id: a.costCenterId ?? undefined });
      n++;
    } catch (e) { console.error('bokför förslag', r.id, e); }
  }
  return n;
}

/** Stämmer automatiskt av transaktioner där det finns exakt ett säkert förslag (OCR + belopp) */
export async function autoMatch(actor: Actor): Promise<number> {
  const rows = await listTransactions(actor.companyId, { status: 'unmatched', limit: 1000, withSuggestions: true });
  let n = 0;
  const used = new Set<string>();
  for (const r of rows) {
    const sure = (r.suggestions ?? []).filter((s) => s.score === 100);
    if (sure.length !== 1 || used.has(`${sure[0].type}:${sure[0].id}`)) continue;
    try {
      await reconcile(actor, r.id, { type: sure[0].type, id: sure[0].id });
      used.add(`${sure[0].type}:${sure[0].id}`);
      n++;
    } catch (e) { console.error('automatch', r.id, e); }
  }
  return n + await bookSuggestions(actor, { onlyAuto: true });
}
