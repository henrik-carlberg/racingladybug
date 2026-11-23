import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { today } from '@/lib/format';
import { LIABILITY, REVENUE_ADJ, adjustmentLines, liabilityFor, pointStatus, pointsFor, redemptionValue, type PointRow, type Settings } from '@/lib/loyalty';
import type { Actor } from './actor';
import { date, int } from './input';
import { saveDraftTx } from './invoices';

type Db = Tx | typeof sql;
const DEFAULTS: Settings & { start_date: string | null } = { kr_per_point: 10, point_value: 10, redemption_rate: 80, expiry_months: 24, start_date: null };
async function settings(db: Db, companyId: number) {
  const [s] = await db<(Settings & { start_date: string })[]>`SELECT kr_per_point::float8 AS kr_per_point, point_value::float8 AS point_value, redemption_rate, expiry_months, to_char(start_date,'YYYY-MM-DD') AS start_date
    FROM loyalty_settings WHERE company_id = ${companyId}`;
  return s ?? null;
}
const cutoffFor = (d: string, months: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() - months); return x.toISOString().slice(0, 10); };

async function members(db: Db, companyId: number, s: Settings, at: string) {
  const ms = await db<{ customer_id: number; name: string; joined_on: string }[]>`SELECT m.customer_id, c.name, to_char(m.joined_on,'YYYY-MM-DD') AS joined_on FROM loyalty_members m JOIN customers c ON c.id = m.customer_id
    WHERE m.company_id = ${companyId} ORDER BY c.name`;
  const rows = await db<(PointRow & { customer_id: number })[]>`SELECT customer_id, to_char(date,'YYYY-MM-DD') AS date, kind, points FROM loyalty_points WHERE company_id = ${companyId} AND date <= ${at}`;
  const cutoff = cutoffFor(at, s.expiry_months);
  return ms.map((m) => {
    const own = rows.filter((r) => r.customer_id === m.customer_id);
    const st = pointStatus(own, cutoff);
    return { ...m, ...st, earned: own.filter((r) => r.kind === 'earn').reduce((x, r) => x + r.points, 0), redeemed: own.filter((r) => r.kind === 'redeem').reduce((x, r) => x + r.points, 0), expired: own.filter((r) => r.kind === 'expire').reduce((x, r) => x + r.points, 0) };
  });
}

const booked = async (db: Db, companyId: number) => {
  const [{ s }] = await db<{ s: number }[]>`SELECT COALESCE(SUM(l.credit - l.debit), 0)::float8 AS s FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND l.account_number = ${LIABILITY} AND v.source_type = 'loyalty'`;
  return s;
};

export async function overview(companyId: number) {
  const s = await settings(sql, companyId);
  const customers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} AND id NOT IN (SELECT customer_id FROM loyalty_members WHERE company_id = ${companyId}) ORDER BY name LIMIT 500`;
  if (!s) return { settings: null, members: [], customers, outstanding: 0, target: 0, booked: 0, pending: 0 };
  const list = await members(sql, companyId, s, today());
  const outstanding = list.reduce((x, m) => x + m.balance, 0);
  const [{ pending }] = await sql<{ pending: number }[]>`SELECT count(*)::int AS pending FROM invoices i JOIN loyalty_members m ON m.customer_id = i.customer_id AND m.company_id = i.company_id
    WHERE i.company_id = ${companyId} AND i.status IN ('booked','paid') AND i.credit_of_id IS NULL AND i.total_net > 0 AND i.invoice_date >= GREATEST(m.joined_on, ${s.start_date}::date)
      AND NOT EXISTS (SELECT 1 FROM loyalty_points p WHERE p.invoice_id = i.id AND p.kind IN ('earn','redeem'))`;
  return { settings: s, members: list, customers, outstanding, target: liabilityFor(outstanding, s), booked: await booked(sql, companyId), pending };
}

export async function saveSettings(actor: Actor, input: Record<string, unknown>) {
  const num = (k: string, label: string, min: number, max: number) => { const n = Number(String(input[k] ?? '').replace(',', '.')); if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`Ogiltigt värde för ${label}`); return n; };
  const krPer = num('kr_per_point', 'kronor per poäng', 0.01, 100000), value = num('point_value', 'poängens värde', 0.01, 100000) * 100;
  const rate = Math.round(num('redemption_rate', 'förväntad inlösen', 0, 100)), months = Math.round(num('expiry_months', 'giltighetstid', 1, 120));
  const start = date(input, 'start_date', 'Startdatum', false) || today();
  await sql`INSERT INTO loyalty_settings (company_id, kr_per_point, point_value, redemption_rate, expiry_months, start_date) VALUES (${actor.companyId}, ${krPer}, ${value}, ${rate}, ${months}, ${start})
    ON CONFLICT (company_id) DO UPDATE SET kr_per_point = EXCLUDED.kr_per_point, point_value = EXCLUDED.point_value, redemption_rate = EXCLUDED.redemption_rate, expiry_months = EXCLUDED.expiry_months, start_date = EXCLUDED.start_date`;
}

export async function enroll(actor: Actor, input: Record<string, unknown>) {
  const customerId = int(input, 'customer_id', 'Kund');
  const [c] = await sql`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  if (!c) throw new NotFoundError('Kunden');
  const d = date(input, 'joined_on', 'Medlem sedan', false) || today();
  await sql`INSERT INTO loyalty_members (company_id, customer_id, joined_on) VALUES (${actor.companyId}, ${customerId}, ${d}) ON CONFLICT DO NOTHING`;
}

