import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { kr, today } from '@/lib/format';
import { ACCOUNT_NAMES, ENTRY_DEFERRED, FUND, FUND_INCOME, ROYALTY_INCOME, ENTRY_INCOME, fees, fundUseLines, missingPeriods, recognitionLines, recognizedEntry } from '@/lib/franchise';
import type { Actor } from './actor';
import { date, int, str } from './input';
import { saveDraftTx } from './invoices';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const ensure = async (tx: Tx | typeof sql, companyId: number, ns: number[]) => { for (const n of ns) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${n}, ${ACCOUNT_NAMES[n]}) ON CONFLICT DO NOTHING`; };
const pct = (v: unknown, label: string) => { const n = Number(String(v ?? '').trim().replace(',', '.') || '0'); if (!Number.isFinite(n) || n < 0 || n >= 100) throw new ValidationError(`Ange ${label} i procent`); return Math.round(n * 100) / 100; };
const ledger = async (companyId: number, account: number) => {
  const [{ s }] = await sql<{ s: number }[]>`SELECT COALESCE(SUM(l.credit - l.debit), 0)::float8 AS s FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND l.account_number = ${account}`;
  return s;
};

export async function overview(companyId: number) {
  const t = today();
  const list = await sql<{ id: number; customer_id: number; name: string; unit: string; start: string; end: string; entry_fee: number; royalty_pct: number; marketing_pct: number; entry_invoice_id: number | null; entry_status: string | null; entry_recognized: number }[]>`
    SELECT f.id, f.customer_id, c.name, f.unit, to_char(f.start_date,'YYYY-MM-DD') AS start, to_char(f.end_date,'YYYY-MM-DD') AS end, f.entry_fee::float8 AS entry_fee, f.royalty_pct::float8 AS royalty_pct,
      f.marketing_pct::float8 AS marketing_pct, f.entry_invoice_id, i.status AS entry_status, f.entry_recognized::float8 AS entry_recognized
    FROM franchisees f JOIN customers c ON c.id = f.customer_id LEFT JOIN invoices i ON i.id = f.entry_invoice_id WHERE f.company_id = ${companyId} ORDER BY c.name, f.unit`;
  const reports = await sql<{ franchisee_id: number; period: string; turnover: number; royalty: number; marketing: number; invoice_id: number | null }[]>`SELECT r.franchisee_id, r.period, r.turnover::float8 AS turnover, r.royalty::float8 AS royalty, r.marketing::float8 AS marketing, r.invoice_id
    FROM franchise_reports r JOIN franchisees f ON f.id = r.franchisee_id WHERE f.company_id = ${companyId} ORDER BY r.period DESC`;
  const customers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name LIMIT 500`;
  const uses = await sql<{ date: string; amount: number; description: string }[]>`SELECT to_char(date,'YYYY-MM-DD') AS date, amount::float8 AS amount, description FROM franchise_entries WHERE company_id = ${companyId} AND kind = 'fund_use' ORDER BY date DESC LIMIT 20`;
  return {
    customers, uses, fund: await ledger(companyId, FUND), deferred: await ledger(companyId, ENTRY_DEFERRED),
    franchisees: list.map((f) => {
      const own = reports.filter((r) => r.franchisee_id === f.id);
      return { ...f, reports: own.slice(0, 6), turnover12: own.slice(0, 12).reduce((s, r) => s + r.turnover, 0), royalty12: own.slice(0, 12).reduce((s, r) => s + r.royalty + r.marketing, 0),
        missing: missingPeriods(f.start, f.end, own.map((r) => r.period), t), shouldRecognize: f.entry_status && f.entry_status !== 'draft' ? recognizedEntry(f.entry_fee, f.start, f.end, t) : 0 };
    }),
  };
}

