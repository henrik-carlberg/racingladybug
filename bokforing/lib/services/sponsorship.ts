import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { ACCOUNTS, giftLines, sponsorLines } from '@/lib/sponsorship';
import type { Actor } from './actor';
import { date, str } from './input';

const kronor = (v: unknown, label: string, zero = false) => { const n = parseAmount(String(v ?? '').trim() || (zero ? '0' : '')); if (n == null || n < 0 || (!zero && !n)) throw new ValidationError(`Ange ${label} i kronor`); return n; };

export async function overview(companyId: number, year: number) {
  const rows = await sql<{ id: number; kind: 'sponsor' | 'gift'; date: string; recipient: string; amount: number; vat: number; counter_performance: string; recipients: number; deductible: boolean }[]>`
    SELECT id, kind, to_char(date,'YYYY-MM-DD') AS date, recipient, amount::float8 AS amount, vat::float8 AS vat, counter_performance, recipients, deductible
    FROM sponsorships WHERE company_id = ${companyId} AND extract(year from date) = ${year} ORDER BY date DESC, id DESC`;
  const sum = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((s, r) => s + r.amount + (r.deductible ? 0 : r.vat), 0);
  return { year, rows, deductible: sum((r) => r.deductible), nonDeductible: sum((r) => !r.deductible) };
}

async function ensure(companyId: number, tx: Tx) {
  for (const [n, name] of [[ACCOUNTS.sponsor, 'Sponsring'], [ACCOUNTS.gift, 'Gåvor till affärsförbindelser, avdragsgilla'], [ACCOUNTS.nonDeductible, 'Lämnade bidrag och gåvor, ej avdragsgilla']] as const)
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${n}, ${name}) ON CONFLICT DO NOTHING`;
}

export async function register(actor: Actor, input: Record<string, unknown>) {
  const kind = str(input, 'kind') === 'gift' ? 'gift' : 'sponsor';
  const recipient = str(input, 'recipient', { required: true, label: kind === 'gift' ? 'Mottagare' : 'Den sponsrade', max: 200 });
  const amount = kronor(input.amount, 'beloppet exkl. moms'), vat = kronor(input.vat, 'momsen', true);
  if (vat > amount) throw new ValidationError('Momsen kan inte vara större än beloppet');
  const d = date(input, 'date', 'Datum');
  const counter = str(input, 'counter_performance', { max: 500 });
  const recipients = kind === 'gift' ? Math.max(1, Number(str(input, 'recipients') || '1')) : 1;
  if (!Number.isInteger(recipients)) throw new ValidationError('Ange antal mottagare');
  const r = kind === 'sponsor' ? { ...sponsorLines({ amount, vat, counter: !!counter }), per: amount } : giftLines({ amount, vat, recipients });
  return sql.begin(async (tx) => {
    await ensure(actor.companyId, tx);
    const v = await createVoucher(tx, { actor, date: d, description: `${kind === 'gift' ? 'Gåvor' : 'Sponsring'}: ${recipient}${r.deductible ? '' : ' (ej avdragsgill)'}`, lines: fromSigned(r.lines), sourceType: 'sponsorship' });
    await tx`INSERT INTO sponsorships ${tx({ company_id: actor.companyId, kind, date: d, recipient, amount, vat, counter_performance: counter, recipients, deductible: r.deductible, voucher_id: v.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'sponsorship', 'company', actor.companyId, { kind, deductible: r.deductible });
    return { deductible: r.deductible, per: r.per };
  });
}
