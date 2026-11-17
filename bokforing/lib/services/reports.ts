import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, ValidationError } from '@/lib/errors';
import { accountSums, createVoucher, openingBalances } from '@/lib/server/ledger';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { vatReport, vatSettlementLines } from '@/lib/vat';
import type { Actor } from './actor';

export async function getVatReport(companyId: number, from: string, to: string) {
  const sums = await accountSums(companyId, from, to, { excludeVatSettlements: true });
  const r = vatReport(sums);
  const [settled] = await sql<{ id: number }[]>`
    SELECT v.id FROM vouchers v WHERE v.company_id = ${companyId} AND v.source_type = 'vat' AND v.date BETWEEN ${from} AND ${to}
      AND NOT EXISTS (SELECT 1 FROM vouchers x WHERE x.corrects_id = v.id)`;
  return {
    object: 'vat_report', from, to,
    boxes: r.boxes.map((b) => ({ box: b.box, label: b.label, amount: b.amount, amount_kr: Math.trunc(b.amount / 100) })),
    to_pay: r.toPay, settlement_voucher_id: settled?.id ?? null,
  };
}

export async function settleVat(actor: Actor, from: string, to: string) {
  if (!from || !to || to < from) throw new ValidationError('Ange giltig period');
  const report = await getVatReport(actor.companyId, from, to);
  if (report.settlement_voucher_id) throw new ConflictError('Det finns redan en momsavräkning för perioden');
  const lines = vatSettlementLines(await accountSums(actor.companyId, from, to, { excludeVatSettlements: true }));
  if (lines.length === 0) throw new ValidationError('Inga momstransaktioner i perioden');
  return sql.begin(async (tx) => {
    const v = await createVoucher(tx, { actor, date: to, description: `Momsavräkning ${from} – ${to}`, lines, sourceType: 'vat' });
    await auditBy(tx, actor, 'settle', 'vat', v.id, { from, to });
    const out = { ...report, settlement_voucher_id: v.id };
    await emit(tx, actor.companyId, 'vat.settled', out);
    return out;
  });
}

/** Saldo per konto för en period (resultatkonton) och per slutdatum (balanskonton, inkl. ingående balans) */
export async function getBalances(companyId: number, from: string, to: string) {
  const names = new Map((await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${companyId}`).map((a) => [a.number, a.name]));
  const ib = await openingBalances(companyId, from);
  const period = await accountSums(companyId, from, to);
  const accounts = [...new Set([...ib.keys(), ...period.keys()])].sort((a, b) => a - b);
  return {
    object: 'balances', from, to,
    data: accounts.map((n) => {
      const opening = n < 3000 ? ib.get(n) ?? 0 : 0;
      const change = period.get(n) ?? 0;
      return { account: n, name: names.get(n) ?? '', opening_balance: opening, change, closing_balance: opening + change };
    }).filter((r) => r.opening_balance !== 0 || r.change !== 0),
  };
}