/** Nytt franchiseavtal; inträdesavgiften faktureras mot förutbetalda intäkter och periodiseras över avtalstiden */
export async function addFranchisee(actor: Actor, input: Record<string, unknown>) {
  const customerId = int(input, 'customer_id', 'Franchisetagare');
  const start = date(input, 'start_date', 'Avtalet börjar'), end = date(input, 'end_date', 'Avtalet slutar');
  if (end <= start) throw new ValidationError('Avtalet ska sluta efter att det börjar');
  const feeRaw = String(input.entry_fee ?? '').trim();
  const fee = feeRaw ? parseAmount(feeRaw) : 0;
  if (fee == null || fee < 0) throw new ValidationError('Ange inträdesavgiften i kronor');
  return sql.begin(async (tx) => {
    const [c] = await tx<{ name: string }[]>`SELECT name FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
    if (!c) throw new NotFoundError('Kunden');
    let invoiceId: number | null = null;
    const unit = str(input, 'unit', { max: 100 });
    if (fee) {
      await ensure(tx, actor.companyId, [ENTRY_DEFERRED]);
      invoiceId = (await saveDraftTx(tx, actor, null, { customer_id: customerId, invoice_date: start > today() ? today() : start, notes: `Inträdesavgift enligt franchiseavtal ${start}–${end}.`,
        lines: [{ description: `Inträdesavgift franchise${unit ? ` ${unit}` : ''}`, quantity: 1, unit: 'st', unit_price: fee, vat_rate: 25, account: ENTRY_DEFERRED }] })).id;
    }
    try {
      const [f] = await tx<{ id: number }[]>`INSERT INTO franchisees ${tx({ company_id: actor.companyId, customer_id: customerId, unit, start_date: start, end_date: end, entry_fee: fee,
        royalty_pct: pct(input.royalty_pct, 'royaltyn'), marketing_pct: pct(input.marketing_pct, 'marknadsavgiften'), entry_invoice_id: invoiceId, created_by: actor.userId })} RETURNING id`;
      await auditBy(tx, actor, 'franchisee', 'franchisee', f.id, { fee });
      return { id: f.id, invoiceId };
    } catch (e) { if (String((e as Error).message).includes('franchisees_company_id_customer_id_unit_key')) throw new ConflictError('Franchisetagaren har redan ett avtal för enheten'); throw e; }
  });
}

/** Månadsrapport om omsättningen: fakturautkast med royalty (intäkt) och marknadsavgift (till fonden) */
export async function report(actor: Actor, franchiseeId: number, input: Record<string, unknown>) {
  const period = str(input, 'period', { required: true, label: 'Period' });
  if (!PERIOD.test(period)) throw new ValidationError('Ange perioden som ÅÅÅÅ-MM');
  const turnover = parseAmount(String(input.turnover ?? '').trim());
  if (turnover == null || turnover < 0) throw new ValidationError('Ange omsättningen exkl. moms i kronor');
  return sql.begin(async (tx) => {
    const [f] = await tx<{ customer_id: number; unit: string; start: string; end: string; royalty_pct: number; marketing_pct: number }[]>`SELECT customer_id, unit, to_char(start_date,'YYYY-MM') AS start, to_char(end_date,'YYYY-MM') AS end,
      royalty_pct::float8 AS royalty_pct, marketing_pct::float8 AS marketing_pct FROM franchisees WHERE id = ${franchiseeId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!f) throw new NotFoundError('Franchisetagaren');
    if (period < f.start || period > f.end) throw new ValidationError('Perioden ligger utanför avtalet');
    const [done] = await tx`SELECT 1 FROM franchise_reports WHERE franchisee_id = ${franchiseeId} AND period = ${period}`;
    if (done) throw new ConflictError('Perioden är redan rapporterad');
    const x = fees(turnover, f.royalty_pct, f.marketing_pct);
    let invoiceId: number | null = null;
    const lines = [
      ...(x.royalty ? [{ description: `Royalty ${period}: ${f.royalty_pct.toLocaleString('sv-SE')} % av ${kr(turnover)} kr`, quantity: 1, unit: 'st', unit_price: x.royalty, vat_rate: 25, account: ROYALTY_INCOME }] : []),
      ...(x.marketing ? [{ description: `Marknadsavgift ${period}: ${f.marketing_pct.toLocaleString('sv-SE')} % av ${kr(turnover)} kr`, quantity: 1, unit: 'st', unit_price: x.marketing, vat_rate: 25, account: FUND }] : []),
    ];
    if (lines.length) {
      await ensure(tx, actor.companyId, [ROYALTY_INCOME, FUND]);
      invoiceId = (await saveDraftTx(tx, actor, null, { customer_id: f.customer_id, invoice_date: today(), notes: `Franchiseavgifter för ${period}${f.unit ? `, ${f.unit}` : ''} enligt rapporterad omsättning.`, lines })).id;
    }
    await tx`INSERT INTO franchise_reports ${tx({ franchisee_id: franchiseeId, period, turnover, royalty: x.royalty, marketing: x.marketing, invoice_id: invoiceId, created_by: actor.userId })}`;
    return { ...x, invoiceId };
  });
}

