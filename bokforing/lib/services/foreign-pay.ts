import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { today } from '@/lib/format';
import { parseAmount } from '@/lib/money';
import { bankChanges } from '@/lib/fraud';
import { BANK_FEE_ACCOUNT, bicValid, chargeBearer, foreignPain001Xml, foreignPaymentError, ibanValid, type ForeignPayment } from '@/lib/foreign-pay';
import type { Actor } from './actor';
import { blockedInvoices, requestBankChange } from './fraud';
import { paySupplierInvoiceTx } from './suppliers';
import { date, optInt, str } from './input';

const compact = (s: string) => s.replace(/\s/g, '').toUpperCase();

/** Leverantörens uppgifter för utlandsbetalning. Nytt IBAN eller BIC kräver godkännande av en annan person (som övriga bankuppgifter). */
export async function setSupplierForeign(actor: Actor, supplierId: number, input: Record<string, unknown>) {
  const iban = compact(str(input, 'iban', { max: 40 }));
  const bic = compact(str(input, 'bic', { max: 11 }));
  if (iban && !ibanValid(iban)) throw new ValidationError('Ogiltigt IBAN – kontrollera kontrollsiffrorna');
  if (bic && !bicValid(bic)) throw new ValidationError('Ogiltig BIC');
  const country = compact(str(input, 'country', { max: 2 })) || iban.slice(0, 2);
  if (country && !/^[A-Z]{2}$/.test(country)) throw new ValidationError('Ange landet som landskod (t.ex. DE)');
  const cb = str(input, 'charge_bearer') === 'OUR' ? 'OUR' : 'SHA';
  return sql.begin(async (tx) => {
    const [cur] = await tx<{ name: string; bankgiro: string; plusgiro: string; bank_account: string; iban: string; bic: string }[]>`
      SELECT name, bankgiro, plusgiro, bank_account, iban, bic FROM suppliers WHERE id = ${supplierId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!cur) throw new NotFoundError('Leverantören');
    const changed = bankChanges(cur, { iban, bic });
    let pending = false;
    if (Object.keys(changed).length) { await requestBankChange(tx, actor, supplierId, cur.name, cur, changed); pending = true; }
    else await tx`UPDATE suppliers SET iban = ${iban}, bic = ${bic} WHERE id = ${supplierId}`;
    await tx`UPDATE suppliers SET country = ${country}, charge_bearer = ${cb}, reg_code = ${str(input, 'reg_code', { max: 10 })} WHERE id = ${supplierId}`;
    await auditBy(tx, actor, 'foreign_details', 'supplier', supplierId, { pending });
    return pending;
  });
}

interface Payable { id: number; supplier_id: number; supplier: string; invoice_number: string; due: string; reference: string; currency: string; total: number; total_currency: number; open: number;
  iban: string; bic: string; country: string; charge_bearer: 'SHA' | 'OUR'; reg_code: string }

async function payables(companyId: number) {
  const rows = await sql<Payable[]>`
    SELECT i.id, s.id AS supplier_id, s.name AS supplier, i.invoice_number, to_char(i.due_date,'YYYY-MM-DD') AS due, i.payment_reference AS reference, i.currency,
      i.total::float8 AS total, i.total_currency::float8 AS total_currency, (i.total - i.paid_amount)::float8 AS open, s.iban, s.bic, s.country, s.charge_bearer, s.reg_code
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id
    WHERE i.company_id = ${companyId} AND i.status = 'approved' AND i.currency <> 'SEK' AND i.total_currency IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM foreign_payments f WHERE f.supplier_invoice_id = i.id AND f.status = 'sent') ORDER BY i.due_date`;
  const blocked = await blockedInvoices(sql, companyId, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, blocked: blocked.has(r.id), amountCurrency: Math.round((r.total_currency * r.open) / r.total) }));
}

async function debtorAccounts(companyId: number) {
  const [c] = await sql<{ name: string; orgnr: string; iban: string; bic: string }[]>`SELECT name, orgnr, iban, bic FROM companies WHERE id = ${companyId}`;
  const accounts = await sql<{ currency: string; iban: string; ledger_account: number }[]>`SELECT currency, iban, ledger_account FROM bank_accounts WHERE company_id = ${companyId} AND active AND iban <> '' ORDER BY id`;
  return { company: c, sek: { currency: 'SEK', iban: c.iban, bic: c.bic }, accounts: accounts.map((a) => ({ currency: a.currency, iban: a.iban, bic: c.bic, ledger: a.ledger_account })) };
}

/** Skapar en betalfil för attesterade fakturor i valuta. Fakturorna markeras som skickade tills banken har avräknat dem. */
export async function createBatch(actor: Actor) {
  const list = (await payables(actor.companyId)).filter((p) => !p.blocked);
  if (!list.length) throw new ValidationError('Det finns inga attesterade fakturor i utländsk valuta att betala');
  const d = await debtorAccounts(actor.companyId);
  if (!ibanValid(d.sek.iban ?? '') && !d.accounts.length) throw new ValidationError('Ange bolagets IBAN under Inställningar (eller ett valutakonto med IBAN under Bank)');
  const t = today();
  const pays: ForeignPayment[] = list.map((p) => ({ id: `UF${p.id}`, name: p.supplier, country: p.country, iban: p.iban, bic: p.bic, currency: p.currency, amount: p.amountCurrency,
    date: p.due < t ? t : p.due, reference: p.reference, chargeBearer: chargeBearer(p.currency, p.iban, p.charge_bearer), regCode: p.reg_code || undefined, invoiceNumber: p.invoice_number }));
  const errors = pays.map(foreignPaymentError).filter((e): e is string => !!e);
  if (errors.length) throw new ValidationError(errors.join('. '));
  const batch = `UB${Date.now()}${randomBytes(2).toString('hex')}`.slice(0, 35);
  await sql.begin(async (tx) => {
    for (const [i, p] of pays.entries()) {
      const acct = d.accounts.find((a) => a.currency === p.currency) ?? d.sek;
      await tx`INSERT INTO foreign_payments ${tx({ company_id: actor.companyId, supplier_invoice_id: list[i].id, batch, currency: p.currency, amount_currency: p.amount, booked_sek: list[i].open,
        charge_bearer: p.chargeBearer, debit_iban: acct.iban, created_by: actor.userId })}`;
    }
    await auditBy(tx, actor, 'foreign_batch', 'company', actor.companyId, { batch, count: pays.length });
  });
  return { batch, count: pays.length };
}

/** Betalfilen för en skapad batch */
export async function batchXml(companyId: number, batch: string) {
  const rows = await sql<(Payable & { amount_currency: number; charge_bearer2: string })[]>`
    SELECT i.id, s.name AS supplier, i.invoice_number, to_char(GREATEST(i.due_date, f.created_at::date),'YYYY-MM-DD') AS due, i.payment_reference AS reference, f.currency,
      f.amount_currency::float8 AS amount_currency, s.iban, s.bic, s.country, f.charge_bearer AS charge_bearer2, s.reg_code
    FROM foreign_payments f JOIN supplier_invoices i ON i.id = f.supplier_invoice_id JOIN suppliers s ON s.id = i.supplier_id
    WHERE f.company_id = ${companyId} AND f.batch = ${batch} AND f.status <> 'cancelled' ORDER BY f.id`;
  if (!rows.length) throw new NotFoundError('Betalfilen');
  const d = await debtorAccounts(companyId);
  return foreignPain001Xml({
    messageId: batch, created: new Date().toISOString().slice(0, 19), debtor: { name: d.company.name, orgnr: d.company.orgnr }, sekAccount: d.sek, accounts: d.accounts,
    payments: rows.map((r) => ({ id: `UF${r.id}`, name: r.supplier, country: r.country, iban: r.iban, bic: r.bic, currency: r.currency, amount: r.amount_currency, date: r.due, reference: r.reference,
      chargeBearer: r.charge_bearer2 as ForeignPayment['chargeBearer'], regCode: r.reg_code || undefined, invoiceNumber: r.invoice_number })),
  });
}

/**
 * Bankens avräkning: dragna kronor reglerar skulden (skillnaden mot bokförd skuld är kursvinst/-förlust) och bankens avgift bokas på 6570.
 */
export async function settle(actor: Actor, paymentId: number, input: Record<string, unknown>) {
  const paid = parseAmount(String(input.paid_sek ?? ''));
  if (paid == null || paid <= 0) throw new ValidationError('Ange dragna kronor enligt bankens avräkning');
  const fee = parseAmount(String(input.fee ?? '').trim() || '0');
  if (fee == null || fee < 0) throw new ValidationError('Ogiltig avgift');
  const d = date(input, 'date', 'Datum');
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Bankkontot ska vara 19xx');
  return sql.begin(async (tx) => {
    const [f] = await tx<{ supplier_invoice_id: number; status: string; currency: string }[]>`SELECT supplier_invoice_id, status, currency FROM foreign_payments WHERE id = ${paymentId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!f) throw new NotFoundError('Betalningen');
    if (f.status !== 'sent') throw new ConflictError('Betalningen är redan avräknad');
    await paySupplierInvoiceTx(tx, actor, f.supplier_invoice_id, { date: d, amount: paid, bank_account: bank });
    if (fee) {
      await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${BANK_FEE_ACCOUNT}, 'Bankkostnader') ON CONFLICT DO NOTHING`;
      await createVoucher(tx, { actor, date: d, description: `Bankavgift utlandsbetalning (${f.currency})`, lines: fromSigned([{ account: BANK_FEE_ACCOUNT, amount: fee }, { account: bank, amount: -fee }]), sourceType: 'supplier_payment', sourceId: f.supplier_invoice_id });
    }
    await tx`UPDATE foreign_payments SET status = 'settled', paid_sek = ${paid}, fee = ${fee}, settled_on = ${d} WHERE id = ${paymentId}`;
    await auditBy(tx, actor, 'foreign_settle', 'supplier_invoice', f.supplier_invoice_id, { paid, fee });
  });
}

export async function cancel(actor: Actor, paymentId: number) {
  const r = await sql`UPDATE foreign_payments SET status = 'cancelled' WHERE id = ${paymentId} AND company_id = ${actor.companyId} AND status = 'sent' RETURNING id`;
  if (!r.length) throw new NotFoundError('Betalningen');
  await auditBy(sql, actor, 'foreign_cancel', 'foreign_payment', paymentId);
}

export async function overview(companyId: number) {
  const suppliers = await sql<{ id: number; name: string; iban: string; bic: string; country: string; charge_bearer: string; reg_code: string }[]>`
    SELECT s.id, s.name, s.iban, s.bic, s.country, s.charge_bearer, s.reg_code FROM suppliers s WHERE s.company_id = ${companyId}
      AND (s.iban <> '' OR EXISTS (SELECT 1 FROM supplier_invoices i WHERE i.supplier_id = s.id AND i.currency <> 'SEK')) ORDER BY s.name`;
  const all = await sql<{ id: number; name: string }[]>`SELECT id, name FROM suppliers WHERE company_id = ${companyId} ORDER BY name`;
  const pending = await sql<{ supplier_id: number }[]>`SELECT supplier_id FROM supplier_bank_changes WHERE company_id = ${companyId} AND status = 'pending'`;
  const payments = await sql<{ id: number; batch: string; supplier: string; invoice_number: string; currency: string; amount_currency: number; booked_sek: number; charge_bearer: string; status: string; paid_sek: number | null; fee: number | null; settled_on: string | null }[]>`
    SELECT f.id, f.batch, s.name AS supplier, i.invoice_number, f.currency, f.amount_currency::float8 AS amount_currency, f.booked_sek::float8 AS booked_sek, f.charge_bearer, f.status,
      f.paid_sek::float8 AS paid_sek, f.fee::float8 AS fee, to_char(f.settled_on,'YYYY-MM-DD') AS settled_on
    FROM foreign_payments f JOIN supplier_invoices i ON i.id = f.supplier_invoice_id JOIN suppliers s ON s.id = i.supplier_id WHERE f.company_id = ${companyId} ORDER BY f.created_at DESC LIMIT 100`;
  const d = await debtorAccounts(companyId);
  return { suppliers, all, pending: new Set(pending.map((p) => p.supplier_id)), payables: await payables(companyId), payments, accounts: d.accounts, sekIban: d.sek.iban };
}
