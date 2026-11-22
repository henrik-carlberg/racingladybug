import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { SETTLEMENT_ACCOUNT, writedowns } from '@/lib/debt-settlement';
import type { Actor } from './actor';
import { date, str } from './input';
import { deficits } from './deficits';

/** Öppna leverantörsskulder i kronor som omfattas av ackordet (bokförda, inte fullt betalda) */
async function openDebts(db: Tx | typeof sql, companyId: number, lock = false) {
  return db<{ id: number; supplier: string; number: string; remaining: number }[]>`SELECT i.id, s.name AS supplier, i.invoice_number AS number, (i.total - i.paid_amount)::float8 AS remaining
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.company_id = ${companyId} AND i.status IN ('booked','approved') AND i.voucher_id IS NOT NULL
      AND i.currency = 'SEK' AND i.total > i.paid_amount ORDER BY s.name, i.invoice_date ${lock ? db`FOR UPDATE OF i` : db``}`;
}

export async function overview(companyId: number) {
  const debts = await openDebts(sql, companyId);
  const done = await sql<{ id: number; reconstruction_on: string; decided_on: string; dividend_pct: number; writedown: number; to_pay: number; pay_by: string | null }[]>`SELECT id,
    to_char(reconstruction_on,'YYYY-MM-DD') AS reconstruction_on, to_char(decided_on,'YYYY-MM-DD') AS decided_on, dividend_pct::float8 AS dividend_pct, writedown::float8 AS writedown,
    to_pay::float8 AS to_pay, to_char(pay_by,'YYYY-MM-DD') AS pay_by FROM debt_settlements WHERE company_id = ${companyId} ORDER BY decided_on DESC`;
  const d = await deficits(companyId);
  const incoming = d.rows.at(-1)?.incoming ?? 0;
  return { debts, done, deficit: incoming, rows: d.rows.filter((r) => r.settlement) };
}

/** Fastställt ackord: skulderna sätts ned till dividenden, nedsättningen bokförs som ej skattepliktig ackordsvinst */
export async function settle(actor: Actor, input: Record<string, unknown>) {
  const pct = Number(str(input, 'dividend_pct').replace(',', '.'));
  if (!Number.isFinite(pct) || pct < 0 || pct >= 100) throw new ValidationError('Ange dividenden i procent (0–99)');
  const reconstruction = date(input, 'reconstruction_on', 'Beslut om rekonstruktion'), decided = date(input, 'decided_on', 'Ackordet fastställt');
  if (decided < reconstruction) throw new ValidationError('Ackordet fastställs efter beslutet om rekonstruktion');
  const payBy = date(input, 'pay_by', 'Betalas senast', false) || null;
  const chosen = new Set(String(input.invoices ?? '').split(',').map(Number).filter(Boolean));
  if (!chosen.size) throw new ValidationError('Välj vilka skulder som omfattas av ackordet');
  return sql.begin(async (tx) => {
    const debts = (await openDebts(tx, actor.companyId, true)).filter((d) => chosen.has(d.id));
    if (!debts.length) throw new ValidationError('Det finns inga leverantörsskulder att sätta ned');
    const w = writedowns(debts, pct);
    if (!w.total) throw new ValidationError('Ackordet sätter inte ned några skulder');
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${SETTLEMENT_ACCOUNT}, 'Ackordsvinst (ej skattepliktig)') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: decided, description: `Ackord ${pct} %: nedsättning av leverantörsskulder (rekonstruktion ${reconstruction})`, lines: fromSigned(w.lines), sourceType: 'debt_settlement' });
    for (const r of w.rows) if (r.writedown) {
      await tx`INSERT INTO supplier_invoice_payments (company_id, supplier_invoice_id, date, amount, voucher_id) VALUES (${actor.companyId}, ${r.id}, ${decided}, ${r.writedown}, ${v.id})`;
      await tx`UPDATE supplier_invoices SET paid_amount = paid_amount + ${r.writedown}, status = CASE WHEN paid_amount + ${r.writedown} >= total THEN 'paid' ELSE status END,
        paid_date = CASE WHEN paid_amount + ${r.writedown} >= total THEN ${decided}::date ELSE paid_date END WHERE id = ${r.id} AND company_id = ${actor.companyId}`;
    }
    await tx`INSERT INTO debt_settlements ${tx({ company_id: actor.companyId, reconstruction_on: reconstruction, decided_on: decided, dividend_pct: pct, writedown: w.total, to_pay: w.toPay, pay_by: payBy,
      invoices: tx.json(w.rows as never) as never, voucher_id: v.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'debt_settlement', 'company', actor.companyId, { pct, writedown: w.total });
    return w;
  });
}
