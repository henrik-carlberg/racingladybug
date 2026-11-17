import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import type { Actor } from './actor';
import { bool, has, int, str } from './input';

export interface AccountOut { object: 'account'; number: number; name: string; active: boolean }

export async function listAccounts(companyId: number): Promise<AccountOut[]> {
  return [...await sql<AccountOut[]>`SELECT 'account' AS object, number, name, active FROM accounts WHERE company_id = ${companyId} ORDER BY number`];
}

export async function upsertAccount(actor: Actor, input: Record<string, unknown>): Promise<AccountOut> {
  const n = int(input, 'number', 'Kontonummer');
  if (n < 1000 || n > 9999) throw new ValidationError('Kontonummer måste vara 1000–9999');
  const name = str(input, 'name', { required: true, label: 'Kontonamn' });
  const active = has(input, 'active') ? bool(input, 'active') : true;
  return sql.begin(async (tx) => {
    const [a] = await tx<AccountOut[]>`INSERT INTO accounts (company_id, number, name, active) VALUES (${actor.companyId}, ${n}, ${name}, ${active})
      ON CONFLICT (company_id, number) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active
      RETURNING 'account' AS object, number, name, active`;
    await auditBy(tx, actor, 'upsert', 'account', n, { name, active });
    await emit(tx, actor.companyId, 'account.updated', a);
    return a;
  });
}

export async function toggleAccount(actor: Actor, n: number) {
  return sql.begin(async (tx) => {
    const [a] = await tx<AccountOut[]>`UPDATE accounts SET active = NOT active WHERE company_id = ${actor.companyId} AND number = ${n}
      RETURNING 'account' AS object, number, name, active`;
    if (!a) throw new NotFoundError('Kontot');
    await auditBy(tx, actor, 'toggle', 'account', n);
    await emit(tx, actor.companyId, 'account.updated', a);
    return a;
  });
}
