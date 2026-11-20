import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parentLines, subsidiaryLines, takeover, type Treatment } from '@/lib/merger';
import type { Actor } from './actor';
import { balancesAt } from './capital-control';
import { date, str } from './input';

/** Helägda dotterbolag där användaren är ägare i båda bolagen */
export async function candidates(userId: number, parentId: number) {
  return sql<{ id: number; name: string; acquisition_cost: number | null }[]>`SELECT c.id, c.name, g.acquisition_cost::float8 AS acquisition_cost FROM group_links g JOIN companies c ON c.id = g.subsidiary_company_id
    JOIN memberships m ON m.company_id = c.id AND m.user_id = ${userId} AND m.role = 'owner'
    WHERE g.parent_company_id = ${parentId} AND g.ownership = 100 AND c.company_type = 'AB' ORDER BY c.name`;
}

/** Aktiernas bokförda värde: anskaffningsvärdet för just det här dotterbolaget (inte hela 1310–1319, där andra dotterbolag kan ingå) */
function shareValue(acquisitionCost: number | null) {
  if (acquisitionCost == null) throw new ValidationError('Ange aktiernas anskaffningsvärde för dotterbolaget under Koncern innan fusionen');
  return acquisitionCost;
}

export async function overview(userId: number, parentId: number, at: string) {
  const subs = await candidates(userId, parentId);
  const rows = [];
  for (const s of subs) {
    const [m] = await sql<{ plan_date: string; registered_on: string | null; difference: number | null; treatment: Treatment | null; net_assets: number | null; share_value: number | null }[]>`
      SELECT to_char(plan_date,'YYYY-MM-DD') AS plan_date, to_char(registered_on,'YYYY-MM-DD') AS registered_on, difference::float8 AS difference, treatment, net_assets::float8 AS net_assets, share_value::float8 AS share_value
      FROM mergers WHERE subsidiary_company_id = ${s.id} AND parent_company_id = ${parentId}`;
    const preview = m?.registered_on || s.acquisition_cost == null ? null : takeover(await balancesAt(s.id, at).catch(() => new Map()), s.acquisition_cost);
    rows.push({ ...s, merger: m ?? null, preview });
  }
  return rows;
}

export async function plan(actor: Actor, subId: number, input: Record<string, unknown>) {
  if (!(await candidates(actor.userId, actor.companyId)).some((c) => c.id === subId)) throw new ForbiddenError('Bara helägda dotterbolag där du är ägare kan fusioneras');
  const d = date(input, 'plan_date', 'Fusionsplanens datum');
  shareValue((await candidates(actor.userId, actor.companyId)).find((c) => c.id === subId)!.acquisition_cost);
  await sql`INSERT INTO mergers (subsidiary_company_id, parent_company_id, plan_date, created_by) VALUES (${subId}, ${actor.companyId}, ${d}, ${actor.userId})
    ON CONFLICT (subsidiary_company_id) DO UPDATE SET plan_date = EXCLUDED.plan_date WHERE mergers.registered_on IS NULL AND mergers.parent_company_id = EXCLUDED.parent_company_id`;
  await auditBy(sql, actor, 'merger_plan', 'company', subId, { plan: d });
}

/** När Bolagsverket registrerat fusionen: moderbolaget tar över posterna och dotterbolaget förs ut per registreringsdagen */
export async function complete(actor: Actor, subId: number, input: Record<string, unknown>) {
  const sub = (await candidates(actor.userId, actor.companyId)).find((c) => c.id === subId);
  if (!sub) throw new ForbiddenError('Bara helägda dotterbolag där du är ägare kan fusioneras');
  const d = date(input, 'registered_on', 'Registreringsdag');
  const treatment: Treatment = str(input, 'treatment') === 'goodwill' ? 'goodwill' : 'equity';
  const sharesAccount = Number(str(input, 'shares_account') || '1311');
  if (!(Number.isInteger(sharesAccount) && sharesAccount >= 1310 && sharesAccount <= 1319)) throw new ValidationError('Aktierna ska ligga på ett konto 1310–1319');
  const subActor: Actor = { companyId: subId, userId: actor.userId, apiKeyId: null, role: 'owner' };
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(117001, ${subId})`;
    const [m] = await tx<{ plan_date: string; registered_on: string | null; parent: number }[]>`SELECT to_char(plan_date,'YYYY-MM-DD') AS plan_date, to_char(registered_on,'YYYY-MM-DD') AS registered_on, parent_company_id AS parent FROM mergers WHERE subsidiary_company_id = ${subId}`;
    if (!m || m.parent !== actor.companyId) throw new NotFoundError('Fusionsplanen');
    if (m.registered_on) throw new ConflictError('Fusionen är redan genomförd');
    if (d < m.plan_date) throw new ValidationError('Registreringen kan inte ligga före fusionsplanen');
    const t = takeover(await balancesAt(subId, d), shareValue(sub.acquisition_cost));
    const parent = await balancesAt(actor.companyId, d);
    if ((parent.get(sharesAccount) ?? 0) < t.shareValue) throw new ValidationError(`Konto ${sharesAccount} har inte aktiernas bokförda värde (${(t.shareValue / 100).toLocaleString('sv-SE')} kr) – välj kontot där aktierna i dotterbolaget är bokförda`);
    if (!t.items.length) throw new ValidationError('Dotterbolaget har inga tillgångar eller skulder att föra över');
    const names = await tx<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${subId} AND number IN ${tx(t.items.map((i) => i.account))}`;
    for (const n of names) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n.number}, ${n.name}) ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, 1070, 'Goodwill'), (${actor.companyId}, 2091, 'Balanserad vinst eller förlust'), (${subId}, 2091, 'Balanserad vinst eller förlust') ON CONFLICT DO NOTHING`;
    const pv = await createVoucher(tx, { actor, date: d, description: `Fusion: ${sub.name} uppgår i moderbolaget (andelsvärdemetoden, fusionsdifferens ${(t.difference / 100).toLocaleString('sv-SE')} kr)`, lines: fromSigned(parentLines(t, treatment, sharesAccount)), sourceType: 'merger', sourceId: subId });
    const sv = await createVoucher(tx, { actor: subActor, date: d, description: 'Fusion: tillgångar och skulder övertagna av moderbolaget', lines: fromSigned(subsidiaryLines(t)), sourceType: 'merger', sourceId: actor.companyId });
    await tx`UPDATE mergers SET registered_on = ${d}, net_assets = ${t.net}, share_value = ${t.shareValue}, difference = ${t.difference}, treatment = ${treatment}, parent_voucher_id = ${pv.id}, subsidiary_voucher_id = ${sv.id} WHERE subsidiary_company_id = ${subId}`;
    await auditBy(tx, actor, 'merger', 'company', subId, { difference: t.difference });
    await auditBy(tx, subActor, 'merged_into', 'company', actor.companyId, { net: t.net });
    return t;
  });
}
