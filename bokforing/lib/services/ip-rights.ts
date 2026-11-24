import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { COST_KINDS, DEPRECIATION, KINDS, LEGAL, costAccount, costLines, renewal, renewedUntil, treatment, type CostKind, type Kind } from '@/lib/ip-rights';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';

const CREDIT: Record<number, string> = { 1930: 'Företagskonto', 2440: 'Leverantörsskulder' };
const EXPENSE_NAMES: Record<number, string> = { 6900: 'Övriga externa kostnader', 6540: 'IT-tjänster', [LEGAL]: 'Konsultarvoden', [DEPRECIATION]: 'Avskrivningar på immateriella anläggningstillgångar' };

export async function overview(companyId: number) {
  const t = today();
  const rights = await sql<{ id: number; kind: Kind; name: string; registration_no: string; registry: string; territory: string; registered_on: string | null; renewal_date: string | null; status: string; lapsed_on: string | null; expensed: number; capitalized: number; asset_active: boolean }[]>`
    SELECT r.id, r.kind, r.name, r.registration_no, r.registry, r.territory, to_char(r.registered_on,'YYYY-MM-DD') AS registered_on, to_char(r.renewal_date,'YYYY-MM-DD') AS renewal_date, r.status, to_char(r.lapsed_on,'YYYY-MM-DD') AS lapsed_on,
      COALESCE((SELECT SUM(c.amount) FROM ip_costs c WHERE c.ip_id = r.id AND c.treatment = 'expensed'), 0)::float8 AS expensed,
      COALESCE((SELECT SUM(c.amount) FROM ip_costs c WHERE c.ip_id = r.id AND c.treatment = 'capitalized'), 0)::float8 AS capitalized,
      EXISTS (SELECT 1 FROM ip_costs c JOIN assets a ON a.id = c.asset_id WHERE c.ip_id = r.id AND a.status = 'active') AS asset_active
    FROM ip_rights r WHERE r.company_id = ${companyId} ORDER BY r.status, r.renewal_date NULLS LAST, r.name`;
  const costs = await sql<{ ip_id: number; date: string; kind: CostKind; amount: number; treatment: string; account: number; voucher_id: number | null }[]>`SELECT ip_id, to_char(date,'YYYY-MM-DD') AS date, kind, amount::float8 AS amount, treatment, account, voucher_id
    FROM ip_costs WHERE company_id = ${companyId} ORDER BY date DESC, id DESC`;
  return { rights: rights.map((r) => ({ ...r, renewal: r.status === 'active' ? renewal(r.renewal_date, r.kind, t) : null, costs: costs.filter((c) => c.ip_id === r.id) })) };
}

