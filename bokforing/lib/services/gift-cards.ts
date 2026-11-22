import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { EXPIRED, LIABILITY, expireLines, redeemLines, saleLines, type VoucherKind } from '@/lib/gift-cards';
import type { Actor } from './actor';
import { date, str } from './input';

const PAY: Record<string, number> = { cash: 1910, card: 1580, swish: 1930 };
const kronor = (v: unknown, label: string) => { const n = parseAmount(String(v ?? '').trim()); if (n == null || n <= 0) throw new ValidationError(`Ange ${label} i kronor`); return n; };

export async function overview(companyId: number) {
  const cards = await sql<{ id: number; code: string; kind: VoucherKind; vat_rate: number; amount: number; redeemed: number; sold_on: string; valid_to: string; expired_on: string | null }[]>`
    SELECT id, code, kind, vat_rate, amount::float8 AS amount, redeemed::float8 AS redeemed, to_char(sold_on,'YYYY-MM-DD') AS sold_on, to_char(valid_to,'YYYY-MM-DD') AS valid_to, to_char(expired_on,'YYYY-MM-DD') AS expired_on
    FROM gift_cards WHERE company_id = ${companyId} ORDER BY sold_on DESC, id DESC LIMIT 200`;
  const open = cards.filter((c) => !c.expired_on && c.redeemed < c.amount);
  const t = today();
  return { cards, outstanding: open.reduce((s, c) => s + c.amount - c.redeemed, 0), expiredDue: open.filter((c) => c.valid_to < t).length };
}

async function ensure(tx: Tx, companyId: number) {
  await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${LIABILITY}, 'Ej inlösta presentkort'), (${companyId}, ${EXPIRED}, 'Övriga ersättningar och intäkter'), (${companyId}, 1910, 'Kassa'), (${companyId}, 1580, 'Fordringar för kontokort och kuponger') ON CONFLICT DO NOTHING`;
}

export async function sell(actor: Actor, input: Record<string, unknown>) {
  const kind = (str(input, 'kind') === 'multi' ? 'multi' : 'single') as VoucherKind;
  const rate = Number(str(input, 'vat_rate') || '25');
  if (![6, 12, 25].includes(rate)) throw new ValidationError('Välj momssats');
  const amount = kronor(input.amount, 'kortets värde');
  const d = date(input, 'date', 'Datum'), validTo = date(input, 'valid_to', 'Giltigt till');
  if (validTo <= d) throw new ValidationError('Giltighetstiden ska sluta efter försäljningsdagen');
  const payAccount = PAY[str(input, 'payment')] ?? 1930;
  const code = str(input, 'code', { required: true, label: 'Kortnummer', max: 40 });
  return sql.begin(async (tx) => {
    await ensure(tx, actor.companyId);
    const [dup] = await tx`SELECT 1 FROM gift_cards WHERE company_id = ${actor.companyId} AND code = ${code}`;
    if (dup) throw new ConflictError('Kortnumret finns redan');
    await createVoucher(tx, { actor, date: d, description: `Sålt presentkort ${code} (${kind === 'single' ? 'enfunktionsvoucher' : 'flerfunktionsvoucher'})`, lines: fromSigned(saleLines({ kind, amount, rate, payAccount })), sourceType: 'gift_card' });
    await tx`INSERT INTO gift_cards ${tx({ company_id: actor.companyId, code, kind, vat_rate: rate, amount, sold_on: d, valid_to: validTo, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'gift_card_sell', 'company', actor.companyId, { code, amount });
  });
}

/** Inlösen, helt eller delvis */
export async function redeem(actor: Actor, input: Record<string, unknown>) {
  const code = str(input, 'code', { required: true, label: 'Kortnummer', max: 40 });
  const amount = kronor(input.amount, 'beloppet');
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const [c] = await tx<{ id: number; kind: VoucherKind; vat_rate: number; amount: number; redeemed: number; valid_to: string; expired_on: string | null }[]>`SELECT id, kind, vat_rate, amount::float8 AS amount,
      redeemed::float8 AS redeemed, to_char(valid_to,'YYYY-MM-DD') AS valid_to, to_char(expired_on,'YYYY-MM-DD') AS expired_on FROM gift_cards WHERE company_id = ${actor.companyId} AND code = ${code} FOR UPDATE`;
    if (!c) throw new NotFoundError('Presentkortet');
    if (c.expired_on || d > c.valid_to) throw new ConflictError(`Presentkortet gick ut ${c.valid_to}`);
    const left = c.amount - c.redeemed;
    if (amount > left) throw new ValidationError(`Kvar på kortet: ${(left / 100).toLocaleString('sv-SE')} kr`);
    await createVoucher(tx, { actor, date: d, description: `Inlöst presentkort ${code}`, lines: fromSigned(redeemLines({ kind: c.kind, amount, rate: c.vat_rate, face: c.amount })), sourceType: 'gift_card' });
    await tx`UPDATE gift_cards SET redeemed = redeemed + ${amount} WHERE id = ${c.id}`;
    return { left: left - amount };
  });
}

/** Kort som har gått ut utan att lösas in: återstående skuld intäktsförs */
export async function expire(actor: Actor) {
  const d = today();
  return sql.begin(async (tx) => {
    const cards = await tx<{ id: number; code: string; kind: VoucherKind; vat_rate: number; balance: number }[]>`SELECT id, code, kind, vat_rate, (amount - redeemed)::float8 AS balance FROM gift_cards
      WHERE company_id = ${actor.companyId} AND expired_on IS NULL AND valid_to < ${d} AND redeemed < amount FOR UPDATE`;
    if (!cards.length) throw new ValidationError('Inga utgångna presentkort att intäktsföra');
    await ensure(tx, actor.companyId);
    const lines = cards.flatMap((c) => expireLines({ kind: c.kind, balance: c.balance, rate: c.vat_rate }));
    const merged = [...lines.reduce((m, l) => m.set(l.account, (m.get(l.account) ?? 0) + l.amount), new Map<number, number>())].map(([account, amount]) => ({ account, amount }));
    if (merged.some((l) => l.amount)) await createVoucher(tx, { actor, date: d, description: `Utgångna presentkort (${cards.length} st) intäktsförs`, lines: fromSigned(merged), sourceType: 'gift_card' });
    await tx`UPDATE gift_cards SET expired_on = ${d} WHERE id IN ${tx(cards.map((c) => c.id))}`;
    await auditBy(tx, actor, 'gift_card_expire', 'company', actor.companyId, { count: cards.length });
    return { count: cards.length, amount: cards.reduce((s, c) => s + c.balance, 0) };
  });
}
