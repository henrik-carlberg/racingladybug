import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher, openingBalances } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { addDays, today } from '@/lib/format';
import { creditUse, factoringLines, paymentLines, schedule, type LoanType } from '@/lib/loans';
import { acceptOffer, factoringConfigured, getOffer, requestOffer } from '@/lib/server/factoring';
import type { Actor } from './actor';
import { date, int, optInt, ore, str } from './input';
import { reconcile } from './bank';
import { registerPaymentTx } from './invoices';

const ownerOf = async (companyId: number): Promise<Actor> => {
  const [m] = await sql<{ user_id: number }[]>`SELECT user_id FROM memberships WHERE company_id = ${companyId} AND role = 'owner' ORDER BY user_id LIMIT 1`;
  return { companyId, userId: m.user_id, apiKeyId: null, role: 'owner' };
};

// ---------- Lån ----------
export async function createLoan(actor: Actor, input: Record<string, unknown>) {
  const name = str(input, 'name', { required: true, label: 'Lån', max: 200 });
  const principal = ore(input, 'principal', 'Lånebelopp', { min: 1 });
  const rate = Number(String(input.rate_pct ?? '').replace(',', '.'));
  if (!Number.isFinite(rate) || rate < 0 || rate >= 100) throw new ValidationError('Ange räntan i procent');
  const type: LoanType = str(input, 'type') === 'annuity' ? 'annuity' : 'straight';
  const months = int(input, 'months', 'Löptid (månader)');
  const first = date(input, 'first_date', 'Första betalning');
  const loanAccount = optInt(input, 'loan_account', 'Lånekonto') ?? 2350;
  if (!(loanAccount >= 2300 && loanAccount <= 2499)) throw new ValidationError('Lånekontot ska vara ett skuldkonto 2300–2499');
  const rows = schedule({ principal, ratePct: rate, firstDate: first, months, type });
  return sql.begin(async (tx) => {
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${loanAccount}, 'Skulder till kreditinstitut'), (${actor.companyId}, 8410, 'Räntekostnader för långfristiga skulder') ON CONFLICT DO NOTHING`;
    const [l] = await tx<{ id: number }[]>`INSERT INTO loans (company_id, name, lender, principal, rate_pct, type, first_date, months, loan_account, created_by)
      VALUES (${actor.companyId}, ${name}, ${str(input, 'lender', { max: 200 })}, ${principal}, ${rate}, ${type}, ${first}, ${months}, ${loanAccount}, ${actor.userId}) RETURNING id`;
    for (const r of rows) await tx`INSERT INTO loan_rows (loan_id, n, date, interest, amortization, balance) VALUES (${l.id}, ${r.n}, ${r.date}, ${r.interest}, ${r.amortization}, ${r.balance})`;
    const disb = date(input, 'disbursed_on', 'Utbetalt', false);
    if (disb) {
      const v = await createVoucher(tx, { actor, date: disb, description: `Utbetalning lån: ${name}`, lines: fromSigned([{ account: 1930, amount: principal }, { account: loanAccount, amount: -principal }]), sourceType: 'loan', sourceId: l.id });
      await tx`UPDATE loans SET disbursement_voucher_id = ${v.id} WHERE id = ${l.id}`;
    }
    await auditBy(tx, actor, 'create', 'loan', l.id, { principal, rate, months, type });
    return l.id;
  });
}

export async function listLoans(companyId: number) {
  const loans = await sql<{ id: number; name: string; lender: string; principal: number; rate_pct: number; type: LoanType; months: number; loan_account: number; balance: number; next_date: string | null; next_payment: number | null; booked: number }[]>`
    SELECT l.id, l.name, l.lender, l.principal::float8 AS principal, l.rate_pct::float8 AS rate_pct, l.type, l.months, l.loan_account,
      COALESCE((SELECT r.balance FROM loan_rows r WHERE r.loan_id = l.id AND r.voucher_id IS NOT NULL ORDER BY r.n DESC LIMIT 1), l.principal)::float8 AS balance,
      (SELECT to_char(r.date,'YYYY-MM-DD') FROM loan_rows r WHERE r.loan_id = l.id AND r.voucher_id IS NULL ORDER BY r.n LIMIT 1) AS next_date,
      (SELECT (r.interest + r.amortization)::float8 FROM loan_rows r WHERE r.loan_id = l.id AND r.voucher_id IS NULL ORDER BY r.n LIMIT 1) AS next_payment,
      (SELECT count(*)::int FROM loan_rows r WHERE r.loan_id = l.id AND r.voucher_id IS NOT NULL) AS booked
    FROM loans l WHERE l.company_id = ${companyId} ORDER BY l.id`;
  // Avstämning: lånens skuld mot saldot på lånekontona i bokföringen
  const ib = await openingBalances(companyId, addDays(today(), 1));
  const accounts = [...new Set(loans.map((l) => l.loan_account))].map((a) => ({ account: a, ledger: -(ib.get(a) ?? 0), loans: loans.filter((l) => l.loan_account === a).reduce((s, l) => s + l.balance, 0) }));
  return { loans: [...loans], reconciliation: accounts };
}

export async function loanRows(companyId: number, loanId: number) {
  const [l] = await sql`SELECT 1 FROM loans WHERE id = ${loanId} AND company_id = ${companyId}`;
  if (!l) throw new NotFoundError('Lånet');
  return [...await sql<{ n: number; date: string; interest: number; amortization: number; balance: number; voucher_id: number | null }[]>`SELECT n, to_char(date,'YYYY-MM-DD') AS date,
    interest::float8 AS interest, amortization::float8 AS amortization, balance::float8 AS balance, voucher_id FROM loan_rows WHERE loan_id = ${loanId} ORDER BY n`];
}

/** Ny ränta från och med nästa obokade betalning: resten av planen räknas om */
export async function changeRate(actor: Actor, loanId: number, raw: string) {
  const rate = Number(raw.replace(',', '.'));
  if (!Number.isFinite(rate) || rate < 0 || rate >= 100) throw new ValidationError('Ange räntan i procent');
  return sql.begin(async (tx) => {
    const [l] = await tx<{ principal: number; type: LoanType; months: number }[]>`SELECT principal::float8 AS principal, type, months FROM loans WHERE id = ${loanId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!l) throw new NotFoundError('Lånet');
    const rows = await tx<{ n: number; date: string; balance: number; voucher_id: number | null }[]>`SELECT n, to_char(date,'YYYY-MM-DD') AS date, balance::float8 AS balance, voucher_id FROM loan_rows WHERE loan_id = ${loanId} ORDER BY n`;
    const firstOpen = rows.find((r) => !r.voucher_id);
    if (!firstOpen) throw new ConflictError('Lånet är slutbetalt');
    const lastBooked = [...rows].reverse().find((r) => r.voucher_id);
    const balance = lastBooked ? lastBooked.balance : l.principal;
    const remaining = rows.filter((r) => !r.voucher_id).length;
    const next = schedule({ principal: balance, ratePct: rate, firstDate: firstOpen.date, months: remaining, type: l.type, startN: firstOpen.n });
    await tx`DELETE FROM loan_rows WHERE loan_id = ${loanId} AND voucher_id IS NULL`;
    for (const r of next) await tx`INSERT INTO loan_rows (loan_id, n, date, interest, amortization, balance) VALUES (${loanId}, ${r.n}, ${r.date}, ${r.interest}, ${r.amortization}, ${r.balance})`;
    await tx`UPDATE loans SET rate_pct = ${rate} WHERE id = ${loanId}`;
    await auditBy(tx, actor, 'rate', 'loan', loanId, { rate });
  });
}

