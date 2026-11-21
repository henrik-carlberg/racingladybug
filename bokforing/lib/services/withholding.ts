import 'server-only';
import { sql } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { DIVIDEND_DEBT, payoutLines, rate, tax, TAX_ACCOUNT } from '@/lib/withholding';
import type { Actor } from './actor';
import { date, str } from './input';

export async function overview(companyId: number) {
  const rows = await sql<{ id: number; recipient: string; country: string; recipient_type: string; date: string; gross: number; pct: number; withheld: number; paid_to_skv: boolean }[]>`
    SELECT id, recipient, country, recipient_type, to_char(date,'YYYY-MM-DD') AS date, gross::float8 AS gross, pct::float8 AS pct, withheld::float8 AS withheld, paid_to_skv FROM foreign_dividends WHERE company_id = ${companyId} ORDER BY date DESC, id DESC`;
  const [d] = await sql<{ b: number }[]>`SELECT COALESCE(-SUM(l.debit - l.credit), 0)::float8 AS b FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND l.account_number = ${DIVIDEND_DEBT}`;
  return { rows, dividendDebt: d.b, unpaidTax: rows.filter((r) => !r.paid_to_skv).reduce((s, r) => s + r.withheld, 0) };
}

/** Utbetalning av beslutad utdelning till utländsk ägare med kupongskatt */
export async function pay(actor: Actor, input: Record<string, unknown>) {
  const country = str(input, 'country').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || country === 'SE') throw new ValidationError('Ange mottagarens hemviststat (inte SE)');
  const type = str(input, 'recipient_type') === 'company' ? 'company' as const : 'person' as const;
  const holding = Number(String(input.holding_pct ?? '0').replace(',', '.') || '0');
  if (!(holding >= 0 && holding <= 100)) throw new ValidationError('Ogiltig ägarandel');
  const tr = String(input.treaty_rate ?? '').trim();
  const treatyRate = tr ? Number(tr.replace(',', '.')) : null;
  if (treatyRate != null && !(treatyRate >= 0 && treatyRate <= 30)) throw new ValidationError('Avtalssatsen ska vara 0–30 %');
  const gross = parseAmount(String(input.gross ?? '')); if (!gross || gross <= 0) throw new ValidationError('Ange utdelningen före skatt');
  const r = rate({ country, type, holdingPct: holding, businessRelated: input.business_related === 'on', treatyRate });
  const withheld = tax(gross, r.pct);
  const d = date(input, 'date', 'Utbetalningsdag', false) || today();
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(126001, ${actor.companyId})`;
    const [b] = await tx<{ b: number }[]>`SELECT COALESCE(-SUM(l.debit - l.credit), 0)::float8 AS b FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${actor.companyId} AND l.account_number = ${DIVIDEND_DEBT}`;
    if (gross > b.b) throw new ValidationError('Utdelningen är större än beslutad, obetald utdelning på 2898 – bokför utdelningsbeslutet först');
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${TAX_ACCOUNT}, 'Utdelningsskatt (kupongskatt)') ON CONFLICT DO NOTHING`;
    const recipient = str(input, 'recipient', { required: true, label: 'Mottagare', max: 200 });
    const v = await createVoucher(tx, { actor, date: d, description: `Utdelning till ${recipient} (${country}), kupongskatt ${r.pct} %`, lines: fromSigned(payoutLines(gross, withheld)), sourceType: 'foreign_dividend' });
    await tx`INSERT INTO foreign_dividends ${tx({ company_id: actor.companyId, recipient, country, recipient_type: type, holding_pct: holding, business_related: input.business_related === 'on', date: d, gross, pct: r.pct, withheld, voucher_id: v.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'foreign_dividend', 'company', actor.companyId, { gross, pct: r.pct });
    return { ...r, withheld, net: gross - withheld };
  });
}

/** Innehållen kupongskatt betalas till Skatteverket */
export async function payTax(actor: Actor) {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(126001, ${actor.companyId})`;
    const rows = await tx<{ id: number; withheld: number }[]>`SELECT id, withheld::float8 AS withheld FROM foreign_dividends WHERE company_id = ${actor.companyId} AND NOT paid_to_skv AND withheld > 0 FOR UPDATE`;
    const total = rows.reduce((s, r) => s + r.withheld, 0);
    if (!total) throw new ValidationError('Det finns ingen innehållen kupongskatt att betala');
    await createVoucher(tx, { actor, date: today(), description: 'Inbetalning av kupongskatt till Skatteverket', lines: fromSigned([{ account: TAX_ACCOUNT, amount: total }, { account: 1930, amount: -total }]), sourceType: 'foreign_dividend' });
    await tx`UPDATE foreign_dividends SET paid_to_skv = true WHERE id IN ${tx(rows.map((r) => r.id))}`;
    await auditBy(tx, actor, 'withholding_paid', 'company', actor.companyId, { total });
    return total;
  });
}
