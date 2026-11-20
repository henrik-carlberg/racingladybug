import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { accountSums, createVoucher, fiscalYears, openingBalances, type FiscalYear } from '@/lib/server/ledger';
import { auditBy } from '@/lib/server/audit';
import { fromSigned } from '@/lib/ledger-lines';
import { addDays } from '@/lib/format';
import type { Actor } from './actor';
import { optInt } from './input';
import { bookOpenInvoicesAtYearEnd } from './invoices';
import { bookOpenSupplierInvoicesAtYearEnd } from './suppliers';

export const CORPORATE_TAX_RATE = 20.6; // procent, bolagsskatt (gäller sedan 2021)
/** Konton som normalt inte är avdragsgilla vid inkomstbeskattningen (läggs tillbaka i INK2S) */
export const NON_DEDUCTIBLE = [6072, 6982, 6992, 7623, 8423];

async function fy(companyId: number, fyId: number): Promise<FiscalYear> {
  const y = (await fiscalYears(companyId)).find((x) => x.id === fyId);
  if (!y) throw new NotFoundError('Räkenskapsåret');
  return y;
}

export interface YearStatus {
  fy: FiscalYear;
  companyType: 'AB' | 'EF';
  association: boolean;
  resultBeforeTax: number; // öre, vinst positiv
  taxBooked: number;
  nonDeductible: number;
  suggestedTax: number;
  resultAfterTax: number;
  resultBooked: boolean; // 8999 bokfört
  unreconciledBank: number;
  draftInvoices: number;
  unpaidSupplierInvoicesWithoutApproval: number;
  vatUnsettled: boolean;
  accountingMethod: 'invoice' | 'cash';
  /** Kontantmetoden: obetalda fakturor (kund + leverantör) som ska bokföras per bokslutsdagen */
  cashOpenInvoices: number;
}

export async function yearStatus(companyId: number, fyId: number): Promise<YearStatus> {
  const y = await fy(companyId, fyId);
  const [c] = await sql<{ company_type: 'AB' | 'EF'; accounting_method: 'invoice' | 'cash'; org_form: string | null }[]>`SELECT company_type, accounting_method, org_form FROM companies WHERE id = ${companyId}`;
  const sums = await accountSums(companyId, y.start_date, y.end_date);
  let pl = 0, tax = 0, nonDed = 0;
  for (const [n, v] of sums) {
    if (n >= 3000 && n <= 8989 && !(n >= 8900 && n <= 8989)) pl += v;
    if (n >= 8900 && n <= 8989) tax += v;
    if (NON_DEDUCTIBLE.includes(n)) nonDed += v;
  }
  const resultBeforeTax = -pl; // kreditsaldo = vinst
  const taxable = Math.max(0, resultBeforeTax + nonDed);
  // Skatten avrundas nedåt till hela kronor (approximation – slutlig skatt fastställs i INK2)
  const suggestedTax = c.company_type === 'AB' ? Math.floor((taxable * CORPORATE_TAX_RATE) / 100 / 100) * 100 : 0;
  const [o] = await sql<{ bank: number; drafts: number; si: number; vat: boolean; cash: number }[]>`
    SELECT
      (SELECT count(*) FROM invoices WHERE company_id = ${companyId} AND status = 'booked' AND voucher_id IS NULL AND invoice_date <= ${y.end_date})::int +
      (SELECT count(*) FROM supplier_invoices WHERE company_id = ${companyId} AND status IN ('booked', 'approved') AND voucher_id IS NULL AND invoice_date <= ${y.end_date})::int AS cash,
      (SELECT count(*) FROM bank_transactions WHERE company_id = ${companyId} AND status = 'unmatched' AND booking_date <= ${y.end_date})::int AS bank,
      (SELECT count(*) FROM invoices WHERE company_id = ${companyId} AND status = 'draft' AND invoice_date <= ${y.end_date})::int AS drafts,
      (SELECT count(*) FROM supplier_invoices WHERE company_id = ${companyId} AND status = 'booked' AND invoice_date <= ${y.end_date})::int AS si,
      NOT EXISTS (SELECT 1 FROM vouchers WHERE company_id = ${companyId} AND source_type = 'vat' AND date = ${y.end_date}) AS vat`;
  return {
    fy: y, companyType: c.company_type, association: c.org_form === 'ideell' || c.org_form === 'brf', resultBeforeTax, taxBooked: tax, nonDeductible: nonDed, suggestedTax,
    resultAfterTax: resultBeforeTax - tax, resultBooked: (sums.get(8999) ?? 0) !== 0,
    unreconciledBank: o.bank, draftInvoices: o.drafts, unpaidSupplierInvoicesWithoutApproval: o.si, vatUnsettled: o.vat,
    accountingMethod: c.accounting_method, cashOpenInvoices: o.cash,
  };
}

/** AB: bokför årets beräknade inkomstskatt (8910 mot 2512) på räkenskapsårets sista dag */
export async function bookTax(actor: Actor, fyId: number, input: Record<string, unknown>) {
  const s = await yearStatus(actor.companyId, fyId);
  if (s.companyType !== 'AB') throw new ValidationError('Bolagsskatt bokförs bara för aktiebolag');
  if (s.taxBooked !== 0) throw new ConflictError('Skatt är redan bokförd för året');
  const amount = optInt(input, 'amount', 'Skatt') ?? s.suggestedTax;
  if (amount <= 0) throw new ValidationError('Ingen skatt att bokföra (förlust eller noll)');
  return sql.begin((tx) => createVoucher(tx, {
    actor, date: s.fy.end_date, description: `Beräknad inkomstskatt ${s.fy.start_date.slice(0, 4)}`,
    lines: fromSigned([{ account: 8910, amount }, { account: 2512, amount: -amount }]), sourceType: 'yearend',
  }));
}

