import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher, fiscalYearFor } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { COMPENSATION, damageLines, deadline, FUND, FUND_CHANGE, fundLines, maxFund, OVERDEP, reverseLines, SCRAP_LOSS, useLines, type FundKind } from '@/lib/replacement-fund';
import type { Actor } from './actor';
import { date, optInt, str } from './input';

const NAMES: Record<number, string> = { [COMPENSATION]: 'Försäkringsersättningar', [SCRAP_LOSS]: 'Förlust vid avyttring och utrangering av anläggningstillgångar', [FUND]: 'Ersättningsfonder', [FUND_CHANGE]: 'Förändring av ersättningsfonder', [OVERDEP]: 'Ackumulerade överavskrivningar' };
async function ensure(tx: Tx, companyId: number) { for (const [n, name] of Object.entries(NAMES)) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${Number(n)}, ${name}) ON CONFLICT DO NOTHING`; }
const kronor = (v: unknown, label: string, zero = false) => { const n = parseAmount(String(v ?? '').trim() || (zero ? '0' : '')); if (n == null || n < 0 || (!zero && !n)) throw new ValidationError(`Ange ${label} i kronor`); return n; };

type Claim = { id: number; description: string; kind: FundKind; damage_date: string; compensation: number; book_value: number; fund: number; fund_year: number | null; used: number; reversed: number };
const COLS = sql`id, description, kind, to_char(damage_date,'YYYY-MM-DD') AS damage_date, compensation::float8 AS compensation, book_value::float8 AS book_value, fund::float8 AS fund, fund_year, used::float8 AS used, reversed::float8 AS reversed`;
async function claim(tx: Tx, companyId: number, id: number) {
  const [c] = await tx<Claim[]>`SELECT ${COLS} FROM insurance_claims WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`;
  if (!c) throw new NotFoundError('Skadan');
  return c;
}

export async function list(companyId: number) {
  const rows = await sql<Claim[]>`SELECT ${COLS} FROM insurance_claims WHERE company_id = ${companyId} ORDER BY damage_date, id`;
  const t = today();
  return rows.map((c) => { const left = c.fund - c.used - c.reversed; const dl = c.fund_year ? deadline(c.fund_year) : null; return { ...c, left, deadline: dl, overdue: !!dl && left > 0 && t > dl }; });
}

/** Skadan registreras: utrangering av det bokförda värdet och försäkringsersättningen som intäkt */
export async function addClaim(actor: Actor, input: Record<string, unknown>) {
  const kind: FundKind = str(input, 'kind') === 'byggnad' ? 'byggnad' : 'inventarier';
  const d = date(input, 'damage_date', 'Skadedatum');
  const account = optInt(input, 'asset_account', 'Tillgångskonto') ?? (kind === 'byggnad' ? 1110 : 1220);
  if (account < 1000 || account > 1299) throw new ValidationError('Tillgången ska ligga på ett konto 1000–1299');
  const bookValue = kronor(input.book_value, 'bokfört värde', true), compensation = kronor(input.compensation, 'försäkringsersättningen');
  const receivedTo = optInt(input, 'received_to', 'Konto') ?? 1930;
  if (!((receivedTo >= 1900 && receivedTo <= 1999) || receivedTo === 1689)) throw new ValidationError('Ersättningen tas emot på bank (19xx) eller som fordran (1689)');
  return sql.begin(async (tx) => {
    await ensure(tx, actor.companyId);
    const desc = str(input, 'description', { required: true, label: 'Beskrivning', max: 200 });
    const v = await createVoucher(tx, { actor, date: d, description: `Skada: ${desc} (utrangering och försäkringsersättning)`, lines: fromSigned(damageLines({ bookValue, assetAccount: account, compensation, receivedTo })), sourceType: 'insurance' });
    const [r] = await tx<{ id: number }[]>`INSERT INTO insurance_claims ${tx({ company_id: actor.companyId, description: desc, kind, damage_date: d, asset_account: account, book_value: bookValue, compensation, damage_voucher_id: v.id, created_by: actor.userId })} RETURNING id`;
    await auditBy(tx, actor, 'create', 'insurance_claim', r.id, { compensation });
    return r.id;
  });
}

/** Avsättning till ersättningsfond per räkenskapsårets sista dag (högst ersättningen) */
export async function setFund(actor: Actor, id: number, input: Record<string, unknown>) {
  const amount = kronor(input.amount, 'avsättningen');
  return sql.begin(async (tx) => {
    const c = await claim(tx, actor.companyId, id);
    if (c.fund) throw new ConflictError('Ersättningsfonden är redan avsatt');
    if (amount > maxFund(c.compensation, c.fund)) throw new ValidationError(`Avsättningen får vara högst försäkringsersättningen (${(c.compensation / 100).toLocaleString('sv-SE')} kr)`);
    const fy = await fiscalYearFor(tx, actor.companyId, c.damage_date);
    if (!fy) throw new ValidationError('Det finns inget räkenskapsår för skadedatumet');
    await ensure(tx, actor.companyId);
    await createVoucher(tx, { actor, date: fy.end_date, description: `Avsättning till ersättningsfond: ${c.description}`, lines: fromSigned(fundLines(amount)), sourceType: 'replacement_fund', sourceId: id });
    await tx`UPDATE insurance_claims SET fund = ${amount}, fund_year = ${Number(fy.end_date.slice(0, 4))} WHERE id = ${id}`;
    await auditBy(tx, actor, 'replacement_fund', 'insurance_claim', id, { amount });
  });
}

/** Ianspråktagande vid återanskaffning eller återföring när fonden inte används i tid */
export async function useOrReverse(actor: Actor, id: number, input: Record<string, unknown>) {
  const kind = str(input, 'action') === 'reverse' ? 'reverse' : 'use';
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const c = await claim(tx, actor.companyId, id);
    const left = c.fund - c.used - c.reversed;
    if (left <= 0) throw new ConflictError('Ersättningsfonden är redan använd eller återförd');
    const amount = kind === 'reverse' ? left : Math.min(left, kronor(input.amount, 'beloppet'));
    if (kind === 'use' && c.fund_year && d > deadline(c.fund_year)) throw new ValidationError(`Fonden skulle ha tagits i anspråk senast ${deadline(c.fund_year)} – återför den i stället`);
    await ensure(tx, actor.companyId);
    await createVoucher(tx, { actor, date: d, description: `${kind === 'use' ? 'Ianspråktagande' : 'Återföring'} av ersättningsfond: ${c.description}`, lines: fromSigned(kind === 'use' ? useLines(amount, c.kind) : reverseLines(amount)), sourceType: 'replacement_fund', sourceId: id });
    await tx`UPDATE insurance_claims SET ${kind === 'use' ? tx`used = used + ${amount}` : tx`reversed = reversed + ${amount}`} WHERE id = ${id}`;
    await auditBy(tx, actor, 'replacement_fund_' + kind, 'insurance_claim', id, { amount });
    return amount;
  });
}