/** Inträdesavgifterna intäktsförs linjärt per påbörjad avtalsmånad */
export async function recognize(actor: Actor, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const list = await tx<{ id: number; name: string; start: string; end: string; fee: number; recognized: number }[]>`SELECT f.id, c.name, to_char(f.start_date,'YYYY-MM-DD') AS start, to_char(f.end_date,'YYYY-MM-DD') AS end,
      f.entry_fee::float8 AS fee, f.entry_recognized::float8 AS recognized FROM franchisees f JOIN customers c ON c.id = f.customer_id JOIN invoices i ON i.id = f.entry_invoice_id
      WHERE f.company_id = ${actor.companyId} AND f.entry_fee > 0 AND i.status NOT IN ('draft','credited') FOR UPDATE OF f`;
    let total = 0;
    for (const f of list) {
      const amount = recognizedEntry(f.fee, f.start, f.end, d) - f.recognized;
      if (amount <= 0) continue;
      await tx`UPDATE franchisees SET entry_recognized = entry_recognized + ${amount} WHERE id = ${f.id}`;
      total += amount;
    }
    if (!total) throw new ConflictError('Inträdesavgifterna är redan periodiserade fram till datumet');
    await ensure(tx, actor.companyId, [ENTRY_DEFERRED, ENTRY_INCOME]);
    const v = await createVoucher(tx, { actor, date: d, description: `Periodisering av inträdesavgifter t.o.m. ${d}`, lines: fromSigned(recognitionLines(total)), sourceType: 'franchise' });
    await tx`INSERT INTO franchise_entries ${tx({ company_id: actor.companyId, kind: 'entry_recognition', date: d, amount: total, description: 'Inträdesavgifter', voucher_id: v.id, created_by: actor.userId })}`;
    return total;
  });
}

/** Marknadsföringsfonden används: fondens skuld minskar i takt med de marknadsföringskostnader som fonden bekostar */
export async function useFund(actor: Actor, input: Record<string, unknown>) {
  const amount = parseAmount(String(input.amount ?? '').trim());
  if (amount == null || amount <= 0) throw new ValidationError('Ange beloppet i kronor');
  const d = date(input, 'date', 'Datum');
  const desc = str(input, 'description', { required: true, label: 'Vad fonden bekostar', max: 200 });
  return sql.begin(async (tx) => {
    await tx`SELECT id FROM companies WHERE id = ${actor.companyId} FOR UPDATE`;
    const [{ fund }] = await tx<{ fund: number }[]>`SELECT COALESCE(SUM(l.credit - l.debit), 0)::float8 AS fund FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${actor.companyId} AND l.account_number = ${FUND}`;
    if (amount > fund) throw new ValidationError(`Fonden har ${kr(fund)} kr`);
    await ensure(tx, actor.companyId, [FUND, FUND_INCOME]);
    const v = await createVoucher(tx, { actor, date: d, description: `Marknadsföringsfonden: ${desc}`, lines: fromSigned(fundUseLines(amount)), sourceType: 'franchise' });
    await tx`INSERT INTO franchise_entries ${tx({ company_id: actor.companyId, kind: 'fund_use', date: d, amount, description: desc, voucher_id: v.id, created_by: actor.userId })}`;
    return amount;
  });
}