/** Kontantmetoden: bokför alla obetalda kund- och leverantörsfakturor per räkenskapsårets sista dag */
export async function bookOpenInvoices(actor: Actor, fyId: number) {
  const s = await yearStatus(actor.companyId, fyId);
  if (!s.cashOpenInvoices) throw new ValidationError('Det finns inga obokförda fakturor');
  if (s.fy.closed) throw new ConflictError('Räkenskapsåret är stängt');
  return sql.begin(async (tx) => {
    const customers = await bookOpenInvoicesAtYearEnd(tx, actor, s.fy.end_date);
    const suppliers = await bookOpenSupplierInvoicesAtYearEnd(tx, actor, s.fy.end_date);
    return { customers, suppliers };
  });
}

/** Bokför årets resultat (8999 mot 2099 för AB, 2019 för EF) och stänger räkenskapsåret */
export async function closeYear(actor: Actor, fyId: number) {
  const s = await yearStatus(actor.companyId, fyId);
  if (s.fy.closed) throw new ConflictError('Räkenskapsåret är redan stängt');
  if (s.resultBooked) throw new ConflictError('Årets resultat är redan bokfört');
  if (s.cashOpenInvoices) throw new ConflictError('Bokför först de obetalda fakturorna per bokslutsdagen (steg 1)');
  const equity = s.association ? 2069 : s.companyType === 'AB' ? 2099 : 2019;
  const res = s.resultAfterTax; // vinst positiv
  return sql.begin(async (tx) => {
    let voucherId: number | null = null;
    if (res !== 0) {
      voucherId = (await createVoucher(tx, {
        actor, date: s.fy.end_date, description: `Årets resultat ${s.fy.start_date.slice(0, 4)}`,
        lines: fromSigned([{ account: 8999, amount: res }, { account: equity, amount: -res }]), sourceType: 'yearend',
      })).id;
    }
    await tx`UPDATE fiscal_years SET closed = true WHERE id = ${fyId}`;
    // Skapa nästa räkenskapsår om det saknas
    const next = addDays(s.fy.end_date, 1);
    const exists = await tx`SELECT 1 FROM fiscal_years WHERE company_id = ${actor.companyId} AND start_date = ${next}`;
    if (!exists.length) {
      const end = addDays(new Date(Date.UTC(Number(next.slice(0, 4)) + 1, Number(next.slice(5, 7)) - 1, 1)).toISOString().slice(0, 10), -1);
      await tx`INSERT INTO fiscal_years (company_id, start_date, end_date) VALUES (${actor.companyId}, ${next}, ${end})`;
    }
    await auditBy(tx, actor, 'close', 'fiscal_year', fyId, { result: res });
    return { voucherId, result: res };
  });
}

/**
 * Nytt år: för över förra årets resultat.
 *  AB – resultatdisposition enligt årsstämman: 2099 → 2091 (balanserad vinst), ev. utdelning → 2898.
 *  EF – årets resultat, egna uttag och insättningar förs till eget kapital (2010).
 */
export async function carryForward(actor: Actor, fyId: number, input: Record<string, unknown>) {
  const y = await fy(actor.companyId, fyId);
  const [c] = await sql<{ company_type: 'AB' | 'EF'; org_form: string | null }[]>`SELECT company_type, org_form FROM companies WHERE id = ${actor.companyId}`;
  const done = await sql`SELECT 1 FROM vouchers WHERE company_id = ${actor.companyId} AND fiscal_year_id = ${fyId} AND source_type = 'carry_forward'
    AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = vouchers.id)`;
  if (done.length) throw new ConflictError('Förra årets resultat är redan överfört');
  const ib = await openingBalances(actor.companyId, y.start_date);
  const entries: { account: number; amount: number }[] = [];
  if (c.org_form === 'ideell' || c.org_form === 'brf') {
    // Förening: årets resultat (2069) balanseras i ny räkning enligt årsmötets beslut
    const v = ib.get(2069) ?? 0;
    if (!v) throw new ValidationError('Det finns inget resultat på 2069 att balansera');
    entries.push({ account: 2069, amount: -v }, { account: 2068, amount: v });
  } else if (c.company_type === 'AB') {
    const result = -(ib.get(2099) ?? 0) - (ib.get(2098) ?? 0); // vinst positiv
    if (result === 0) throw new ValidationError('Det finns inget resultat på 2098/2099 att disponera');
    const dividend = optInt(input, 'dividend', 'Utdelning') ?? 0;
    if (dividend < 0) throw new ValidationError('Ogiltig utdelning');
    for (const n of [2098, 2099]) if (ib.get(n)) entries.push({ account: n, amount: -(ib.get(n) ?? 0) });
    if (dividend) entries.push({ account: 2898, amount: -dividend });
    entries.push({ account: 2091, amount: -(result - dividend) });
  } else {
    let total = 0;
    for (const n of [2013, 2017, 2018, 2019]) {
      const v = ib.get(n) ?? 0;
      if (v) { entries.push({ account: n, amount: -v }); total += v; }
    }
    if (entries.length === 0) throw new ValidationError('Det finns inget att föra över till eget kapital');
    entries.push({ account: 2010, amount: total });
  }
  return sql.begin((tx) => createVoucher(tx, {
    actor, date: y.start_date, description: c.org_form === 'ideell' || c.org_form === 'brf' ? (c.org_form === 'brf' ? 'Resultatdisposition enligt föreningsstämma' : 'Resultatdisposition enligt årsmöte') : c.company_type === 'AB' ? 'Resultatdisposition enligt årsstämma' : 'Överföring till eget kapital',
    lines: fromSigned(entries), sourceType: 'carry_forward',
  }));
}
