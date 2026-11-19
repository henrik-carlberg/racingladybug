import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import * as eb from '@/lib/bank/enablebanking';
import { creditorAccount, mapPaymentStatus, paymentRequest, type PayItem } from '@/lib/bankpay';
import type { Actor } from './actor';
import { paySupplierInvoiceTx } from './suppliers';
import { reconcile } from './bank';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { hasPermission } from '@/lib/permissions';

type Kind = 'supplier' | 'salary' | 'expense';
export const bankPayEnabled = () => eb.enableBankingConfigured();

async function debtor(companyId: number, accountId: number) {
  const [a] = await sql<{ id: number; iban: string; ledger_account: number; currency: string; aspsp: string | null; country: string | null }[]>`
    SELECT a.id, a.iban, a.ledger_account, a.currency, c.aspsp_name AS aspsp, c.aspsp_country AS country
    FROM bank_accounts a LEFT JOIN bank_connections c ON c.id = a.connection_id WHERE a.id = ${accountId} AND a.company_id = ${companyId}`;
  if (!a) throw new NotFoundError('Bankkontot');
  if (a.currency !== 'SEK') throw new ValidationError('Betalningar görs från ett konto i kronor');
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(a.iban.replace(/\s/g, ''))) throw new ValidationError('Bankkontot saknar IBAN – lägg in det under Bank');
  if (!a.aspsp) throw new ValidationError('Koppla kontot till banken (Open Banking) först, så vet vi vilken bank betalningen ska godkännas i');
  return a;
}

/** Konton som kan betala från (i kronor, med IBAN och känd bank) */
export async function payAccounts(companyId: number) {
  return [...await sql<{ id: number; name: string; ledger_account: number }[]>`SELECT a.id, a.name, a.ledger_account FROM bank_accounts a JOIN bank_connections c ON c.id = a.connection_id
    WHERE a.company_id = ${companyId} AND a.currency = 'SEK' AND a.iban <> '' ORDER BY a.name`];
}

