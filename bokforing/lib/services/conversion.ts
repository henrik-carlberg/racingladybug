import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, ForbiddenError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, createVoucher, fiscalYearFor } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { abLines, closingFundLines, efLines, finalNe, split, type Payment } from '@/lib/conversion';
import type { Actor } from './actor';
import { balancesAt } from './capital-control';
import { date, int, str } from './input';

/** Aktiebolag där användaren är ägare och som kan ta emot verksamheten */
export async function targets(userId: number, efId: number) {
  return sql<{ id: number; name: string }[]>`SELECT c.id, c.name FROM companies c JOIN memberships m ON m.company_id = c.id
    WHERE m.user_id = ${userId} AND m.role = 'owner' AND c.company_type = 'AB' AND c.id <> ${efId} ORDER BY c.name`;
}

async function efResult(companyId: number, at: string) {
  const fy = await fiscalYearFor(sql, companyId, at);
  if (!fy) return 0;
  let r = 0;
  for (const [n, v] of await accountSums(companyId, fy.start_date, at)) if (n >= 3000 && n <= 8999) r -= Number(v);
  return r;
}

export async function preview(companyId: number, at: string) {
  const [done] = await sql<{ ab: string; date: string; net: number; payment: Payment; pfond: number; expansion: number; ab_id: number }[]>`
    SELECT c.name AS ab, c.id AS ab_id, to_char(v.date,'YYYY-MM-DD') AS date, v.net::float8 AS net, v.payment, v.pfond_reversed::float8 AS pfond, v.expansion_reversed::float8 AS expansion
    FROM conversions v JOIN companies c ON c.id = v.ab_company_id WHERE v.ef_company_id = ${companyId}`;
  const s = split(await balancesAt(companyId, done?.date ?? at));
  const result = await efResult(companyId, done?.date ?? at);
  const ne = finalNe({ result: done ? result : result + s.pfondTotal, pfondTotal: done ? done.pfond : s.pfondTotal, expansion: done ? done.expansion : s.expansion });
  return { split: s, ne, done: done ?? null };
}

/** Genomför ombildningen: verifikation i firman (överlåtelse och återföring av fonder) och i aktiebolaget (övertagande) */
export async function convert(actor: Actor, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Överlåtelsedag');
  const abId = int(input, 'ab_company_id', 'Aktiebolag');
  const payment: Payment = str(input, 'payment') === 'contribution' ? 'contribution' : 'debt';
  const [c] = await sql<{ t: string; name: string }[]>`SELECT company_type AS t, name FROM companies WHERE id = ${actor.companyId}`;
  if (c?.t !== 'EF') throw new ValidationError('Ombildning görs från en enskild firma');
  if (actor.role !== 'owner') throw new ForbiddenError('Endast ägaren kan ombilda firman');
  // Mottagaren ska vara ett aktiebolag där samma användare är ägare
  if (!(await targets(actor.userId, actor.companyId)).some((t) => t.id === abId)) throw new ForbiddenError('Du måste vara ägare i aktiebolaget som tar över verksamheten');
  const s = split(await balancesAt(actor.companyId, d));
  let ab;
  try { ab = abLines(s, payment); } catch (e) { throw new ValidationError((e as Error).message); }
  const abActor: Actor = { companyId: abId, userId: actor.userId, apiKeyId: null, role: 'owner' };
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(108001, ${actor.companyId})`;
    const [dup] = await tx`SELECT 1 FROM conversions WHERE ef_company_id = ${actor.companyId}`;
    if (dup) throw new ConflictError('Firman är redan ombildad');
    // Aktiebolaget får firmans kontonamn för de konton som förs över
    const names = await tx<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${actor.companyId} AND number IN ${tx(ab.map((l) => l.account))}`;
    for (const n of names) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${abId}, ${n.number}, ${n.name}) ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${abId}, 2893, 'Skulder till närstående personer, kortfristig del'), (${abId}, 2093, 'Erhållna aktieägartillskott'),
      (${actor.companyId}, 2013, 'Övriga egna uttag'), (${actor.companyId}, 8819, 'Återföring av periodiseringsfond'), (${actor.companyId}, 2010, 'Eget kapital') ON CONFLICT DO NOTHING`;
    const efv = await createVoucher(tx, { actor, date: d, description: `Överlåtelse av verksamheten till ${(await tx<{ name: string }[]>`SELECT name FROM companies WHERE id = ${abId}`)[0].name} (underprisöverlåtelse till bokfört värde)`,
      lines: fromSigned(efLines(s)), sourceType: 'conversion' });
    const fl = closingFundLines(s);
    const fv = fl.length ? await createVoucher(tx, { actor, date: d, description: 'Återföring av periodiseringsfonder och expansionsfond när verksamheten upphör', lines: fromSigned(fl), sourceType: 'conversion' }) : null;
    const abv = await createVoucher(tx, { actor: abActor, date: d, description: `Övertagande av ${c.name}s verksamhet (${payment === 'debt' ? 'köpeskilling som skuld till ägaren' : 'ovillkorat aktieägartillskott'})`,
      lines: fromSigned(ab), sourceType: 'conversion' });
    await tx`INSERT INTO conversions ${tx({ ef_company_id: actor.companyId, ab_company_id: abId, date: d, net: s.net, payment, pfond_reversed: s.pfondTotal, expansion_reversed: s.expansion,
      ef_voucher_id: efv.id, ab_voucher_id: abv.id, fund_voucher_id: fv?.id ?? null, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'conversion', 'company', actor.companyId, { ab: abId, net: s.net, payment });
    await auditBy(tx, abActor, 'conversion_received', 'company', abId, { ef: actor.companyId, net: s.net });
    return { net: s.net, pfond: s.pfondTotal, expansion: s.expansion };
  });
}
