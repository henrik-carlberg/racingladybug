import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher, openingBalances } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { addDays } from '@/lib/format';
import { parseTaxAccount, suggestAccount } from '@/lib/taxaccount';
import type { Actor } from './actor';

export async function importTaxAccount(actor: Actor, text: string) {
  const rows = parseTaxAccount(text);
  if (!rows.length) throw new ValidationError('Inga transaktioner hittades i filen');
  const [c] = await sql<{ company_type: 'AB' | 'EF' }[]>`SELECT company_type FROM companies WHERE id = ${actor.companyId}`;
  let added = 0;
  const seen = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.date}|${r.text}|${r.amount}`;
    const seq = (seen.get(key) ?? 0) + 1;
    seen.set(key, seq);
    const status = suggestAccount(r.text, c.company_type) === 'bank' ? 'bank' : 'new';
    const res = await sql`INSERT INTO tax_account_entries (company_id, date, text, amount, balance, status, seq)
      VALUES (${actor.companyId}, ${r.date}, ${r.text}, ${r.amount}, ${r.balance}, ${status}, ${seq}) ON CONFLICT DO NOTHING RETURNING id`;
    added += res.length;
  }
  await auditBy(sql, actor, 'import', 'tax_account', actor.companyId, { rows: rows.length, added });
  return { rows: rows.length, added };
}

export async function listTaxAccount(companyId: number) {
  const [c] = await sql<{ company_type: 'AB' | 'EF' }[]>`SELECT company_type FROM companies WHERE id = ${companyId}`;
  const rows = await sql<{ id: number; date: string; text: string; amount: number; balance: number | null; status: string; voucher_id: number | null }[]>`
    SELECT id, to_char(date,'YYYY-MM-DD') AS date, text, amount, balance, status, voucher_id FROM tax_account_entries
    WHERE company_id = ${companyId} ORDER BY date DESC, seq DESC, id DESC LIMIT 500`;
  const last = rows.find((r) => r.balance != null);
  const ledger = last ? (await openingBalances(companyId, addDays(last.date, 1))).get(1630) ?? 0 : null;
  return {
    rows: rows.map((r) => ({ ...r, amount: Number(r.amount), balance: r.balance == null ? null : Number(r.balance), suggestion: suggestAccount(r.text, c.company_type) })),
    reconciliation: last ? { date: last.date, skatteverket: Number(last.balance), ledger: Number(ledger), diff: Number(last.balance) - Number(ledger) } : null,
  };
}

/** Bokför valda rader mot 1630 med angivet motkonto (en verifikation per rad) */
export async function bookTaxEntries(actor: Actor, items: { id: number; account: number }[]) {
  if (!items.length) throw new ValidationError('Välj rader att bokföra');
  return sql.begin(async (tx) => {
    let n = 0;
    for (const it of items) {
      if (!Number.isInteger(it.account) || it.account < 1000 || it.account > 8999 || it.account === 1630) throw new ValidationError(`Ogiltigt konto ${it.account}`);
      const EXTRA: Record<number, string> = { 6992: 'Övriga externa kostnader, ej avdragsgilla', 2012: 'Avräknad skatt och avgifter (skattekonto)', 8423: 'Räntekostnader för skatter och avgifter', 8314: 'Skattefria ränteintäkter' };
      if (EXTRA[it.account]) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${it.account}, ${EXTRA[it.account]}) ON CONFLICT DO NOTHING`;
      const [a] = await tx`SELECT 1 FROM accounts WHERE company_id = ${actor.companyId} AND number = ${it.account}`;
      if (!a) throw new ValidationError(`Konto ${it.account} finns inte i kontoplanen`);
      const [e] = await tx<{ date: string; text: string; amount: number; status: string }[]>`
        SELECT to_char(date,'YYYY-MM-DD') AS date, text, amount, status FROM tax_account_entries WHERE id = ${it.id} AND company_id = ${actor.companyId} FOR UPDATE`;
      if (!e) throw new ValidationError('Raden finns inte');
      if (e.status === 'booked') throw new ConflictError(`Raden "${e.text}" är redan bokförd`);
      const amt = Number(e.amount);
      const v = await createVoucher(tx, {
        actor, date: e.date, description: `Skattekontot: ${e.text}`, sourceType: 'tax_account', sourceId: it.id,
        lines: fromSigned([{ account: 1630, amount: amt }, { account: it.account, amount: -amt }]),
      });
      await tx`UPDATE tax_account_entries SET status = 'booked', voucher_id = ${v.id} WHERE id = ${it.id}`;
      n++;
    }
    return n;
  });
}

export async function setTaxEntryStatus(actor: Actor, id: number, status: 'new' | 'ignored' | 'bank') {
  const r = await sql`UPDATE tax_account_entries SET status = ${status} WHERE id = ${id} AND company_id = ${actor.companyId} AND status <> 'booked' RETURNING id`;
  if (!r.length) throw new ConflictError('Raden kan inte ändras');
  await auditBy(sql, actor, status, 'tax_account_entry', id);
}