/** Förfallna betalningar bokförs (ränta och amortering mot banken) och stäms av mot banktransaktionen om den finns */
export async function bookDueLoans(companyId?: number) {
  let n = 0;
  const due = await sql<{ loan_id: number; n: number; date: string; interest: number; amortization: number; company_id: number; name: string; loan_account: number; bank_account: number }[]>`
    SELECT r.loan_id, r.n, to_char(r.date,'YYYY-MM-DD') AS date, r.interest::float8 AS interest, r.amortization::float8 AS amortization, l.company_id, l.name, l.loan_account, l.bank_account
    FROM loan_rows r JOIN loans l ON l.id = r.loan_id WHERE r.voucher_id IS NULL AND r.date <= current_date ${companyId ? sql`AND l.company_id = ${companyId}` : sql``} ORDER BY r.date, r.n`;
  for (const d of due) {
    try {
      const actor = await ownerOf(d.company_id);
      const vid = await sql.begin(async (tx: Tx) => {
        const [cur] = await tx<{ voucher_id: number | null }[]>`SELECT voucher_id FROM loan_rows WHERE loan_id = ${d.loan_id} AND n = ${d.n} FOR UPDATE`;
        if (cur.voucher_id) return null;
        const v = await createVoucher(tx, { actor, date: d.date, description: `Lån ${d.name}: betalning ${d.n} (ränta och amortering)`, lines: fromSigned(paymentLines(d, d.loan_account, d.bank_account)), sourceType: 'loan', sourceId: d.loan_id });
        await tx`UPDATE loan_rows SET voucher_id = ${v.id} WHERE loan_id = ${d.loan_id} AND n = ${d.n}`;
        return v.id;
      });
      if (!vid) continue;
      n++;
      const [t] = await sql<{ id: number }[]>`SELECT t.id FROM bank_transactions t JOIN bank_accounts a ON a.id = t.bank_account_id WHERE t.company_id = ${d.company_id} AND a.ledger_account = ${d.bank_account}
        AND t.status = 'unmatched' AND t.amount = ${-(d.interest + d.amortization)} AND t.booking_date BETWEEN ${d.date}::date - 3 AND ${d.date}::date + 5 ORDER BY abs(t.booking_date - ${d.date}::date) LIMIT 1`;
      if (t) await reconcile(actor, t.id, { type: 'voucher', id: vid }).catch(() => {});
    } catch (e) { console.error('lån', d.loan_id, e instanceof Error ? e.message : e); }
  }
  return n;
}

