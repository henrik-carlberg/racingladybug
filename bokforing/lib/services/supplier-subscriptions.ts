import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { cancelBy, looksRecurring, monthlyCost, nextRenewal, priceChange, unusedCost } from '@/lib/supplier-subscriptions';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';

const PERIODS = [1, 3, 6, 12, 24, 36];

export async function overview(companyId: number) {
  const t = today();
  const subs = await sql<{ id: number; supplier_id: number | null; supplier: string | null; name: string; account: number; cost: number; period_months: number; seats: number; seats_used: number; owner: string; renewal_date: string; notice_days: number; status: string; cancelled_on: string | null; last_net: number | null; last_date: string | null }[]>`
    SELECT s.id, s.supplier_id, sp.name AS supplier, s.name, s.account, s.cost::float8 AS cost, s.period_months, s.seats, s.seats_used, s.owner, to_char(s.renewal_date,'YYYY-MM-DD') AS renewal_date, s.notice_days, s.status, to_char(s.cancelled_on,'YYYY-MM-DD') AS cancelled_on,
      li.net AS last_net, li.d AS last_date
    FROM supplier_subscriptions s LEFT JOIN suppliers sp ON sp.id = s.supplier_id
    LEFT JOIN LATERAL (SELECT (i.total - i.vat)::float8 AS net, to_char(i.invoice_date,'YYYY-MM-DD') AS d FROM supplier_invoices i WHERE i.supplier_id = s.supplier_id AND i.company_id = s.company_id ORDER BY i.invoice_date DESC, i.id DESC LIMIT 1) li ON true
    WHERE s.company_id = ${companyId} ORDER BY s.status, s.name`;
  const list = subs.map((s) => {
    const renewal = nextRenewal(s.renewal_date, s.period_months, t);
    return { ...s, renewal, monthly: monthlyCost(s.cost, s.period_months), unused: unusedCost(s.cost, s.period_months, s.seats, s.seats_used), notice: cancelBy(renewal, s.notice_days, t), priceChange: priceChange(s.cost, s.last_net) };
  });
  const recent = await sql<{ id: number; name: string; m: string; net: number }[]>`SELECT sp.id, sp.name, to_char(i.invoice_date,'YYYY-MM') AS m, (i.total - i.vat)::float8 AS net FROM supplier_invoices i JOIN suppliers sp ON sp.id = i.supplier_id
    WHERE i.company_id = ${companyId} AND i.invoice_date > ${t}::date - 183 AND NOT EXISTS (SELECT 1 FROM supplier_subscriptions s WHERE s.supplier_id = sp.id AND s.company_id = ${companyId})`;
  const bySup = new Map<number, { id: number; name: string; months: string[]; last: number }>();
  for (const r of recent) { const x = bySup.get(r.id) ?? { id: r.id, name: r.name, months: [], last: r.net }; x.months.push(r.m); x.last = r.net; bySup.set(r.id, x); }
  const active = list.filter((s) => s.status === 'active');
  const suppliers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM suppliers WHERE company_id = ${companyId} ORDER BY name LIMIT 500`;
  return {
    subscriptions: list, suppliers,
    suggestions: [...bySup.values()].filter((s) => looksRecurring(s.months)).map((s) => ({ id: s.id, name: s.name, months: new Set(s.months).size, last: s.last })),
    totals: { monthly: active.reduce((a, s) => a + s.monthly, 0), unused: active.reduce((a, s) => a + s.unused, 0) },
  };
}

export async function add(actor: Actor, input: Record<string, unknown>) {
  const cost = parseAmount(String(input.cost ?? '').trim());
  if (cost == null || cost <= 0) throw new ValidationError('Ange kostnaden exkl. moms');
  const period = int(input, 'period_months', 'Period');
  if (!PERIODS.includes(period)) throw new ValidationError('Ogiltig period');
  const supplierId = optInt(input, 'supplier_id');
  if (supplierId) { const [s] = await sql`SELECT 1 FROM suppliers WHERE id = ${supplierId} AND company_id = ${actor.companyId}`; if (!s) throw new NotFoundError('Leverantören'); }
  const seats = optInt(input, 'seats') ?? 1, used = optInt(input, 'seats_used') ?? seats;
  if (seats < 1 || seats > 100000 || used < 0 || used > seats) throw new ValidationError('Antalet använda licenser kan inte vara fler än licenserna');
  const notice = optInt(input, 'notice_days') ?? 30;
  if (notice < 0 || notice > 365) throw new ValidationError('Uppsägningstiden ska vara 0–365 dagar');
  const account = optInt(input, 'account') ?? 5420;
  if (account < 4000 || account > 7999) throw new ValidationError('Kostnadskontot ska vara i klass 4–7');
  const [r] = await sql<{ id: number }[]>`INSERT INTO supplier_subscriptions ${sql({ company_id: actor.companyId, supplier_id: supplierId ?? null, name: str(input, 'name', { required: true, label: 'Tjänst', max: 100 }), account, cost, period_months: period,
    seats, seats_used: used, owner: str(input, 'owner', { max: 100 }), renewal_date: date(input, 'renewal_date', 'Förnyas'), notice_days: notice, created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'supplier_subscription', 'supplier_subscription', r.id, { cost, period });
  return r.id;
}

export async function setSeats(actor: Actor, id: number, input: Record<string, unknown>) {
  const seats = int(input, 'seats', 'Licenser'), used = int(input, 'seats_used', 'Använda');
  if (seats < 1 || used < 0 || used > seats) throw new ValidationError('Antalet använda licenser kan inte vara fler än licenserna');
  const r = await sql`UPDATE supplier_subscriptions SET seats = ${seats}, seats_used = ${used} WHERE id = ${id} AND company_id = ${actor.companyId} AND status = 'active'`;
  if (!r.count) throw new NotFoundError('Abonnemanget');
}

export async function cancel(actor: Actor, id: number) {
  const [s] = await sql<{ status: string; renewal_date: string; period_months: number; notice_days: number }[]>`SELECT status, to_char(renewal_date,'YYYY-MM-DD') AS renewal_date, period_months, notice_days FROM supplier_subscriptions WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!s) throw new NotFoundError('Abonnemanget');
  if (s.status === 'cancelled') throw new ConflictError('Abonnemanget är redan uppsagt');
  const t = today();
  let renewal = nextRenewal(s.renewal_date, s.period_months, t);
  // Missad uppsägningstid: abonnemanget löper en period till
  if (cancelBy(renewal, s.notice_days, t).missed) renewal = nextRenewal(renewal, s.period_months, new Date(Date.parse(renewal) + 864e5).toISOString().slice(0, 10));
  await sql`UPDATE supplier_subscriptions SET status = 'cancelled', cancelled_on = ${t}, renewal_date = ${renewal} WHERE id = ${id}`;
  await auditBy(sql, actor, 'supplier_subscription_cancelled', 'supplier_subscription', id, { ends: renewal });
  return renewal;
}
