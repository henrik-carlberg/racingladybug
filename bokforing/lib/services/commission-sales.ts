import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { COMMISSION_INCOME, PRINCIPAL_DEBT, VAT_IN, VAT_OUT, payoutLines, saleLines, saleSplit } from '@/lib/commission-sales';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';

const NAMES: Record<number, string> = { [PRINCIPAL_DEBT]: 'Skuld till kommittenter', [COMMISSION_INCOME]: 'Provisionsintäkter, kommissionsförsäljning', 2611: 'Utgående moms på försäljning inom Sverige, 25 %', 2621: 'Utgående moms på försäljning inom Sverige, 12 %', 2631: 'Utgående moms på försäljning inom Sverige, 6 %', [VAT_IN]: 'Debiterad ingående moms' };
const ensure = async (tx: Tx, companyId: number, ns: number[]) => { for (const n of ns) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${n}, ${NAMES[n]}) ON CONFLICT DO NOTHING`; };

export async function overview(companyId: number, settlementId?: number) {
  const principals = await sql<{ id: number; name: string; vat_registered: boolean; commission_pct: number; in_stock: number; to_settle: number; unsettled: number }[]>`
    SELECT p.id, p.name, p.vat_registered, p.commission_pct::float8 AS commission_pct,
      (SELECT count(*)::int FROM commission_items i WHERE i.principal_id = p.id AND i.status = 'in_stock') AS in_stock,
      (SELECT count(*)::int FROM commission_items i WHERE i.principal_id = p.id AND i.status = 'sold' AND i.settlement_id IS NULL) AS to_settle,
      COALESCE((SELECT SUM(i.principal_share + i.principal_vat) FROM commission_items i WHERE i.principal_id = p.id AND i.status = 'sold' AND i.settlement_id IS NULL), 0)::float8 AS unsettled
    FROM commission_principals p WHERE p.company_id = ${companyId} ORDER BY p.name`;
  const items = await sql<{ id: number; principal: string; description: string; ask_price: number | null; vat_rate: number; received_on: string; status: string; sold_on: string | null; sale_price: number | null; sale_vat: number | null; commission: number | null; principal_share: number | null; principal_vat: number | null; settlement_id: number | null }[]>`
    SELECT i.id, p.name AS principal, i.description, i.ask_price::float8 AS ask_price, i.vat_rate, to_char(i.received_on,'YYYY-MM-DD') AS received_on, i.status, to_char(i.sold_on,'YYYY-MM-DD') AS sold_on,
      i.sale_price::float8 AS sale_price, i.sale_vat::float8 AS sale_vat, i.commission::float8 AS commission, i.principal_share::float8 AS principal_share, i.principal_vat::float8 AS principal_vat, i.settlement_id
    FROM commission_items i JOIN commission_principals p ON p.id = i.principal_id WHERE i.company_id = ${companyId} ORDER BY i.status = 'in_stock' DESC, i.id DESC LIMIT 300`;
  const [{ debt }] = await sql<{ debt: number }[]>`SELECT COALESCE(SUM(l.credit - l.debit), 0)::float8 AS debt FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND l.account_number = ${PRINCIPAL_DEBT}`;
  const settlement = settlementId ? (await sql<{ id: number; principal: string; date: string; amount: number }[]>`SELECT s.id, p.name AS principal, to_char(s.date,'YYYY-MM-DD') AS date, s.amount::float8 AS amount
    FROM commission_settlements s JOIN commission_principals p ON p.id = s.principal_id WHERE s.id = ${settlementId} AND s.company_id = ${companyId}`)[0] ?? null : null;
  const settlements = await sql<{ id: number; principal: string; date: string; amount: number }[]>`SELECT s.id, p.name AS principal, to_char(s.date,'YYYY-MM-DD') AS date, s.amount::float8 AS amount
    FROM commission_settlements s JOIN commission_principals p ON p.id = s.principal_id WHERE s.company_id = ${companyId} ORDER BY s.date DESC, s.id DESC LIMIT 50`;
  return { principals, items, debt, settlements, settlement, settlementItems: settlement ? items.filter((i) => i.settlement_id === settlement.id) : [] };
}

export async function addPrincipal(actor: Actor, input: Record<string, unknown>) {
  const pct = Number(String(input.commission_pct ?? '').replace(',', '.'));
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) throw new ValidationError('Ange provisionen i procent');
  try {
    await sql`INSERT INTO commission_principals ${sql({ company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Huvudman', max: 200 }), vat_registered: input.vat_registered === 'on',
      commission_pct: Math.round(pct * 100) / 100, bank_account: str(input, 'bank_account', { max: 60 }) })}`;
  } catch (e) { if (String((e as Error).message).includes('commission_principals_company_id_name_key')) throw new ConflictError('Huvudmannen finns redan'); throw e; }
}

/** Mottagen vara i kommission – den ingår inte i det egna lagret */
export async function receive(actor: Actor, input: Record<string, unknown>) {
  const principalId = int(input, 'principal_id', 'Huvudman');
  const [p] = await sql`SELECT 1 FROM commission_principals WHERE id = ${principalId} AND company_id = ${actor.companyId}`;
  if (!p) throw new NotFoundError('Huvudmannen');
  const vat = Number(input.vat_rate ?? 25);
  if (![0, 6, 12, 25].includes(vat)) throw new ValidationError('Ogiltig momssats');
  const askRaw = String(input.ask_price ?? '').trim();
  const ask = askRaw ? parseAmount(askRaw) : null;
  if (askRaw && (ask == null || ask <= 0)) throw new ValidationError('Ange begärt pris i kronor');
  await sql`INSERT INTO commission_items ${sql({ company_id: actor.companyId, principal_id: principalId, description: str(input, 'description', { required: true, label: 'Vara', max: 300 }), ask_price: ask, vat_rate: vat,
    received_on: date(input, 'received_on', 'Mottagen'), created_by: actor.userId })}`;
}

/** Försäljning: moms på hela priset, provisionen som intäkt och resten som skuld till huvudmannen */
export async function sell(actor: Actor, itemId: number, input: Record<string, unknown>) {
  const gross = parseAmount(String(input.price ?? '').trim());
  if (gross == null || gross <= 0) throw new ValidationError('Ange försäljningspriset inkl. moms');
  const d = date(input, 'date', 'Datum');
  const bank = optInt(input, 'bank_account', 'Konto') ?? 1930;
  if (!((bank >= 1900 && bank <= 1999) || bank === 1510 || bank === 1580)) throw new ValidationError('Betalningen tas emot på kassa/bank (19xx), kundfordran (1510) eller kortinlösen (1580)');
  return sql.begin(async (tx) => {
    const [i] = await tx<{ description: string; vat_rate: number; status: string; principal: string; vat_registered: boolean; pct: number }[]>`SELECT i.description, i.vat_rate, i.status, p.name AS principal, p.vat_registered, p.commission_pct::float8 AS pct
      FROM commission_items i JOIN commission_principals p ON p.id = i.principal_id WHERE i.id = ${itemId} AND i.company_id = ${actor.companyId} FOR UPDATE OF i`;
    if (!i) throw new NotFoundError('Varan');
    if (i.status !== 'in_stock') throw new ConflictError('Varan är redan såld eller återlämnad');
    const s = saleSplit({ gross, vatRate: i.vat_rate, commissionPct: i.pct, principalVatRegistered: i.vat_registered });
    await ensure(tx, actor.companyId, [PRINCIPAL_DEBT, COMMISSION_INCOME, ...(s.vat ? [VAT_OUT[i.vat_rate]] : []), ...(s.principalVat ? [VAT_IN] : [])]);
    const v = await createVoucher(tx, { actor, date: d, description: `Kommissionsförsäljning: ${i.description} (${i.principal})`, lines: fromSigned(saleLines(s, i.vat_rate, bank)), sourceType: 'commission_sale', sourceId: itemId });
    await tx`UPDATE commission_items SET status = 'sold', sold_on = ${d}, sale_price = ${s.net}, sale_vat = ${s.vat}, commission = ${s.commission}, principal_share = ${s.share}, principal_vat = ${s.principalVat}, voucher_id = ${v.id} WHERE id = ${itemId}`;
    await auditBy(tx, actor, 'commission_sale', 'commission_item', itemId, { gross, commission: s.commission });
    return s;
  });
}

export async function giveBack(actor: Actor, itemId: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  const r = await sql`UPDATE commission_items SET status = 'returned', returned_on = ${d} WHERE id = ${itemId} AND company_id = ${actor.companyId} AND status = 'in_stock'`;
  if (!r.count) throw new ConflictError('Varan finns inte i kommission');
}

/** Avräkningsnota: sålda varor som inte avräknats betalas ut till huvudmannen */
export async function settle(actor: Actor, principalId: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const [p] = await tx<{ name: string }[]>`SELECT name FROM commission_principals WHERE id = ${principalId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!p) throw new NotFoundError('Huvudmannen');
    const items = await tx<{ id: number; payable: number }[]>`SELECT id, (principal_share + principal_vat)::float8 AS payable FROM commission_items
      WHERE principal_id = ${principalId} AND company_id = ${actor.companyId} AND status = 'sold' AND settlement_id IS NULL AND sold_on <= ${d}`;
    const amount = items.reduce((s, i) => s + i.payable, 0);
    if (!amount) throw new ConflictError('Det finns inga sålda varor att avräkna');
    const v = await createVoucher(tx, { actor, date: d, description: `Avräkning kommission ${p.name}: ${items.length} varor`, lines: fromSigned(payoutLines(amount)), sourceType: 'commission_sale', sourceId: principalId });
    const [s] = await tx<{ id: number }[]>`INSERT INTO commission_settlements ${tx({ company_id: actor.companyId, principal_id: principalId, date: d, amount, voucher_id: v.id, created_by: actor.userId })} RETURNING id`;
    await tx`UPDATE commission_items SET settlement_id = ${s.id} WHERE id IN ${tx(items.map((i) => i.id))}`;
    await auditBy(tx, actor, 'commission_settlement', 'commission_principal', principalId, { amount, items: items.length });
    return { id: s.id, amount };
  });
}