// ---------- Krediter ----------
export async function addCreditLine(actor: Actor, input: Record<string, unknown>) {
  const acc = optInt(input, 'bank_account_id', 'Bankkonto') ?? null;
  if (acc && !(await sql`SELECT 1 FROM bank_accounts WHERE id = ${acc} AND company_id = ${actor.companyId}`).length) throw new NotFoundError('Bankkontot');
  const rate = String(input.rate_pct ?? '').trim() ? Number(String(input.rate_pct).replace(',', '.')) : null;
  await sql`INSERT INTO credit_lines (company_id, name, bank_account_id, credit_limit, rate_pct) VALUES (${actor.companyId}, ${str(input, 'name', { required: true, label: 'Kredit', max: 200 })}, ${acc},
    ${ore(input, 'credit_limit', 'Kreditgräns', { min: 1 })}, ${rate})`;
  await auditBy(sql, actor, 'credit_line', 'company', actor.companyId);
}

export async function creditOverview(companyId: number) {
  const lines = await sql<{ id: number; name: string; credit_limit: number; rate_pct: number | null; ledger: number | null; account: string | null }[]>`SELECT c.id, c.name, c.credit_limit::float8 AS credit_limit,
      c.rate_pct::float8 AS rate_pct, a.ledger_account AS ledger, a.name AS account FROM credit_lines c LEFT JOIN bank_accounts a ON a.id = c.bank_account_id WHERE c.company_id = ${companyId} ORDER BY c.id`;
  const ib = await openingBalances(companyId, addDays(today(), 1));
  return lines.map((l) => ({ ...l, balance: l.ledger ? ib.get(l.ledger) ?? 0 : 0, ...creditUse(l.credit_limit, l.ledger ? ib.get(l.ledger) ?? 0 : 0) }));
}

