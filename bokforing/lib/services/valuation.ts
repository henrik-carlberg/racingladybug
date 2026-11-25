import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { openingBalances, accountSums } from '@/lib/server/ledger';
import { parseAmount } from '@/lib/money';
import { addDays, today } from '@/lib/format';
import { defaultParams, ibbFor, k10 } from '@/lib/k10';
import { CHECKLIST, average, earningsValue, isGift, multipleValue, saleTax, substanceValue } from '@/lib/valuation';
import type { Actor } from './actor';

type Plan = { ebit_multiple: number; required_return: number; surplus_value: number; transfer_kind: 'sale' | 'gift'; owner_id: number | null; share_pct: number; price: number; recipient: string; qualified: boolean; checklist: string[] };
const DEFAULT: Plan = { ebit_multiple: 5, required_return: 15, surplus_value: 0, transfer_kind: 'sale', owner_id: null, share_pct: 100, price: 0, recipient: '', qualified: true, checklist: [] };

export async function overview(companyId: number) {
  const t = today();
  const [p] = await sql<Plan[]>`SELECT ebit_multiple::float8 AS ebit_multiple, required_return::float8 AS required_return, surplus_value::float8 AS surplus_value, transfer_kind, owner_id, share_pct::float8 AS share_pct,
    price::float8 AS price, recipient, qualified, checklist FROM business_valuations WHERE company_id = ${companyId}`;
  const plan = p ?? DEFAULT;
  const bal = await openingBalances(companyId, addDays(t, 1));
  const sum = (a: number, b: number) => [...bal].filter(([n]) => n >= a && n <= b).reduce((s, [, v]) => s + Number(v), 0);
  const equity = -sum(2000, 2099), untaxedReserves = -sum(2100, 2199), cash = sum(1800, 1999), debt = -sum(2300, 2399);
  const fys = await sql<{ start: string; end: string }[]>`SELECT to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS end FROM fiscal_years WHERE company_id = ${companyId} AND end_date < ${t} ORDER BY end_date DESC LIMIT 3`;
  const periods = fys.length ? fys : [{ start: addDays(t, -364), end: t }];
  const ebits: { label: string; ebit: number }[] = [];
  for (const f of periods) {
    const s = await accountSums(companyId, f.start, f.end);
    ebits.push({ label: fys.length ? `${f.start.slice(0, 4)}${f.start.slice(0, 4) !== f.end.slice(0, 4) ? '/' + f.end.slice(2, 4) : ''}` : 'Senaste 12 månaderna', ebit: -[...s].filter(([n]) => n >= 3000 && n <= 7999).reduce((a, [, v]) => a + Number(v), 0) });
  }
  const avgEbit = average(ebits.map((e) => e.ebit));
  const values = [
    { key: 'substance', label: 'Substansvärde (justerat eget kapital)', value: substanceValue({ equity, untaxedReserves, surplus: plan.surplus_value }) },
    { key: 'earnings', label: `Avkastningsvärde (${plan.required_return.toLocaleString('sv-SE')} % avkastningskrav)`, value: earningsValue(avgEbit, plan.required_return) },
    { key: 'multiple', label: `EBIT × ${plan.ebit_multiple.toLocaleString('sv-SE')} + nettokassa`, value: multipleValue(avgEbit, plan.ebit_multiple, cash - debt) },
  ];
  const owners = await sql<{ id: number; name: string; share_pct: number; cost_basis: number; saved_space: number }[]>`SELECT id, name, share_pct::float8 AS share_pct, cost_basis::float8 AS cost_basis, saved_space::float8 AS saved_space FROM company_owners WHERE company_id = ${companyId} ORDER BY id`;
  const owner = owners.find((o) => o.id === plan.owner_id) ?? null;
  let transfer = null;
  if (owner) {
    const part = Math.min(plan.share_pct, owner.share_pct) / owner.share_pct;
    const costBasis = Math.round(owner.cost_basis * part);
    const year = Number(t.slice(0, 4));
    const limit = Math.round(k10(defaultParams(year), { share: owner.share_pct, costBasis: owner.cost_basis, savedSpace: owner.saved_space, wages: 0, ownSalary: 0, dividends: 0 }).limit * part);
    const gift = isGift(plan.price, costBasis);
    const tax = gift ? null : saleTax({ price: plan.price, costBasis, limit, ibb: ibbFor(year - 1), qualified: plan.qualified });
    const shareValues = values.map((v) => ({ ...v, value: Math.round(v.value * plan.share_pct / 100) }));
    transfer = { owner, costBasis, limit, gift, tax, shareValues, giftTaxedAsSale: plan.transfer_kind === 'gift' && !gift };
  }
  const items = CHECKLIST[plan.transfer_kind];
  return { plan, equity, untaxedReserves, cash, debt, ebits, avgEbit, values, range: [Math.min(...values.map((v) => v.value)), Math.max(...values.map((v) => v.value))], owners, transfer,
    checklist: items.map((i) => ({ ...i, done: plan.checklist.includes(i.key) })) };
}

