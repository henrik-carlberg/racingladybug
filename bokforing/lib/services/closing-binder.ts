import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, fiscalYears, openingBalances } from '@/lib/server/ledger';
import { addDays, today } from '@/lib/format';
import { parseAmount } from '@/lib/money';
import { textPdf } from '@/lib/simple-pdf';
import { binderPdf, binderRows, sections, type Item, type Spec } from '@/lib/closing-binder';
import { openItems } from './audit-work';
import type { Actor } from './actor';
import { str } from './input';

async function fy(companyId: number, fyId: number) {
  const f = (await fiscalYears(companyId)).find((y) => y.id === fyId);
  if (!f) throw new NotFoundError('Räkenskapsåret');
  return f;
}

/** Automatiska specifikationer ur reskontror och register per balansdagen */
async function autoSpecs(companyId: number, end: string): Promise<Map<number, Spec>> {
  const m = new Map<number, Spec>();
  const cust = await openItems(companyId, 'customer', end);
  m.set(1510, { amount: cust.reduce((s, i) => s + i.open, 0), source: `Kundreskontra: ${cust.length} öppna fakturor` });
  const supp = await openItems(companyId, 'supplier', end);
  m.set(2440, { amount: -supp.reduce((s, i) => s + i.open, 0), source: `Leverantörsreskontra: ${supp.length} obetalda fakturor` });
  // Anläggningsregistret: anskaffningsvärden och ackumulerade avskrivningar per konto
  const assets = await sql<{ asset_account: number; acc_dep_account: number; cost: number; dep: number }[]>`
    SELECT a.asset_account, a.acc_dep_account, a.cost::float8 AS cost,
      COALESCE((SELECT SUM(d.amount) FROM asset_depreciations d WHERE d.asset_id = a.id AND d.period <= ${end.slice(0, 7)}), 0)::float8 AS dep
    FROM assets a WHERE a.company_id = ${companyId} AND a.acquired_on <= ${end} AND (a.disposed_on IS NULL OR a.disposed_on > ${end})`;
  for (const a of assets) {
    const c = m.get(a.asset_account), d = m.get(a.acc_dep_account);
    m.set(a.asset_account, { amount: (c?.amount ?? 0) + a.cost, source: 'Anläggningsregistret (anskaffningsvärde)' });
    m.set(a.acc_dep_account, { amount: (d?.amount ?? 0) - a.dep, source: 'Anläggningsregistret (ackumulerade avskrivningar)' });
  }
  // Lager enligt lagervärderingen per balansdagen
  try {
    const [on] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM inv_products WHERE company_id = ${companyId}`;
    if (on?.n) {
      const { valuation } = await import('@/modules/lager/service');
      const [h] = await sql<{ rule: string }[]>`SELECT rule FROM inv_valuations WHERE company_id = ${companyId} AND date <= ${end} ORDER BY date DESC, id DESC LIMIT 1`;
      const v = await valuation(companyId, end, (h?.rule as 'cost' | 'lvp' | '97') ?? 'cost');
      m.set(1460, { amount: v.book, source: `Lagervärdering per ${end}` });
    }
  } catch { /* lagermodulen används inte */ }
  return m;
}

export async function binder(companyId: number, fyId: number) {
  const f = await fy(companyId, fyId);
  const bal = await openingBalances(companyId, addDays(f.end_date, 1));
  const balances = new Map([...bal].map(([k, v]) => [k, Number(v)]));
  const names = new Map((await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${companyId}`).map((a) => [a.number, a.name]));
  const items = new Map((await sql<(Item & { account: number })[]>`
    SELECT i.account, i.amount::float8 AS amount, i.note, i.reference, i.done, u.name AS signed_by, to_char(i.signed_at,'YYYY-MM-DD') AS signed_at
    FROM closing_binder_items i LEFT JOIN users u ON u.id = i.signed_by WHERE i.company_id = ${companyId} AND i.fiscal_year_id = ${fyId}`).map((i) => [i.account, i]));
  const rows = binderRows(balances, names, await autoSpecs(companyId, f.end_date), items);
  let result = 0;
  for (const [n, v] of await accountSums(companyId, f.start_date, f.end_date)) if (n >= 3000 && n <= 8999) result -= Number(v);
  const secs = sections(rows);
  return { fy: f, rows, secs, result, done: rows.filter((r) => r.status === 'ok').length, total: rows.length };
}

/** Specifikation och avbockning av ett konto. Avstämt kräver att specifikationen stämmer med huvudboken. */
export async function saveItem(actor: Actor, fyId: number, account: number, input: Record<string, unknown>) {
  const f = await fy(actor.companyId, fyId);
  if (!(Number.isInteger(account) && account >= 1000 && account <= 2999)) throw new ValidationError('Bara balanskonton specificeras i pärmen');
  const raw = String(input.amount ?? '').trim();
  const amount = raw ? parseAmount(raw.replace(/^−/, '-')) : null;
  if (raw && amount == null) throw new ValidationError('Ogiltigt belopp');
  const done = input.done === 'on' || input.done === true;
  if (done) {
    const b = await binder(actor.companyId, fyId);
    const r = b.rows.find((x) => x.account === account);
    const specified = amount ?? (r?.source && r.source !== 'Manuell specifikation' ? r.specified : null);
    if (specified == null) throw new ValidationError('Ange det specificerade beloppet innan kontot bockas av');
    if ((r?.ledger ?? 0) !== specified) throw new ValidationError(`Specifikationen (${(specified / 100).toFixed(2).replace('.', ',')} kr) stämmer inte med huvudboken (${((r?.ledger ?? 0) / 100).toFixed(2).replace('.', ',')} kr) – utred differensen först`);
  }
  await sql`INSERT INTO closing_binder_items ${sql({ company_id: actor.companyId, fiscal_year_id: f.id, account, amount, note: str(input, 'note', { max: 1000 }), reference: str(input, 'reference', { max: 300 }),
    done, signed_by: done ? actor.userId : null, signed_at: done ? new Date() : null })}
    ON CONFLICT (company_id, fiscal_year_id, account) DO UPDATE SET amount = EXCLUDED.amount, note = EXCLUDED.note, reference = EXCLUDED.reference, done = EXCLUDED.done,
      signed_by = EXCLUDED.signed_by, signed_at = EXCLUDED.signed_at`;
  await auditBy(sql, actor, done ? 'reconcile' : 'specify', 'closing_binder', account, { fiscal_year: fyId, amount });
}

export async function pdf(companyId: number, fyId: number) {
  const b = await binder(companyId, fyId);
  const [c] = await sql<{ name: string; orgnr: string }[]>`SELECT name, orgnr FROM companies WHERE id = ${companyId}`;
  return { file: textPdf(binderPdf({ company: c.name, orgnr: c.orgnr, start: b.fy.start_date, end: b.fy.end_date, created: today(), secs: b.secs, result: b.result }), `Bokslutspärm ${c.name} ${b.fy.end_date}`), name: `Bokslutsparm ${b.fy.end_date}.pdf` };
}