// ---------- Factoring ----------
export async function factoringCandidates(companyId: number) {
  return [...await sql<{ id: number; number: number; customer: string; due: string; remaining: number; deal: string | null; deal_id: number | null; advance: number | null; fee: number | null; message: string | null }[]>`
    SELECT i.id, i.invoice_number AS number, c.name AS customer, to_char(i.due_date,'YYYY-MM-DD') AS due, (i.total - i.paid_amount)::float8 AS remaining,
      d.status AS deal, d.id AS deal_id, d.advance::float8 AS advance, d.fee::float8 AS fee, d.message
    FROM invoices i JOIN customers c ON c.id = i.customer_id
    LEFT JOIN LATERAL (SELECT * FROM factoring_deals f WHERE f.invoice_id = i.id ORDER BY f.id DESC LIMIT 1) d ON true
    WHERE i.company_id = ${companyId} AND (i.status = 'booked' OR d.status = 'funded') AND i.total > 0 AND i.currency = 'SEK' AND i.credit_of_id IS NULL
    ORDER BY i.due_date LIMIT 100`];
}

/** Begär ett erbjudande från finansiären för en obetald kundfaktura */
export async function offerInvoice(actor: Actor, invoiceId: number) {
  if (!factoringConfigured()) throw new ValidationError('Ingen finansiär är kopplad');
  const [i] = await sql<{ number: number; remaining: number; due: string; ocr: string | null; currency: string; status: string; customer: string; orgnr: string }[]>`SELECT i.invoice_number AS number,
      (i.total - i.paid_amount)::float8 AS remaining, to_char(i.due_date,'YYYY-MM-DD') AS due, i.ocr, i.currency, i.status, c.name AS customer, c.orgnr
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${invoiceId} AND i.company_id = ${actor.companyId}`;
  if (!i) throw new NotFoundError('Fakturan');
  if (i.status !== 'booked' || i.remaining <= 0) throw new ConflictError('Fakturan är inte obetald');
  if ((await sql`SELECT 1 FROM factoring_deals WHERE invoice_id = ${invoiceId} AND status IN ('offered','accepted','funded')`).length) throw new ConflictError('Fakturan har redan ett erbjudande');
  if ((await sql`SELECT 1 FROM invoice_installments WHERE invoice_id = ${invoiceId}`).length || (await sql`SELECT 1 FROM rk_collections WHERE invoice_id = ${invoiceId}`).length)
    throw new ConflictError('Fakturan har delbetalning eller är lämnad till inkasso');
  const [co] = await sql<{ name: string; orgnr: string }[]>`SELECT name, orgnr FROM companies WHERE id = ${actor.companyId}`;
  const o = await requestOffer({ reference: `inv-${invoiceId}`, invoice: { number: i.number, amount: i.remaining, due_date: i.due, ocr: i.ocr, currency: i.currency }, debtor: { name: i.customer, orgnr: i.orgnr }, seller: co });
  const advance = Number.isFinite(o.advance) ? Math.round(o.advance!) : null, fee = Number.isFinite(o.fee) ? Math.round(o.fee!) : null;
  if (o.status === 'rejected') {
    await sql`INSERT INTO factoring_deals (company_id, invoice_id, external_id, status, amount, message, created_by) VALUES (${actor.companyId}, ${invoiceId}, ${o.id}, 'rejected', ${i.remaining}, ${o.message ?? ''}, ${actor.userId})`;
    throw new ValidationError(`Finansiären köper inte fakturan${o.message ? `: ${o.message}` : ''}`);
  }
  if (advance == null || fee == null || advance + fee !== i.remaining || advance <= 0) throw new Error('Finansiärens erbjudande stämmer inte med fakturans belopp');
  await sql`INSERT INTO factoring_deals (company_id, invoice_id, external_id, status, amount, advance, fee, created_by) VALUES (${actor.companyId}, ${invoiceId}, ${o.id}, 'offered', ${i.remaining}, ${advance}, ${fee}, ${actor.userId})`;
  await auditBy(sql, actor, 'factoring_offer', 'invoice', invoiceId, { advance, fee });
  return { advance, fee };
}