async function start(actor: Actor, o: { kind: Kind; runId?: number; claimId?: number; accountId: number; date: string; items: (PayItem & { supplierInvoiceId?: number; payslipId?: number })[]; origin: string }) {
  if (!bankPayEnabled()) throw new ValidationError('Betalning via banken är inte uppsatt');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new ValidationError('Ogiltigt betaldatum');
  const acc = await debtor(actor.companyId, o.accountId);
  const total = o.items.reduce((s, i) => s + i.amount, 0);
  // Samtidiga betalningar av samma fakturor eller lönekörning: låses per bolag och kontrolleras igen i transaktionen
  const p = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${7_100_000 + actor.companyId})`;
    const inv = o.items.map((i) => i.supplierInvoiceId).filter((x): x is number => !!x);
    const busy = inv.length
      ? await tx`SELECT 1 FROM bank_payment_items bi JOIN bank_payments bp ON bp.id = bi.payment_id WHERE bi.supplier_invoice_id IN ${tx(inv)} AND bp.status IN ('authorization','accepted','executed') LIMIT 1`
      : o.runId ? await tx`SELECT 1 FROM bank_payments WHERE payroll_run_id = ${o.runId} AND status IN ('authorization','accepted','executed') LIMIT 1`
      : o.claimId ? await tx`SELECT 1 FROM bank_payments WHERE expense_claim_id = ${o.claimId} AND status IN ('authorization','accepted','executed')
          UNION ALL SELECT 1 FROM exp_claims WHERE id = ${o.claimId} AND status <> 'approved' LIMIT 1` : [];
    if (busy.length) throw new ConflictError('Betalningen är redan skickad till banken');
    const [row] = await tx<{ id: number }[]>`INSERT INTO bank_payments (company_id, kind, payroll_run_id, expense_claim_id, bank_account_id, status, execution_date, total, created_by)
      VALUES (${actor.companyId}, ${o.kind}, ${o.runId ?? null}, ${o.claimId ?? null}, ${acc.id}, 'authorization', ${o.date}, ${total}, ${actor.userId}) RETURNING id`;
    for (const i of o.items) await tx`INSERT INTO bank_payment_items (payment_id, supplier_invoice_id, payslip_id, name, account, reference, amount)
      VALUES (${row.id}, ${i.supplierInvoiceId ?? null}, ${i.payslipId ?? null}, ${i.name}, ${`${i.account.kind}:${i.account.id}`}, ${i.reference}, ${i.amount})`;
    return row;
  });
  const state = randomBytes(24).toString('base64url');
  await sql`INSERT INTO bank_payment_states (state, payment_id, user_id, expires_at) VALUES (${state}, ${p.id}, ${actor.userId}, now() + interval '30 minutes')`;
  try {
    const r = await eb.createPayment({ aspspName: acc.aspsp!, country: acc.country ?? 'SE', state, redirectUrl: `${o.origin}/bank/betalning`, psuType: 'business',
      request: paymentRequest({ debtorIban: acc.iban, date: o.date, items: o.items }) });
    await sql`UPDATE bank_payments SET external_id = ${r.payment_id} WHERE id = ${p.id}`;
    await auditBy(sql, actor, 'initiate', 'bank_payment', p.id, { kind: o.kind, items: o.items.length, total });
    return { id: p.id, url: r.url };
  } catch (e) {
    await sql`UPDATE bank_payments SET status = 'failed', message = ${e instanceof Error ? e.message.slice(0, 300) : 'Fel'} WHERE id = ${p.id}`;
    throw e;
  }
}

/** Attesterade leverantörsfakturor betalas via banken. Fakturor som redan ligger i en pågående betalning tas inte med igen. */
export async function payInvoices(actor: Actor, ids: number[], accountId: number, date: string, origin: string) {
  if (!ids.length) throw new ValidationError('Välj fakturor att betala');
  const rows = await sql<{ id: number; status: string; open: number; supplier: string; invoice_number: string; reference: string; bankgiro: string; plusgiro: string; bank_account: string; busy: boolean }[]>`
    SELECT i.id, i.status, (i.total - i.paid_amount)::bigint AS open, s.name AS supplier, i.invoice_number, i.payment_reference AS reference, s.bankgiro, s.plusgiro, s.bank_account,
      EXISTS (SELECT 1 FROM bank_payment_items bi JOIN bank_payments bp ON bp.id = bi.payment_id WHERE bi.supplier_invoice_id = i.id AND bp.status IN ('authorization','accepted','executed')) AS busy
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.company_id = ${actor.companyId} AND i.id IN ${sql(ids)}`;
  if (rows.length !== new Set(ids).size) throw new NotFoundError('Leverantörsfakturan');
  const items = rows.map((r) => {
    if (r.status !== 'approved') throw new ConflictError(`Faktura ${r.invoice_number} (${r.supplier}) är inte attesterad`);
    if (r.busy) throw new ConflictError(`Faktura ${r.invoice_number} (${r.supplier}) ligger redan i en betalning`);
    if (Number(r.open) <= 0) throw new ConflictError(`Faktura ${r.invoice_number} är redan betald`);
    const account = creditorAccount({ bankgiro: r.bankgiro, plusgiro: r.plusgiro, account: r.bank_account });
    if (!account) throw new ValidationError(`${r.supplier} saknar bankgiro, plusgiro eller kontonummer`);
    return { name: r.supplier, account, amount: Number(r.open), reference: r.reference || r.invoice_number, endToEnd: `si-${r.id}`, supplierInvoiceId: r.id };
  });
  return start(actor, { kind: 'supplier', accountId, date, items, origin });
}

/** Nettolönerna i en bokförd lönekörning betalas till de anställdas konton */
export async function paySalaries(actor: Actor, runId: number, accountId: number, origin: string) {
  const [run] = await sql<{ status: string; date: string; period: string }[]>`SELECT status, to_char(payment_date,'YYYY-MM-DD') AS date, period FROM payroll_runs WHERE id = ${runId} AND company_id = ${actor.companyId}`;
  if (!run) throw new NotFoundError('Lönekörningen');
  if (run.status !== 'booked') throw new ConflictError('Bokför lönekörningen först');
  const [busy] = await sql`SELECT 1 FROM bank_payments WHERE payroll_run_id = ${runId} AND status IN ('authorization','accepted','executed')`;
  if (busy) throw new ConflictError('Lönerna i körningen är redan skickade till banken');
  const slips = await sql<{ id: number; net: number; name: string; clearing: string; account: string }[]>`
    SELECT p.id, p.net_pay::bigint AS net, e.first_name || ' ' || e.last_name AS name, e.bank_clearing AS clearing, e.bank_account AS account
    FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ${runId} AND p.net_pay > 0`;
  const items = slips.map((s) => {
    const account = creditorAccount({ clearing: s.clearing, account: s.account });
    if (!account) throw new ValidationError(`${s.name} saknar clearing- och kontonummer`);
    return { name: s.name, account, amount: Number(s.net), reference: `Lön ${run.period}`, endToEnd: `lon-${s.id}`, payslipId: s.id };
  });
  const today = new Date().toISOString().slice(0, 10);
  return start(actor, { kind: 'salary', runId, accountId, date: run.date < today ? today : run.date, items, origin });
}

/** En attesterad utläggsräkning betalas till den anställdas konto */
export async function payExpense(actor: Actor, claimId: number, accountId: number, origin: string) {
  const [c] = await sql<{ status: string; title: string; total: number; name: string; clearing: string; account: string }[]>`
    SELECT c.status, c.title, COALESCE((SELECT SUM(amount) FROM exp_lines WHERE claim_id = c.id), 0)::bigint AS total,
      e.first_name || ' ' || e.last_name AS name, e.bank_clearing AS clearing, e.bank_account AS account
    FROM exp_claims c JOIN employees e ON e.id = c.employee_id WHERE c.id = ${claimId} AND c.company_id = ${actor.companyId}`;
  if (!c) throw new NotFoundError('Utläggsräkningen');
  if (c.status !== 'approved') throw new ConflictError('Räkningen är inte attesterad eller redan utbetald');
  if (Number(c.total) <= 0) throw new ValidationError('Inget att betala ut');
  const account = creditorAccount({ clearing: c.clearing, account: c.account });
  if (!account) throw new ValidationError(`${c.name} saknar clearing- och kontonummer`);
  return start(actor, { kind: 'expense', claimId, accountId, date: new Date().toISOString().slice(0, 10), origin,
    items: [{ name: c.name, account, amount: Number(c.total), reference: `Utlägg ${c.title}`.slice(0, 35), endToEnd: `utl-${claimId}` }] });
}

/** Leverantörsfakturorna bokförs som betalda när banken har genomfört betalningen; insättningen/uttaget stäms av mot verifikationerna */
async function apply(actor: Actor, paymentId: number, raw: { status?: string; status_reason?: string }) {
  const st = mapPaymentStatus(raw.status);
  const [p] = await sql<{ status: string; kind: string; date: string; ledger: number; bank_account_id: number; claim: number | null }[]>`
    SELECT p.status, p.kind, to_char(p.execution_date,'YYYY-MM-DD') AS date, a.ledger_account AS ledger, p.bank_account_id, p.expense_claim_id AS claim FROM bank_payments p JOIN bank_accounts a ON a.id = p.bank_account_id WHERE p.id = ${paymentId}`;
  if (!p || p.status === 'executed' || p.status === 'rejected' || p.status === 'failed') return p?.status;
  // Låser betalningen så att två samtidiga statusuppdateringar inte bokför samma faktura två gånger
  const changed = await sql.begin(async (tx) => {
    const [cur] = await tx<{ status: string }[]>`SELECT status FROM bank_payments WHERE id = ${paymentId} FOR UPDATE`;
    if (['executed', 'rejected', 'failed'].includes(cur.status)) return false;
    if (st === 'executed' && p.kind === 'supplier') {
      for (const it of await tx<{ id: number; supplier_invoice_id: number; amount: number }[]>`SELECT id, supplier_invoice_id, amount::bigint AS amount FROM bank_payment_items WHERE payment_id = ${paymentId} AND supplier_invoice_id IS NOT NULL AND voucher_id IS NULL`) {
        await paySupplierInvoiceTx(tx as never, actor, it.supplier_invoice_id, { date: p.date, bank_account: p.ledger, amount: Number(it.amount) });
        await tx`UPDATE bank_payment_items i SET voucher_id = s.payment_voucher_id FROM supplier_invoices s WHERE i.id = ${it.id} AND s.id = ${it.supplier_invoice_id}`;
      }
    }
    if (st === 'executed' && p.kind === 'expense' && p.claim) {
      // Skulden till den anställda regleras mot bankkontot och räkningen blir utbetald
      const [c] = await tx<{ status: string; title: string; employee: string; liability: number }[]>`SELECT c.status, c.title, e.first_name || ' ' || e.last_name AS employee,
          COALESCE((SELECT liability_account FROM exp_settings WHERE company_id = c.company_id), 2820) AS liability
        FROM exp_claims c JOIN employees e ON e.id = c.employee_id WHERE c.id = ${p.claim} FOR UPDATE OF c`;
      const [it] = await tx<{ id: number; amount: number }[]>`SELECT id, amount::bigint AS amount FROM bank_payment_items WHERE payment_id = ${paymentId} AND voucher_id IS NULL`;
      if (c?.status === 'approved' && it) {
        const v = await createVoucher(tx as never, { actor, date: p.date, description: `Utbetalning utlägg ${c.employee}: ${c.title}`, sourceType: 'expense_claim', sourceId: p.claim,
          lines: fromSigned([{ account: c.liability, amount: Number(it.amount) }, { account: p.ledger, amount: -Number(it.amount) }]) });
        await tx`UPDATE exp_claims SET status = 'paid', paid_voucher_id = ${v.id} WHERE id = ${p.claim}`;
        await tx`UPDATE bank_payment_items SET voucher_id = ${v.id} WHERE id = ${it.id}`;
      }
    }
    await tx`UPDATE bank_payments SET status = ${st}, message = ${raw.status_reason ?? ''}, updated_at = now() WHERE id = ${paymentId}`;
    return true;
  });
  if (!changed) return st;
  await auditBy(sql, actor, 'status', 'bank_payment', paymentId, { status: st });
  if (st === 'executed') await matchBank(actor, paymentId).catch((e) => console.error('bankpay match', e));
  return st;
}

/** Kopplar uttagen på bankkontot till betalningarnas verifikationer (samma belopp, några dagars marginal) */
async function matchBank(actor: Actor, paymentId: number) {
  const items = await sql<{ voucher_id: number; amount: number; date: string; account: number }[]>`SELECT i.voucher_id, i.amount::bigint AS amount, to_char(p.execution_date,'YYYY-MM-DD') AS date, p.bank_account_id AS account
    FROM bank_payment_items i JOIN bank_payments p ON p.id = i.payment_id WHERE i.payment_id = ${paymentId} AND i.voucher_id IS NOT NULL`;
  for (const i of items) {
    const [t] = await sql<{ id: number }[]>`SELECT id FROM bank_transactions WHERE bank_account_id = ${i.account} AND status = 'unmatched' AND amount = ${-Number(i.amount)}
      AND booking_date BETWEEN ${i.date}::date - 2 AND ${i.date}::date + 5 ORDER BY abs(booking_date - ${i.date}::date) LIMIT 1`;
    if (t) await reconcile(actor, t.id, { type: 'voucher', id: i.voucher_id }).catch(() => {});
  }
}

/** Banken skickar tillbaka användaren efter godkännandet */
export async function completeAuthorization(userId: number, state: string, error: string | null) {
  // Koden används inte upp direkt: webbläsaren kan hämta adressen två gånger. Statusuppdateringen är idempotent.
  const [s] = await sql<{ payment_id: number; user_id: number; company_id: number; external_id: string | null; kind: string; run: number | null; claim: number | null }[]>`
    SELECT st.payment_id, st.user_id, p.company_id, p.external_id, p.kind, p.payroll_run_id AS run, p.expense_claim_id AS claim FROM bank_payment_states st JOIN bank_payments p ON p.id = st.payment_id
    WHERE st.state = ${state} AND st.expires_at > now()`;
  if (!s) throw new ValidationError('Betalningen har gått ut eller är ogiltig. Försök igen.');
  if (s.user_id !== userId) throw new ForbiddenError('Betalningen startades av en annan användare');
  // Användaren ska fortfarande ha behörighet att betala i bolaget
  const [m] = await sql<{ role: string; permissions: string[] | null }[]>`SELECT role, permissions FROM memberships WHERE user_id = ${userId} AND company_id = ${s.company_id}`;
  if (!m || !hasPermission(m.role, m.permissions, 'payments')) throw new ForbiddenError('Du saknar behörighet att betala i bolaget');
  const actor: Actor = { companyId: s.company_id, userId, apiKeyId: null, role: m.role as Actor['role'] };
  const back = s.kind === 'salary' && s.run ? `/c/${s.company_id}/lon/${s.run}` : s.kind === 'expense' && s.claim ? `/c/${s.company_id}/m/utlagg/r/${s.claim}` : `/c/${s.company_id}/leverantorsfakturor/betalning`;
  await sql`UPDATE bank_payment_states SET expires_at = LEAST(expires_at, now() + interval '5 minutes') WHERE state = ${state}`;
  // Felparametern i adressen kan ändras av vem som helst – finns betalningen hos banken avgör bankens status, aldrig adressen
  if (!s.external_id) {
    await sql`UPDATE bank_payments SET status = 'rejected', message = ${error === 'access_denied' ? 'Avbruten i banken' : 'Avbruten'}, updated_at = now() WHERE id = ${s.payment_id} AND status = 'authorization'`;
    return { back, status: 'rejected' };
  }
  return { back, status: await apply(actor, s.payment_id, await eb.getPayment(s.external_id)) };
}

/** Hämtar status för betalningar som väntar (på begäran och varje natt) */
export async function refreshPayments(companyId?: number, kind?: Kind) {
  const rows = await sql<{ id: number; company_id: number; external_id: string; created_by: number | null }[]>`SELECT id, company_id, external_id, created_by FROM bank_payments
    WHERE status IN ('authorization','accepted') AND external_id IS NOT NULL AND created_at > now() - interval '45 days' ${companyId ? sql`AND company_id = ${companyId}` : sql``} ${kind ? sql`AND kind = ${kind}` : sql``}`;
  let n = 0;
  for (const r of rows) {
    try {
      const actor: Actor = { companyId: r.company_id, userId: r.created_by!, apiKeyId: null, role: 'owner' };
      const before = (await sql<{ s: string }[]>`SELECT status AS s FROM bank_payments WHERE id = ${r.id}`)[0].s;
      if ((await apply(actor, r.id, await eb.getPayment(r.external_id))) !== before) n++;
    } catch (e) { console.error('bankpay status', r.id, e instanceof Error ? e.message : e); }
  }
  return n;
}

export async function listBankPayments(companyId: number, f: { kind?: Kind; runId?: number; claimId?: number } = {}) {
  return [...await sql<{ id: number; kind: string; status: string; message: string; date: string; total: number; items: number; created: string; by: string | null }[]>`
    SELECT p.id, p.kind, p.status, p.message, to_char(p.execution_date,'YYYY-MM-DD') AS date, p.total::float8 AS total, (SELECT count(*)::int FROM bank_payment_items i WHERE i.payment_id = p.id) AS items,
      to_char(p.created_at,'YYYY-MM-DD HH24:MI') AS created, u.name AS by
    FROM bank_payments p LEFT JOIN users u ON u.id = p.created_by WHERE p.company_id = ${companyId}
      ${f.kind ? sql`AND p.kind = ${f.kind}` : sql``} ${f.runId ? sql`AND p.payroll_run_id = ${f.runId}` : sql``} ${f.claimId ? sql`AND p.expense_claim_id = ${f.claimId}` : sql``} ORDER BY p.created_at DESC LIMIT 30`];
}
