import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher, openingBalances } from '@/lib/server/ledger';
import { addDays } from '@/lib/format';
import { FX_ACCOUNTS, revaluationLines, revalue, reverseLines, type FxItem } from '@/lib/fx';
import type { Actor } from './actor';

/** Poster i utländsk valuta per balansdagen: valutakonton i bank, obetalda kundfakturor och leverantörsfakturor */
export async function fxBasis(companyId: number, date: string) {
  const bal = await openingBalances(companyId, addDays(date, 1));
  const banks = await sql<{ id: number; name: string; currency: string; ledger_account: number; balance: number | null; balance_date: string | null; tx_sum: number }[]>`
    SELECT a.id, a.name, a.currency, a.ledger_account, a.balance::float8 AS balance, to_char(a.balance_date,'YYYY-MM-DD') AS balance_date,
      COALESCE((SELECT SUM(t.amount) FROM bank_transactions t WHERE t.bank_account_id = a.id AND t.booking_date <= ${date}), 0)::float8 AS tx_sum
    FROM bank_accounts a WHERE a.company_id = ${companyId} AND a.currency <> 'SEK' ORDER BY a.name`;
  const recv = await sql<{ id: number; number: number; customer: string; currency: string; total: number; total_currency: number; open: number }[]>`
    SELECT i.id, i.invoice_number AS number, c.name AS customer, i.currency, i.total::float8 AS total, i.total_currency::float8 AS total_currency, (i.total - i.paid_amount)::float8 AS open
    FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.company_id = ${companyId} AND i.currency <> 'SEK' AND i.status = 'booked' AND i.invoice_date <= ${date} AND i.total > i.paid_amount AND i.total_currency IS NOT NULL AND i.total <> 0`;
  const pay = await sql<{ id: number; number: string; supplier: string; currency: string; total: number; total_currency: number; open: number }[]>`
    SELECT si.id, si.invoice_number AS number, s.name AS supplier, si.currency, si.total::float8 AS total, si.total_currency::float8 AS total_currency, (si.total - si.paid_amount)::float8 AS open
    FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id
    WHERE si.company_id = ${companyId} AND si.currency <> 'SEK' AND si.status <> 'paid' AND si.invoice_date <= ${date} AND si.total > si.paid_amount AND si.total_currency IS NOT NULL AND si.total <> 0`;
  const items: (FxItem & { ref: string; suggestedAmount?: number })[] = [
    ...banks.map((b) => ({ ref: `bank:${b.id}`, kind: 'bank' as const, label: b.name, account: b.ledger_account, currency: b.currency, amountCurrency: Math.round(b.balance != null && (!b.balance_date || b.balance_date <= date) ? b.balance : b.tx_sum), bookedSek: Number(bal.get(b.ledger_account) ?? 0) })),
    // Obetald del i valuta i proportion till obetald del i kronor
    ...recv.map((r) => ({ ref: `inv:${r.id}`, kind: 'receivable' as const, label: `Faktura ${r.number} ${r.customer}`, account: 1510, currency: r.currency, amountCurrency: Math.round((r.total_currency * r.open) / r.total), bookedSek: r.open })),
    ...pay.map((r) => ({ ref: `si:${r.id}`, kind: 'payable' as const, label: `Leverantörsfaktura ${r.number} ${r.supplier}`, account: 2440, currency: r.currency, amountCurrency: Math.round((r.total_currency * r.open) / r.total), bookedSek: r.open })),
  ];
  const currencies = [...new Set(items.map((i) => i.currency))].sort();
  const [done] = await sql<{ id: number }[]>`SELECT id FROM vouchers WHERE company_id = ${companyId} AND source_type = 'fx_revaluation' AND date = ${date} LIMIT 1`;
  return { items, currencies, booked: done?.id ?? null };
}

const parseRate = (v: string) => Number(String(v ?? '').replace(',', '.').trim());

/** Bokför omvärderingen per balansdagen. Kund- och leverantörsdelen återförs dagen efter. */
export async function bookRevaluation(actor: Actor, date: string, input: Record<string, string>) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError('Ogiltigt datum');
  const basis = await fxBasis(actor.companyId, date);
  if (basis.booked) throw new ConflictError('Omvärderingen per datumet är redan bokförd');
  if (!basis.items.length) throw new ValidationError('Det finns inga poster i utländsk valuta');
  const rates: Record<string, number> = {};
  for (const c of basis.currencies) { const r = parseRate(input[`rate_${c}`]); if (!(r > 0 && r < 100000)) throw new ValidationError(`Ange balansdagens kurs för ${c}`); rates[c] = r; }
  // Bankkontots saldo i valuta kan anges (kontoutdraget) om det skiljer sig från det hämtade
  const items = basis.items.map((i) => { const v = input[`amount_${i.ref.replace(':', '_')}`]; if (i.kind === 'bank' && v != null && v.trim() !== '') { const n = Math.round(parseRate(v) * 100); if (!Number.isFinite(n)) throw new ValidationError('Ogiltigt saldo'); return { ...i, amountCurrency: n }; } return i; });
  const rows = revalue(items, rates);
  const all = revaluationLines(rows);
  const inv = revaluationLines(rows.filter((r) => r.kind !== 'bank'));
  if (!all.length) throw new ValidationError('Inga kursdifferenser att bokföra');
  for (const [n, name] of [[FX_ACCOUNTS.bank, 'Valutakursdifferenser på kortfristiga fordringar och placeringar'], [FX_ACCOUNTS.gain, 'Valutakursvinster på fordringar och skulder av rörelsekaraktär'], [FX_ACCOUNTS.loss, 'Valutakursförluster på fordringar och skulder av rörelsekaraktär']] as const)
    await sql`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n}, ${name}) ON CONFLICT DO NOTHING`;
  for (const b of rows.filter((r) => r.kind === 'bank'))
    await sql`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${b.account}, ${`Bankkonto i ${b.currency}`}) ON CONFLICT DO NOTHING`;
  return sql.begin(async (tx) => {
    const v = await createVoucher(tx, { actor, date, description: `Omvärdering av valuta per ${date} (${Object.entries(rates).map(([c, r]) => `${c} ${r}`).join(', ')})`, lines: all, sourceType: 'fx_revaluation' });
    let reversal: number | null = null;
    if (inv.length) {
      const next = addDays(date, 1);
      const [fy] = await tx`SELECT 1 FROM fiscal_years WHERE company_id = ${actor.companyId} AND ${next} BETWEEN start_date AND end_date`;
      if (fy) reversal = (await createVoucher(tx, { actor, date: next, description: `Återföring av omvärdering per ${date} (kund- och leverantörsfakturor)`, lines: reverseLines(inv), sourceType: 'fx_revaluation_reversal' })).id;
    }
    await auditBy(tx, actor, 'fx_revaluation', 'voucher', v.id, { date, rates });
    return { voucherId: v.id, reversalId: reversal, rows };
  });
}