export async function acceptDeal(actor: Actor, dealId: number) {
  const [d] = await sql<{ external_id: string; status: string }[]>`SELECT external_id, status FROM factoring_deals WHERE id = ${dealId} AND company_id = ${actor.companyId}`;
  if (!d) throw new NotFoundError('Erbjudandet');
  if (d.status !== 'offered') throw new ConflictError('Erbjudandet är redan hanterat');
  await acceptOffer(d.external_id);
  await sql`UPDATE factoring_deals SET status = 'accepted', updated_at = now() WHERE id = ${dealId} AND status = 'offered'`;
  await auditBy(sql, actor, 'factoring_accept', 'factoring_deal', dealId);
  return refreshDeal(d.external_id);
}

/** Status från finansiären (webhook eller hämtning). Utbetald → kundfakturan är såld: bokförs och markeras betald. */
export async function refreshDeal(externalId: string) {
  const [d] = await sql<{ id: number; company_id: number; invoice_id: number; status: string; amount: number; advance: number; fee: number; created_by: number | null }[]>`
    SELECT id, company_id, invoice_id, status, amount::float8 AS amount, advance::float8 AS advance, fee::float8 AS fee, created_by FROM factoring_deals WHERE external_id = ${externalId}`;
  if (!d) return null;
  if (d.status === 'funded' || d.status === 'rejected' || d.status === 'cancelled') return d.status;
  const o = await getOffer(externalId);
  const st = ['funded', 'rejected', 'cancelled', 'accepted'].includes(o.status) ? o.status : d.status;
  if (st === d.status) return st;
  const owner = await ownerOf(d.company_id);
  const actor: Actor = { ...owner, userId: d.created_by ?? owner.userId };
  await sql.begin(async (tx) => {
    const [cur] = await tx<{ status: string }[]>`SELECT status FROM factoring_deals WHERE id = ${d.id} FOR UPDATE`;
    if (cur.status === 'funded' || cur.status === st) return;
    let voucher: number | null = null;
    if (st === 'funded') {
      if (d.status !== 'accepted') throw new ConflictError('Utbetalning utan accepterat erbjudande');
      await tx`INSERT INTO accounts (company_id, number, name) VALUES (${d.company_id}, 1689, 'Fordran på finansiär (factoring)'), (${d.company_id}, 6064, 'Factoringavgifter') ON CONFLICT DO NOTHING`;
      const [inv] = await tx<{ remaining: number; date: string }[]>`SELECT (total - paid_amount)::float8 AS remaining, to_char(now(),'YYYY-MM-DD') AS date FROM invoices WHERE id = ${d.invoice_id} FOR UPDATE`;
      if (inv.remaining !== d.amount) throw new ConflictError('Fakturans kvarvarande belopp har ändrats');
      await registerPaymentTx(tx, actor, d.invoice_id, { date: inv.date, amount: d.amount, bank_account: 1689 });
      const v = await createVoucher(tx, { actor, date: inv.date, description: `Factoring: utbetalning för faktura (avgift ${(d.fee / 100).toLocaleString('sv-SE')} kr)`, lines: fromSigned(factoringLines({ invoiceAmount: d.amount, advance: d.advance, fee: d.fee })), sourceType: 'factoring', sourceId: d.id });
      voucher = v.id;
    }
    await tx`UPDATE factoring_deals SET status = ${st}, message = ${o.message ?? ''}, voucher_id = COALESCE(${voucher}, voucher_id), updated_at = now() WHERE id = ${d.id}`;
  });
  return st;
}

export async function refreshDeals(companyId?: number) {
  let n = 0;
  for (const d of await sql<{ external_id: string }[]>`SELECT external_id FROM factoring_deals WHERE status IN ('offered','accepted') AND external_id IS NOT NULL ${companyId ? sql`AND company_id = ${companyId}` : sql``}`) {
    try { await refreshDeal(d.external_id); n++; } catch (e) { console.error('factoring', e instanceof Error ? e.message : e); }
  }
  return n;
}
