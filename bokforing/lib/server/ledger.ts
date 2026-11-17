import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { totals, reverseLines, type Line } from '@/lib/ledger-lines';
import { audit } from './audit';

export class BookkeepingError extends Error {}

export interface FiscalYear { id: number; start_date: string; end_date: string; closed: boolean }

export async function fiscalYears(companyId: number): Promise<FiscalYear[]> {
  return sql<FiscalYear[]>`
    SELECT id, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, closed
    FROM fiscal_years WHERE company_id = ${companyId} ORDER BY start_date DESC`;
}

export async function fiscalYearFor(db: Tx | typeof sql, companyId: number, date: string): Promise<FiscalYear | null> {
  const r = await db<FiscalYear[]>`
    SELECT id, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, closed
    FROM fiscal_years WHERE company_id = ${companyId} AND ${date}::date BETWEEN start_date AND end_date`;
  return r[0] ?? null;
}

export interface VoucherInput {
  companyId: number;
  userId: number;
  date: string;
  description: string;
  lines: Line[];
  series?: string;
  sourceType?: string;
  sourceId?: number | null;
  correctsId?: number | null;
}

/**
 * Bokför en verifikation. Kontrollerar balans, konton, räkenskapsår och periodlås,
 * och tilldelar nästa löpnummer i serien (utan luckor).
 */
export async function createVoucher(tx: Tx, v: VoucherInput): Promise<{ id: number; number: number; series: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) throw new BookkeepingError('Ogiltigt datum');
  if (!v.description.trim()) throw new BookkeepingError('Verifikationstext saknas');
  const lines = v.lines.filter((l) => l.debit !== 0 || l.credit !== 0);
  const t = totals(lines);
  if (!t.balanced) throw new BookkeepingError(`Verifikationen balanserar inte (debet ${t.debit / 100}, kredit ${t.credit / 100})`);
  for (const l of lines) {
    if (l.debit < 0 || l.credit < 0) throw new BookkeepingError('Negativa belopp är inte tillåtna');
    if (!Number.isInteger(l.debit) || !Number.isInteger(l.credit)) throw new BookkeepingError('Belopp måste anges i hela ören');
  }

  const [company] = await tx<{ locked_until: string | null }[]>`
    SELECT to_char(locked_until,'YYYY-MM-DD') AS locked_until FROM companies WHERE id = ${v.companyId} FOR UPDATE`;
  if (company.locked_until && v.date <= company.locked_until) {
    throw new BookkeepingError(`Perioden är låst till och med ${company.locked_until}`);
  }
  const fy = await fiscalYearFor(tx, v.companyId, v.date);
  if (!fy) throw new BookkeepingError(`Inget räkenskapsår omfattar ${v.date}. Lägg upp räkenskapsåret under Inställningar.`);
  if (fy.closed) throw new BookkeepingError('Räkenskapsåret är stängt');

  const numbers = [...new Set(lines.map((l) => l.account))];
  const existing = await tx<{ number: number }[]>`
    SELECT number FROM accounts WHERE company_id = ${v.companyId} AND number IN ${tx(numbers)} AND active`;
  const missing = numbers.filter((n) => !existing.some((e) => e.number === n));
  if (missing.length) throw new BookkeepingError(`Kontot ${missing.join(', ')} finns inte eller är inaktivt i kontoplanen`);

  const series = v.series ?? 'A';
  const [{ next }] = await tx<{ next: number }[]>`
    SELECT COALESCE(MAX(number), 0) + 1 AS next FROM vouchers
    WHERE company_id = ${v.companyId} AND fiscal_year_id = ${fy.id} AND series = ${series}`;
  const [row] = await tx<{ id: number }[]>`
    INSERT INTO vouchers (company_id, fiscal_year_id, series, number, date, description, source_type, source_id, corrects_id, created_by)
    VALUES (${v.companyId}, ${fy.id}, ${series}, ${next}, ${v.date}, ${v.description.trim()}, ${v.sourceType ?? 'manual'},
            ${v.sourceId ?? null}, ${v.correctsId ?? null}, ${v.userId})
    RETURNING id`;
  await tx`INSERT INTO voucher_lines ${tx(
    lines.map((l) => ({ voucher_id: row.id, account_number: l.account, debit: l.debit, credit: l.credit, description: l.description ?? '' })),
  )}`;
  await audit(tx, { companyId: v.companyId, userId: v.userId, action: 'create', entity: 'voucher', entityId: row.id, details: { series, number: next, date: v.date } });
  return { id: row.id, number: next, series };
}

