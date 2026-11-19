import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { LEARN_AFTER, sameCoding, type ReceiptCoding, type SupplierCoding } from '@/lib/coding-memory';

type Kind = 'supplier' | 'receipt';

/** Kommer ihåg en kontering. Samma som förra gången → streak + 1, annars börjar den om. */
export async function rememberCoding(tx: Tx, companyId: number, kind: Kind, key: string, data: SupplierCoding | ReceiptCoding) {
  if (!key) return;
  const [cur] = await tx<{ data: object; streak: number }[]>`SELECT data, streak FROM coding_memory WHERE company_id = ${companyId} AND kind = ${kind} AND key = ${key} FOR UPDATE`;
  const streak = cur && sameCoding(cur.data, data) ? cur.streak + 1 : 1;
  await tx`
    INSERT INTO coding_memory (company_id, kind, key, data, streak, uses, last_at) VALUES (${companyId}, ${kind}, ${key}, ${tx.json(data as never)}, ${streak}, 1, now())
    ON CONFLICT (company_id, kind, key) DO UPDATE SET data = EXCLUDED.data, streak = ${streak}, uses = coding_memory.uses + 1, last_at = now()`;
}

/** Inlärda konteringar som är säkra nog att föreslå, per nyckel */
export async function learnedCodings<T>(companyId: number, kind: Kind): Promise<Record<string, T & { streak: number }>> {
  const rows = await sql<{ key: string; data: T; streak: number }[]>`
    SELECT key, data, streak FROM coding_memory WHERE company_id = ${companyId} AND kind = ${kind} AND streak >= ${LEARN_AFTER} ORDER BY last_at DESC LIMIT 500`;
  return Object.fromEntries(rows.map((r) => [r.key, { ...r.data, streak: r.streak }]));
}

export async function learnedSupplierCoding(companyId: number, supplierId: number) {
  const [r] = await sql<{ data: SupplierCoding; streak: number }[]>`
    SELECT data, streak FROM coding_memory WHERE company_id = ${companyId} AND kind = 'supplier' AND key = ${String(supplierId)} AND streak >= ${LEARN_AFTER}`;
  return r ? { ...r.data, streak: r.streak } : null;
}
