import 'server-only';
import { rememberCoding } from './coding-memory';
import { receiptKey } from '@/lib/coding-memory';
import { sql } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { createVoucher } from '@/lib/server/ledger';
import { paymentAccount, RECEIPT_CATEGORIES, receiptLines, type PaidWith } from '@/lib/receipts';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';
import { getVoucher, insertAttachment, type AttachmentIn } from './vouchers';

/** Bokför ett kvitto/utlägg från vardagsspråk: kategori, belopp, moms och hur det betalades */
export async function createReceipt(actor: Actor, input: Record<string, unknown>, attachment: AttachmentIn | null) {
  const cat = RECEIPT_CATEGORIES.find((c) => c.key === str(input, 'category'));
  if (!cat) throw new ValidationError('Välj vad kvittot gäller');
  const total = int(input, 'total', 'Belopp');
  if (total <= 0) throw new ValidationError('Beloppet måste vara större än noll');
  const vatRate = (optInt(input, 'vat_rate', 'Moms') ?? cat.vat) as 0 | 6 | 12 | 25;
  if (![0, 6, 12, 25].includes(vatRate)) throw new ValidationError('Momssatsen måste vara 0, 6, 12 eller 25 %');
  const paidWith = (str(input, 'paid_with') || 'company') as PaidWith;
  const [c] = await sql<{ company_type: 'AB' | 'EF' }[]>`SELECT company_type FROM companies WHERE id = ${actor.companyId}`;
  const what = str(input, 'description', { max: 200 }) || cat.label;
  const { lines: raw } = receiptLines({ category: cat, total, vatRate, persons: optInt(input, 'persons') ?? 1, paidWith, companyType: c.company_type, description: what });
  // Kvitto för ett kortköp: betalningen bokförs på kortets konto i stället för 1930
  const payAccount = optInt(input, 'pay_account');
  const lines = payAccount ? raw.map((l) => (l.account === paymentAccount('company', c.company_type) ? { ...l, account: payAccount } : l)) : raw;
  const id = await sql.begin(async (tx) => {
    const v = await createVoucher(tx, {
      actor, date: date(input, 'date', 'Datum'), lines, sourceType: 'receipt',
      description: `${what}${paidWith === 'private' ? ' (privat utlägg)' : ''}`,
    });
    if (attachment) await insertAttachment(tx, actor, v.id, attachment);
    const key = receiptKey(str(input, 'description', { max: 200 }));
    if (key) await rememberCoding(tx, actor.companyId, 'receipt', key, { category: cat.key, vatRate, paidWith });
    return v.id;
  });
  return getVoucher(actor.companyId, id);
}