const num = (v: unknown, label: string, min: number, max: number) => {
  const n = Number(String(v ?? '').replace(',', '.').trim());
  if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`Ogiltigt värde: ${label}`);
  return n;
};

export async function save(actor: Actor, input: Record<string, unknown>) {
  const kind = input.transfer_kind === 'gift' ? 'gift' : 'sale';
  const surplus = String(input.surplus_value ?? '').trim() ? parseAmount(String(input.surplus_value)) : 0;
  const price = String(input.price ?? '').trim() ? parseAmount(String(input.price)) : 0;
  if (surplus == null || price == null || price < 0) throw new ValidationError('Ogiltigt belopp');
  let ownerId: number | null = null;
  if (String(input.owner_id ?? '')) {
    const [o] = await sql<{ id: number }[]>`SELECT id FROM company_owners WHERE id = ${Number(input.owner_id) || 0} AND company_id = ${actor.companyId}`;
    if (!o) throw new NotFoundError('Ägaren');
    ownerId = o.id;
  }
  const row = { company_id: actor.companyId, ebit_multiple: num(input.ebit_multiple, 'EBIT-multipel', 0, 50), required_return: num(input.required_return, 'avkastningskrav', 0.1, 99), surplus_value: surplus,
    transfer_kind: kind, owner_id: ownerId, share_pct: num(input.share_pct || 100, 'andel', 0.001, 100), price, recipient: String(input.recipient ?? '').trim().slice(0, 200), qualified: input.qualified === 'on', updated_by: actor.userId };
  await sql`INSERT INTO business_valuations ${sql(row)} ON CONFLICT (company_id) DO UPDATE SET ebit_multiple = EXCLUDED.ebit_multiple, required_return = EXCLUDED.required_return, surplus_value = EXCLUDED.surplus_value,
    transfer_kind = EXCLUDED.transfer_kind, owner_id = EXCLUDED.owner_id, share_pct = EXCLUDED.share_pct, price = EXCLUDED.price, recipient = EXCLUDED.recipient, qualified = EXCLUDED.qualified, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await auditBy(sql, actor, 'save', 'business_valuation', 0, { kind, price });
}

export async function toggle(actor: Actor, key: string) {
  const valid = new Set([...CHECKLIST.sale, ...CHECKLIST.gift].map((i) => i.key));
  if (!valid.has(key)) throw new ValidationError('Okänd punkt');
  await sql.begin(async (tx) => {
    await tx`INSERT INTO business_valuations (company_id) VALUES (${actor.companyId}) ON CONFLICT DO NOTHING`;
    const [r] = await tx<{ checklist: string[] }[]>`SELECT checklist FROM business_valuations WHERE company_id = ${actor.companyId} FOR UPDATE`;
    const next = r.checklist.includes(key) ? r.checklist.filter((k) => k !== key) : [...r.checklist, key];
    await tx`UPDATE business_valuations SET checklist = ${tx.json(next)}, updated_by = ${actor.userId}, updated_at = now() WHERE company_id = ${actor.companyId}`;
  });
}