/** Poäng för bokförda fakturor till medlemmar som ännu inte gett poäng (inte inlösenfakturor) */
export async function collect(actor: Actor) {
  return sql.begin(async (tx) => {
    const s = await settings(tx, actor.companyId);
    if (!s) throw new ValidationError('Ställ in programmet först');
    await tx`SELECT company_id FROM loyalty_settings WHERE company_id = ${actor.companyId} FOR UPDATE`;
    const inv = await tx<{ id: number; customer_id: number; date: string; net: number }[]>`SELECT i.id, i.customer_id, to_char(i.invoice_date,'YYYY-MM-DD') AS date, i.total_net::float8 AS net
      FROM invoices i JOIN loyalty_members m ON m.customer_id = i.customer_id AND m.company_id = i.company_id
      WHERE i.company_id = ${actor.companyId} AND i.status IN ('booked','paid') AND i.credit_of_id IS NULL AND i.total_net > 0 AND i.invoice_date >= GREATEST(m.joined_on, ${s.start_date}::date)
        AND NOT EXISTS (SELECT 1 FROM loyalty_points p WHERE p.invoice_id = i.id AND p.kind IN ('earn','redeem'))`;
    let points = 0, count = 0;
    for (const i of inv) {
      const p = pointsFor(i.net, s.kr_per_point);
      if (!p) continue;
      await tx`INSERT INTO loyalty_points ${tx({ company_id: actor.companyId, customer_id: i.customer_id, date: i.date, kind: 'earn', points: p, invoice_id: i.id, created_by: actor.userId })}`;
      points += p; count++;
    }
    return { points, count };
  });
}

/** Inlösen: rabatt som kreditfakturautkast (minskar intäkt och moms) */
export async function redeem(actor: Actor, input: Record<string, unknown>) {
  const customerId = int(input, 'customer_id', 'Kund'), points = int(input, 'points', 'Poäng');
  if (points <= 0) throw new ValidationError('Ange antal poäng');
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const s = await settings(tx, actor.companyId);
    if (!s) throw new ValidationError('Ställ in programmet först');
    await tx`SELECT 1 FROM loyalty_members WHERE company_id = ${actor.companyId} AND customer_id = ${customerId} FOR UPDATE`;
    const m = (await members(tx, actor.companyId, s, d)).find((x) => x.customer_id === customerId);
    if (!m) throw new NotFoundError('Medlemmen');
    if (points > m.balance) throw new ValidationError(`${m.name} har ${m.balance} poäng`);
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${REVENUE_ADJ}, 'Övriga intäktskorrigeringar') ON CONFLICT DO NOTHING`;
    const value = redemptionValue(points, s);
    const vat = Number(input.vat_rate ?? 25);
    const inv = await saveDraftTx(tx, actor, null, { customer_id: customerId, invoice_date: d, notes: `Inlösta bonuspoäng: ${points} poäng.`,
      lines: [{ description: `Inlösta bonuspoäng (${points} p)`, quantity: -1, unit: 'st', unit_price: value, vat_rate: [0, 6, 12, 25].includes(vat) ? vat : 25, account: REVENUE_ADJ }] });
    await tx`INSERT INTO loyalty_points ${tx({ company_id: actor.companyId, customer_id: customerId, date: d, kind: 'redeem', points, invoice_id: inv.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'loyalty_redeem', 'customer', customerId, { points, value });
    return inv.id;
  });
}

/** Poäng äldre än giltighetstiden som inte använts förfaller */
export async function expire(actor: Actor, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const s = await settings(tx, actor.companyId);
    if (!s) throw new ValidationError('Ställ in programmet först');
    await tx`SELECT company_id FROM loyalty_settings WHERE company_id = ${actor.companyId} FOR UPDATE`;
    let total = 0;
    for (const m of await members(tx, actor.companyId, s, d)) {
      if (!m.expiring) continue;
      await tx`INSERT INTO loyalty_points ${tx({ company_id: actor.companyId, customer_id: m.customer_id, date: d, kind: 'expire', points: m.expiring, created_by: actor.userId })}`;
      total += m.expiring;
    }
    return total;
  });
}

/** Skulden för utestående poäng justeras till poängens värde × förväntad inlösen */
export async function accrue(actor: Actor, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const s = await settings(tx, actor.companyId);
    if (!s) throw new ValidationError('Ställ in programmet först');
    await tx`SELECT company_id FROM loyalty_settings WHERE company_id = ${actor.companyId} FOR UPDATE`;
    const outstanding = (await members(tx, actor.companyId, s, d)).reduce((x, m) => x + m.balance, 0);
    const target = liabilityFor(outstanding, s), current = await booked(tx, actor.companyId);
    const change = target - current;
    if (!change) throw new ConflictError('Skulden för bonuspoäng stämmer redan');
    for (const [n, name] of [[LIABILITY, 'Förutbetalda intäkter'], [REVENUE_ADJ, 'Övriga intäktskorrigeringar']] as const) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n}, ${name}) ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: `Skuld för utestående bonuspoäng: ${outstanding} poäng (${s.redemption_rate} % förväntad inlösen)`, lines: fromSigned(adjustmentLines(change)), sourceType: 'loyalty' });
    await tx`INSERT INTO loyalty_accruals ${tx({ company_id: actor.companyId, date: d, liability: target, change, voucher_id: v.id, created_by: actor.userId })}`;
    return { target, change };
  });
}