export async function voucherLines(db: Tx | typeof sql, voucherId: number): Promise<Line[]> {
  const rows = await db<{ account_number: number; debit: number; credit: number; description: string }[]>`
    SELECT account_number, debit, credit, description FROM voucher_lines WHERE voucher_id = ${voucherId} ORDER BY id`;
  return rows.map((r) => ({ account: r.account_number, debit: r.debit, credit: r.credit, description: r.description }));
}

/** Rättelseverifikation (BFL 5 kap 5 §): ny verifikation med omvända belopp som hänvisar till originalet. */
export async function reverseVoucher(tx: Tx, companyId: number, userId: number, voucherId: number, date: string, reason: string) {
  const [orig] = await tx<{ id: number; series: string; number: number; description: string }[]>`
    SELECT id, series, number, description FROM vouchers WHERE id = ${voucherId} AND company_id = ${companyId}`;
  if (!orig) throw new BookkeepingError('Verifikationen finns inte');
  const already = await tx`SELECT 1 FROM vouchers WHERE corrects_id = ${voucherId} AND source_type = 'reversal'`;
  if (already.length) throw new BookkeepingError('Verifikationen är redan makulerad med en rättelse');
  const lines = reverseLines(await voucherLines(tx, voucherId));
  return createVoucher(tx, {
    companyId, userId, date,
    description: `Rättelse av ${orig.series}${orig.number}: ${reason || orig.description}`,
    lines, sourceType: 'reversal', correctsId: orig.id,
  });
}

/** Saldo (debet − kredit) per konto för ett datumintervall. */
export async function accountSums(companyId: number, from: string, to: string, opts: { excludeVatSettlements?: boolean } = {}): Promise<Map<number, number>> {
  // Momsavräkningar (och rättelser av dem) exkluderas i momsrapporten så att periodens moms syns även efter avräkning
  const rows = await sql<{ account_number: number; balance: number }[]>`
    SELECT l.account_number, SUM(l.debit - l.credit)::bigint AS balance
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND v.date BETWEEN ${from} AND ${to}
      ${opts.excludeVatSettlements ? sql`AND v.source_type IS DISTINCT FROM 'vat'
        AND NOT (v.source_type = 'reversal' AND EXISTS (SELECT 1 FROM vouchers o WHERE o.id = v.corrects_id AND o.source_type = 'vat'))` : sql``}
    GROUP BY l.account_number`;
  return new Map(rows.map((r) => [r.account_number, r.balance]));
}

/** Balanskontonas ingående saldo vid ett datum = summan av alla tidigare transaktioner. */
export async function openingBalances(companyId: number, before: string): Promise<Map<number, number>> {
  const rows = await sql<{ account_number: number; balance: number }[]>`
    SELECT l.account_number, SUM(l.debit - l.credit)::bigint AS balance
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND v.date < ${before} AND l.account_number < 3000
    GROUP BY l.account_number`;
  // Tidigare års resultat förs till eget kapital (2099 för AB / 2019 för EF) vid årsskiftet
  const result = await sql<{ balance: number }[]>`
    SELECT COALESCE(SUM(l.debit - l.credit), 0)::bigint AS balance
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND v.date < ${before} AND l.account_number >= 3000`;
  const m = new Map(rows.map((r) => [r.account_number, r.balance]));
  if (result[0].balance) {
    const [c] = await sql<{ company_type: string }[]>`SELECT company_type FROM companies WHERE id = ${companyId}`;
    const eq = c.company_type === 'AB' ? 2098 : 2019;
    m.set(eq, (m.get(eq) ?? 0) + result[0].balance);
  }
  return m;
}
