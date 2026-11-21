import 'server-only';
import { sql } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { periodOf } from '@/lib/assets';
import { acquisitionLines, allocate, type Item } from '@/lib/business-acquisition';
import type { Actor } from './actor';
import { date, optInt, str } from './input';

/** Tillgångar och skulder som kan tas över, med konto och om de läggs i anläggningsregistret */
export const ASSET_ROWS = [
  { key: 'inventarier', account: 1220, label: 'Inventarier', category: 'inventarier' as const },
  { key: 'maskiner', account: 1210, label: 'Maskiner', category: 'maskiner' as const },
  { key: 'immateriella', account: 1010, label: 'Immateriella tillgångar (t.ex. programvara, varumärke)', category: 'immateriella' as const },
  { key: 'lager', account: 1460, label: 'Varulager', category: null },
];
export const LIABILITY_ROWS = [
  { key: 'semester', account: 2920, label: 'Semesterlöneskuld för personal som följer med' },
  { key: 'forskott', account: 2420, label: 'Förskott från kunder' },
];

const kr = (v: unknown) => { const s = String(v ?? '').trim(); if (!s) return 0; const n = parseAmount(s); if (n == null || n < 0) throw new ValidationError('Ogiltigt belopp'); return n; };

export async function list(companyId: number) {
  return sql<{ id: number; seller: string; date: string; price: number; goodwill: number; voucher_id: number | null }[]>`
    SELECT id, seller, to_char(date,'YYYY-MM-DD') AS date, price::float8 AS price, goodwill::float8 AS goodwill, voucher_id FROM business_acquisitions WHERE company_id = ${companyId} ORDER BY date DESC`;
}

/** Bokför förvärvet och lägger inventarier, immateriella tillgångar och goodwill i anläggningsregistret med avskrivning enligt plan */
export async function acquire(actor: Actor, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Tillträdesdag');
  const price = kr(input.price); if (!price) throw new ValidationError('Ange köpeskillingen');
  const seller = str(input, 'seller', { required: true, label: 'Säljare', max: 200 });
  const payTo = optInt(input, 'pay_to', 'Betalning') ?? 1930;
  if (![1930, 1940, 2440].includes(payTo)) throw new ValidationError('Välj hur köpeskillingen betalas');
  const gwYears = optInt(input, 'goodwill_years', 'Avskrivningstid goodwill') ?? 5;
  if (gwYears < 1 || gwYears > 20) throw new ValidationError('Avskrivningstiden för goodwill ska vara 1–20 år');
  const assets: (Item & { category: string | null; key: string })[] = ASSET_ROWS.map((r) => ({ ...r, amount: kr(input[`a_${r.key}`]) })).filter((i) => i.amount);
  const liabilities: Item[] = LIABILITY_ROWS.map((r) => ({ ...r, amount: kr(input[`l_${r.key}`]) })).filter((i) => i.amount);
  let lines;
  try { lines = acquisitionLines(price, assets, liabilities, payTo); } catch (e) { throw new ValidationError((e as Error).message); }
  const g = allocate(price, assets, liabilities);
  const { ensureAccounts } = await import('./assets');
  const id = await sql.begin(async (tx) => {
    for (const c of ['inventarier', 'maskiner', 'immateriella', 'goodwill'] as const) await ensureAccounts(tx, actor.companyId, c);
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, 1460, 'Lager av handelsvaror'), (${actor.companyId}, 2920, 'Upplupna semesterlöner'), (${actor.companyId}, 2420, 'Förskott från kunder') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: `Förvärv av rörelse från ${seller} (inkråmsköp)`, lines: fromSigned(lines), sourceType: 'business_acquisition' });
    const [r] = await tx<{ id: number }[]>`INSERT INTO business_acquisitions ${tx({ company_id: actor.companyId, seller, date: d, price, items: tx.json({ assets, liabilities } as never) as never, goodwill: g.goodwill,
      agreement: str(input, 'agreement', { max: 2000 }), voucher_id: v.id, created_by: actor.userId })} RETURNING id`;
    const reg = [...assets.filter((a) => a.category).map((a) => ({ category: a.category!, name: `${a.label} från ${seller}`, cost: a.amount, life: 60 })),
      ...(g.goodwill ? [{ category: 'goodwill', name: `Goodwill, förvärv från ${seller}`, cost: g.goodwill, life: gwYears * 12 }] : [])];
    const { ASSET_CATEGORIES } = await import('@/lib/assets');
    for (const a of reg) {
      const cat = ASSET_CATEGORIES[a.category as keyof typeof ASSET_CATEGORIES];
      await tx`INSERT INTO assets ${tx({ company_id: actor.companyId, name: a.name, category: a.category, asset_account: cat.asset, acc_dep_account: cat.accDep, dep_account: cat.dep, acquired_on: d, cost: a.cost, residual: 0,
        life_months: a.life, dep_start: `${periodOf(d)}-01`, source_voucher_id: v.id, notes: 'Inkråmsköp', created_by: actor.userId })}`;
    }
    await auditBy(tx, actor, 'business_acquisition', 'company', actor.companyId, { price, goodwill: g.goodwill });
    return r.id;
  });
  return { id, ...g };
}
