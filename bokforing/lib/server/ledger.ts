import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { totals, reverseLines, type Line } from '@/lib/ledger-lines';
import { auditBy } from './audit';
import { emit } from './events';
import type { Actor } from '@/lib/services/actor';

import { BookkeepingError } from '@/lib/errors';
export { BookkeepingError };

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
  actor: Actor;
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
  const companyId = v.actor.companyId;
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
    SELECT to_char(locked_until,'YYYY-MM-DD') AS locked_until FROM companies WHERE id = ${companyId} FOR UPDATE`;
  if (company.locked_until && v.date <= company.locked_until) {
    throw new BookkeepingError(`Perioden är låst till och med ${company.locked_until}`);
  }
  const fy = await fiscalYearFor(tx, companyId, v.date);
  if (!fy) throw new BookkeepingError(`Inget räkenskapsår omfattar ${v.date}. Lägg upp räkenskapsåret under Inställningar.`);
  if (fy.closed) throw new BookkeepingError('Räkenskapsåret är stängt');

  const numbers = [...new Set(lines.map((l) => l.account))];
  const existing = await tx<{ number: number }[]>`
    SELECT number FROM accounts WHERE company_id = ${companyId} AND number IN ${tx(numbers)} AND active`;
  const missing = numbers.filter((n) => !existing.some((e) => e.number === n));
  if (missing.length) throw new BookkeepingError(`Kontot ${missing.join(', ')} finns inte eller är inaktivt i kontoplanen`);

  const series = v.series ?? 'A';
  const [{ next }] = await tx<{ next: number }[]>`
    SELECT COALESCE(MAX(number), 0) + 1 AS next FROM vouchers
    WHERE company_id = ${companyId} AND fiscal_year_id = ${fy.id} AND series = ${series}`;
  const [row] = await tx<{ id: number }[]>`
    INSERT INTO vouchers (company_id, fiscal_year_id, series, number, date, description, source_type, source_id, corrects_id, created_by, api_key_id)
    VALUES (${companyId}, ${fy.id}, ${series}, ${next}, ${v.date}, ${v.description.trim()}, ${v.sourceType ?? 'manual'},
            ${v.sourceId ?? null}, ${v.correctsId ?? null}, ${v.actor.userId}, ${v.actor.apiKeyId})
    RETURNING id`;
  // Kostnadsställen och projekt måste tillhöra bolaget
  const cc = [...new Set(lines.map((l) => l.costCenterId).filter((x): x is number => !!x))];
  if (cc.length && (await tx`SELECT id FROM cost_centers WHERE company_id = ${companyId} AND id IN ${tx(cc)}`).length !== cc.length) throw new BookkeepingError('Okänt kostnadsställe');
  const pr = [...new Set(lines.map((l) => l.projectId).filter((x): x is number => !!x))];
  if (pr.length && (await tx`SELECT id FROM projects WHERE company_id = ${companyId} AND id IN ${tx(pr)}`).length !== pr.length) throw new BookkeepingError('Okänt projekt');
  await tx`INSERT INTO voucher_lines ${tx(
    lines.map((l) => ({ voucher_id: row.id, account_number: l.account, debit: l.debit, credit: l.credit, description: l.description ?? '',
      cost_center_id: l.costCenterId ?? null, project_id: l.projectId ?? null })),
  )}`;
  await auditBy(tx, v.actor, 'create', 'voucher', row.id, { series, number: next, date: v.date });
  await emit(tx, companyId, 'voucher.created', {
    id: row.id, object: 'voucher', series, number: next, date: v.date, description: v.description.trim(),
    source_type: v.sourceType ?? 'manual', source_id: v.sourceId ?? null, corrects_id: v.correctsId ?? null,
    lines: lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, description: l.description ?? '', cost_center_id: l.costCenterId ?? null, project_id: l.projectId ?? null })),
  });
  return { id: row.id, number: next, series };
}

export async function voucherLines(db: Tx | typeof sql, voucherId: number): Promise<Line[]> {
  const rows = await db<{ account_number: number; debit: number; credit: number; description: string; cost_center_id: number | null; project_id: number | null }[]>`
    SELECT account_number, debit, credit, description, cost_center_id, project_id FROM voucher_lines WHERE voucher_id = ${voucherId} ORDER BY id`;
  return rows.map((r) => ({ account: r.account_number, debit: r.debit, credit: r.credit, description: r.description, costCenterId: r.cost_center_id, projectId: r.project_id }));
}

/** Rättelseverifikation (BFL 5 kap 5 §): ny verifikation med omvända belopp som hänvisar till originalet. */
const SUBLEDGER_SOURCES = new Set(['event', 'trade_finance', 'share_instrument', 'booking', 'farming', 'power', 'commission_sale', 'franchise', 'loyalty', 'packaging', 'client_funds', 'cash_pool', 'vehicle_log', 'damage_claim', 'excise', 'dispute_settlement', 'profit_share', 'supplier_prepayment', 'rebate', 'consignment', 'payment_order', 'supplier_credit', 'debt_settlement', 'cash_count', 'ef_pension', 'staff_event', 'gift_card', 'customer_outlay', 'garnishment', 'sponsorship', 'asset_activation', 'forest', 'vmb', 'royalty', 'employee_loan', 'liquidation', 'offset', 'direct_pension', 'foreign_dividend', 'fx_forward', 'business_acquisition', 'board_fee', 'insurance', 'replacement_fund', 'property_sale', 'owner_loan', 'sick_pay_claim', 'merger', 'fou_deduction', 'property_tax', 'production', 'vat_correction', 'bad_debt_undo', 'security_undo', 'provision', 'conversion', 'bad_debt', 'bad_debt_recovery', 'security_trade', 'security_valuation', 'coop_insats', 'coop_refund', 'foundation_grant', 'retention', 'retention_release', 'capital_insurance', 'shareholder_contribution']);

export async function reverseVoucher(tx: Tx, actor: Actor, voucherId: number, date: string, reason: string) {
  const companyId = actor.companyId;
  const [orig] = await tx<{ id: number; series: string; number: number; description: string; source_type: string | null }[]>`
    SELECT id, series, number, description, source_type FROM vouchers WHERE id = ${voucherId} AND company_id = ${companyId}`;
  if (!orig) throw new BookkeepingError('Verifikationen finns inte');
  // Verifikationer som hör till en underreskontra (insatser, återbäring, stiftelsebidrag, innehållna belopp) rättas där –
  // en fristående rättelse skulle göra reskontran och bokföringen osams
  if (orig.source_type && SUBLEDGER_SOURCES.has(orig.source_type)) throw new BookkeepingError('Verifikationen hör till en reskontra (t.ex. kundförluster, insatser, bidrag eller innehållna belopp) och rättas där, inte här');
  // En momsavräkning som redan har rättats får inte makuleras – då skulle rättelsen räknas en gång till vid nästa avräkning
  if (orig.source_type === 'vat') {
    const [c] = await tx`SELECT 1 FROM vat_declarations d JOIN vouchers v ON v.id = ${voucherId}
      WHERE d.company_id = ${companyId} AND d.kind = 'correction' AND d.period_to = v.date LIMIT 1`;
    if (c) throw new BookkeepingError('Momsavräkningen för perioden har rättats och kan inte makuleras – gör en ny rättelse i momsrapporten i stället');
  }
  // En rättelse av en reskontraverifikation får inte heller makuleras fristående (då blir reskontran och bokföringen osams)
  if (orig.source_type === 'reversal') {
    const [o] = await tx<{ source_type: string | null }[]>`SELECT o.source_type FROM vouchers v JOIN vouchers o ON o.id = v.corrects_id WHERE v.id = ${voucherId}`;
    if (o?.source_type && SUBLEDGER_SOURCES.has(o.source_type)) throw new BookkeepingError('Rättelsen hör till en reskontra och kan inte makuleras här');
  }
  // Ett inköp som har aktiverats till anläggningsregistret rättas inte fristående (då finns tillgången kvar utan kostnad)
  const [act] = await tx`SELECT 1 FROM small_asset_reviews WHERE voucher_id = ${voucherId} AND decision = 'activated'`;
  if (act) throw new BookkeepingError('Inköpet är aktiverat i anläggningsregistret – avyttra eller utrangera tillgången i stället');
  const already = await tx`SELECT 1 FROM vouchers WHERE corrects_id = ${voucherId} AND source_type = 'reversal'`;
  if (already.length) throw new BookkeepingError('Verifikationen är redan makulerad med en rättelse');
  const lines = reverseLines(await voucherLines(tx, voucherId));
  return createVoucher(tx, {
    actor, date,
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
      AND v.source_type IS DISTINCT FROM 'opening_balance'
      ${opts.excludeVatSettlements ? sql`AND COALESCE(v.source_type, '') NOT IN ('vat', 'vat_correction')
        AND NOT (v.source_type = 'reversal' AND EXISTS (SELECT 1 FROM vouchers o WHERE o.id = v.corrects_id AND o.source_type IN ('vat', 'vat_correction')))` : sql``}
    GROUP BY l.account_number`;
  return new Map(rows.map((r) => [r.account_number, r.balance]));
}

/**
 * Balanskontonas ingående saldo vid ett datum = summan av alla tidigare transaktioner,
 * plus en verifikation för ingående balanser (source_type 'opening_balance') daterad på dagen.
 * Sådana verifikationer räknas aldrig som rörelser i perioden (se accountSums).
 */
export async function openingBalances(companyId: number, before: string): Promise<Map<number, number>> {
  const rows = await sql<{ account_number: number; balance: number }[]>`
    SELECT l.account_number, SUM(l.debit - l.credit)::bigint AS balance
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND l.account_number < 3000
      AND (v.date < ${before} OR (v.source_type = 'opening_balance' AND v.date = ${before}))
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