export async function add(actor: Actor, input: Record<string, unknown>) {
  const kind = String(input.kind) as Kind;
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw new ValidationError('Välj typ av rättighet');
  const registered = date(input, 'registered_on', 'Registrerad', false) || null;
  // Förnyelsedatum: angivet, annars registreringsdagen plus skyddstiden (tio år för varumärken)
  const renewalDate = date(input, 'renewal_date', 'Förnyas', false) || (registered ? renewedUntil(registered, kind) : null);
  const [r] = await sql<{ id: number }[]>`INSERT INTO ip_rights ${sql({ company_id: actor.companyId, kind, name: str(input, 'name', { required: true, label: 'Benämning', max: 200 }), registration_no: str(input, 'registration_no', { max: 60 }),
    registry: str(input, 'registry', { max: 100 }), territory: str(input, 'territory', { max: 100 }), registered_on: registered, renewal_date: renewalDate, note: str(input, 'note', { max: 300 }), created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'ip_right', 'ip_right', r.id, { kind });
  return { id: r.id, renewalDate };
}

/** En utgift bokförs: kostnadsförs direkt eller aktiveras som immateriell anläggningstillgång med avskrivningsplan */
export async function addCost(actor: Actor, id: number, input: Record<string, unknown>) {
  const kind = String(input.kind) as CostKind;
  if (!Object.prototype.hasOwnProperty.call(COST_KINDS, kind)) throw new ValidationError('Välj typ av utgift');
  const amount = parseAmount(String(input.amount ?? '').trim());
  if (amount == null || amount <= 0) throw new ValidationError('Ange beloppet exkl. moms');
  const credit = int(input, 'credit_account', 'Betalning');
  if (!Object.prototype.hasOwnProperty.call(CREDIT, credit)) throw new ValidationError('Välj hur utgiften betalas');
  const d = date(input, 'date', 'Datum');
  const auto = treatment(kind, amount, Number(d.slice(0, 4)));
  // Förvärv kan kostnadsföras om tillgången är oväsentlig; egna avgifter får aldrig aktiveras
  const how = input.treatment === 'expensed' ? 'expensed' : input.treatment === 'capitalized' ? (kind === 'acquisition' ? 'capitalized' : (() => { throw new ValidationError('Bara förvärvade rättigheter kan aktiveras – egna ansöknings- och förnyelseavgifter kostnadsförs'); })()) : auto;
  const life = optInt(input, 'life_months') ?? 60;
  if (life < 12 || life > 240) throw new ValidationError('Avskrivningstiden ska vara 12–240 månader');
  return sql.begin(async (tx) => {
    const [r] = await tx<{ kind: Kind; name: string; status: string; renewal_date: string | null }[]>`SELECT kind, name, status, to_char(renewal_date,'YYYY-MM-DD') AS renewal_date FROM ip_rights WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!r) throw new NotFoundError('Rättigheten');
    if (r.status !== 'active') throw new ConflictError('Rättigheten har upphört');
    const account = costAccount(r.kind, kind, how);
    const k = KINDS[r.kind];
    const names: [number, string][] = how === 'capitalized' ? [[k.asset, k.assetName], [k.accDep, `Ackumulerade avskrivningar på ${k.assetName.toLowerCase()}`], [DEPRECIATION, EXPENSE_NAMES[DEPRECIATION]]] : [[account, EXPENSE_NAMES[account] ?? 'Övriga externa kostnader']];
    for (const [n, name] of [...names, [2440, 'Leverantörsskulder'] as [number, string]]) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n}, ${name}) ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: `${k.label} ${r.name}: ${COST_KINDS[kind].toLowerCase()}${how === 'capitalized' ? ' (aktiverad)' : ''}`.slice(0, 200), lines: fromSigned(costLines(amount, account, credit)), sourceType: 'ip_right', sourceId: id });
    let assetId: number | null = null;
    if (how === 'capitalized') {
      [{ id: assetId }] = await tx<{ id: number }[]>`INSERT INTO assets ${tx({ company_id: actor.companyId, name: `${k.label} ${r.name}`.slice(0, 200), category: 'immateriella', asset_account: k.asset, acc_dep_account: k.accDep, dep_account: DEPRECIATION,
        acquired_on: d, cost: amount, residual: 0, life_months: life, dep_start: `${d.slice(0, 7)}-01`, source_voucher_id: v.id, notes: 'Förvärvad immateriell rättighet', created_by: actor.userId })} RETURNING id`;
    }
    await tx`INSERT INTO ip_costs ${tx({ ip_id: id, company_id: actor.companyId, date: d, kind, amount, treatment: how, account, voucher_id: v.id, asset_id: assetId, created_by: actor.userId })}`;
    // En betald förnyelse flyttar fram nästa förnyelsedatum en skyddsperiod
    let renewedTo: string | null = null;
    if (kind === 'renewal' && r.renewal_date) { renewedTo = renewedUntil(r.renewal_date, r.kind); await tx`UPDATE ip_rights SET renewal_date = ${renewedTo} WHERE id = ${id}`; }
    return { how, account, renewedTo };
  });
}

/** Rättigheten upphör (förnyas inte, överlåts eller avregistreras); en aktiverad tillgång ska utrangeras i anläggningsregistret */
export async function lapse(actor: Actor, id: number) {
  const r = await sql`UPDATE ip_rights SET status = 'lapsed', lapsed_on = ${today()} WHERE id = ${id} AND company_id = ${actor.companyId} AND status = 'active'`;
  if (!r.count) throw new NotFoundError('Rättigheten');
  await auditBy(sql, actor, 'ip_right_lapsed', 'ip_right', id, {});
}
