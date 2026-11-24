import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { KINDS, expiry, type Kind } from '@/lib/authorizations';
import type { Actor } from './actor';
import { date, str } from './input';

export async function overview(companyId: number) {
  const t = today();
  const rows = await sql<{ id: number; kind: Kind; name: string; counterparty: string; holder: string; scope: string; reference: string; valid_from: string | null; valid_until: string | null; cost: number; status: string; revoked_on: string | null; revoked_reason: string }[]>`
    SELECT id, kind, name, counterparty, holder, scope, reference, to_char(valid_from,'YYYY-MM-DD') AS valid_from, to_char(valid_until,'YYYY-MM-DD') AS valid_until, cost::float8 AS cost, status, to_char(revoked_on,'YYYY-MM-DD') AS revoked_on, revoked_reason
    FROM authorizations WHERE company_id = ${companyId} ORDER BY status, valid_until NULLS LAST, name`;
  const list = rows.map((r) => ({ ...r, expiry: r.status === 'active' ? expiry(r.valid_until, t) : null }));
  return {
    list, alerts: list.filter((r) => r.expiry && (r.expiry.status === 'expiring' || r.expiry.status === 'expired')),
    yearlyCost: list.filter((r) => r.status === 'active').reduce((s, r) => s + r.cost, 0),
  };
}

export async function add(actor: Actor, input: Record<string, unknown>) {
  const kind = String(input.kind) as Kind;
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw new ValidationError('Välj typ');
  const from = date(input, 'valid_from', 'Gäller från', false) || null, until = date(input, 'valid_until', 'Gäller till', false) || null;
  if (from && until && until < from) throw new ValidationError('Slutdatumet är före startdatumet');
  const cost = String(input.cost ?? '').trim() ? parseAmount(String(input.cost)) : 0;
  if (cost == null || cost < 0) throw new ValidationError('Ogiltig kostnad');
  if (kind === 'power_of_attorney' && !String(input.holder ?? '').trim()) throw new ValidationError('Ange vem fullmakten gäller');
  const [r] = await sql<{ id: number }[]>`INSERT INTO authorizations ${sql({ company_id: actor.companyId, kind, name: str(input, 'name', { required: true, label: 'Benämning', max: 150 }), counterparty: str(input, 'counterparty', { max: 150 }),
    holder: str(input, 'holder', { max: 150 }), scope: str(input, 'scope', { max: 500 }), reference: str(input, 'reference', { max: 100 }), valid_from: from, valid_until: until, cost, created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'authorization', 'authorization', r.id, { kind });
}

/** Fullmakten återkallas (anmäl också till motparten) – den finns kvar i loggen */
export async function revoke(actor: Actor, id: number, input: Record<string, unknown>) {
  const [a] = await sql<{ status: string; kind: Kind }[]>`SELECT status, kind FROM authorizations WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!a) throw new NotFoundError('Posten');
  if (a.status !== 'active') throw new ConflictError('Posten är redan avslutad');
  const reason = str(input, 'reason', { required: true, label: 'Skäl', max: 300 });
  await sql`UPDATE authorizations SET status = ${a.kind === 'power_of_attorney' ? 'revoked' : 'expired'}, revoked_on = ${today()}, revoked_reason = ${reason} WHERE id = ${id}`;
  await auditBy(sql, actor, 'authorization_revoked', 'authorization', id, {});
  return a.kind;
}

/** Förnyelse: ny giltighetstid */
export async function renew(actor: Actor, id: number, input: Record<string, unknown>) {
  const until = date(input, 'valid_until', 'Ny giltighet');
  if (until <= today()) throw new ValidationError('Den nya giltigheten ska vara framåt i tiden');
  const r = await sql`UPDATE authorizations SET valid_until = ${until} WHERE id = ${id} AND company_id = ${actor.companyId} AND status = 'active'`;
  if (!r.count) throw new NotFoundError('Posten');
  return until;
}
