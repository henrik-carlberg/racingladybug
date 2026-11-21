import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { ROYALTY_ACCOUNT, credit, paymentLines, reportLines, royalty } from '@/lib/royalty';
import type { Actor } from './actor';
import { date, str } from './input';

const kronor = (v: unknown, label: string, zero = false) => { const n = parseAmount(String(v ?? '').trim() || (zero ? '0' : '')); if (n == null || n < 0 || (!zero && !n)) throw new ValidationError(`Ange ${label} i kronor`); return n; };
const pct = (v: unknown, label: string, optional = false) => {
  const s = String(v ?? '').trim().replace(',', '.');
  if (optional && !s) return null;
  const n = Number(s); if (!s || !Number.isFinite(n) || n < 0 || n > 100) throw new ValidationError(`Ange ${label} i procent`); return n;
};

export async function overview(companyId: number) {
  const agreements = await sql<{ id: number; licensee: string; country: string; rate: number; minimum: number; treaty_rate: number | null }[]>`SELECT id, licensee, country, rate::float8 AS rate, minimum::float8 AS minimum,
    treaty_rate::float8 AS treaty_rate FROM license_agreements WHERE company_id = ${companyId} ORDER BY licensee`;
  const reports = await sql<{ id: number; agreement_id: number; period: string; date: string; sales: number; amount: number; vat: number; paid_on: string | null; withheld: number }[]>`SELECT id, agreement_id, period,
    to_char(date,'YYYY-MM-DD') AS date, sales::float8 AS sales, amount::float8 AS amount, vat::float8 AS vat, to_char(paid_on,'YYYY-MM-DD') AS paid_on, withheld::float8 AS withheld
    FROM royalty_reports WHERE company_id = ${companyId} ORDER BY date DESC, id DESC`;
  // Avräkning av utländsk skatt per avtal och år
  const credits = agreements.filter((a) => a.country !== 'SE').map((a) => {
    const rs = reports.filter((r) => r.agreement_id === a.id && r.paid_on);
    const gross = rs.reduce((s, r) => s + r.amount, 0), withheld = rs.reduce((s, r) => s + r.withheld, 0);
    return { licensee: a.licensee, country: a.country, gross, withheld, ...credit(gross, withheld, a.treaty_rate) };
  }).filter((c) => c.withheld > 0);
  return { agreements, reports, credits };
}

export async function addAgreement(actor: Actor, input: Record<string, unknown>) {
  const country = str(input, 'country', { required: true, label: 'Land' }).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new ValidationError('Ange land med två bokstäver, t.ex. SE eller DE');
  const [r] = await sql<{ id: number }[]>`INSERT INTO license_agreements ${sql({ company_id: actor.companyId, licensee: str(input, 'licensee', { required: true, label: 'Licenstagare', max: 200 }), country,
    rate: pct(input.rate, 'royaltysatsen'), minimum: kronor(input.minimum, 'minimiavgiften', true), treaty_rate: country === 'SE' ? null : pct(input.treaty_rate, 'avtalssatsen', true), created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'license_agreement', r.id);
}

/** Licenstagarens rapport: royaltyn räknas fram och bokförs som fordran mot licensintäkt (3920) */
export async function report(actor: Actor, agreementId: number, input: Record<string, unknown>) {
  const period = str(input, 'period', { required: true, label: 'Period', max: 20 });
  const d = date(input, 'date', 'Datum');
  const sales = kronor(input.sales, 'försäljningen', true);
  return sql.begin(async (tx) => {
    const [a] = await tx<{ licensee: string; country: string; rate: number; minimum: number }[]>`SELECT licensee, country, rate::float8 AS rate, minimum::float8 AS minimum FROM license_agreements
      WHERE id = ${agreementId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!a) throw new NotFoundError('Licensavtalet');
    const [dup] = await tx`SELECT 1 FROM royalty_reports WHERE agreement_id = ${agreementId} AND period = ${period}`;
    if (dup) throw new ConflictError(`Royalty för ${period} är redan bokförd`);
    const amount = royalty(sales, a.rate, a.minimum);
    if (!amount) throw new ValidationError('Ingen royalty att bokföra för perioden');
    const r = reportLines(amount, a.country === 'SE');
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${ROYALTY_ACCOUNT}, 'Provisionsintäkter, licensintäkter och royalties') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: `Royalty ${period}, ${a.licensee}`, lines: fromSigned(r.lines), sourceType: 'royalty', sourceId: agreementId });
    await tx`INSERT INTO royalty_reports ${tx({ company_id: actor.companyId, agreement_id: agreementId, period, date: d, sales, amount, vat: r.vat, voucher_id: v.id })}`;
    await auditBy(tx, actor, 'royalty_report', 'license_agreement', agreementId, { period, amount });
    return { amount, minimumApplied: amount > Math.round((sales * a.rate) / 100) };
  });
}

/** Inbetalningen, med eventuell utländsk källskatt som licenstagaren har hållit inne */
export async function pay(actor: Actor, reportId: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Betalningsdag');
  const withheld = kronor(input.withheld, 'innehållen källskatt', true);
  return sql.begin(async (tx) => {
    const [r] = await tx<{ amount: number; vat: number; paid_on: string | null; period: string; licensee: string; country: string }[]>`SELECT r.amount::float8 AS amount, r.vat::float8 AS vat, r.paid_on, r.period, a.licensee, a.country
      FROM royalty_reports r JOIN license_agreements a ON a.id = r.agreement_id WHERE r.id = ${reportId} AND r.company_id = ${actor.companyId} FOR UPDATE OF r`;
    if (!r) throw new NotFoundError('Royaltyn');
    if (r.paid_on) throw new ConflictError('Royaltyn är redan betald');
    if (withheld && r.country === 'SE') throw new ValidationError('Källskatt dras bara av utländska licenstagare');
    if (withheld >= r.amount) throw new ValidationError('Källskatten kan inte vara lika stor som royaltyn');
    const total = r.amount + r.vat;
    const v = await createVoucher(tx, { actor, date: d, description: `Inbetald royalty ${r.period}, ${r.licensee}${withheld ? ' (utländsk källskatt avdragen)' : ''}`, lines: fromSigned(paymentLines(total, withheld)), sourceType: 'royalty' });
    await tx`UPDATE royalty_reports SET paid_on = ${d}, withheld = ${withheld}, payment_voucher_id = ${v.id} WHERE id = ${reportId}`;
    await auditBy(tx, actor, 'royalty_paid', 'royalty_report', reportId, { withheld });
    return { net: total - withheld, withheld };
  });
}
