import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, fiscalYearFor, openingBalances } from '@/lib/server/ledger';
import { today } from '@/lib/format';
import { addMonths, controlBalance, deadlines, distribution, equityFromBalances, parseAdjustments, warning, type Adjustment } from '@/lib/capital-control';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { distributionLines, gains } from '@/lib/liquidation';
import type { Actor } from './actor';
import { date, str } from './input';

/** Saldon per datum: balanskonton inklusive tidigare års resultat och årets resultatkonton */
export async function balancesAt(companyId: number, at: string) {
  const fy = await fiscalYearFor(sql, companyId, at);
  if (!fy) throw new ValidationError(`Det finns inget räkenskapsår för ${at}`);
  const m = new Map([...await openingBalances(companyId, fy.start_date)].map(([k, v]) => [k, Number(v)]));
  for (const [k, v] of await accountSums(companyId, fy.start_date, at)) m.set(k, (m.get(k) ?? 0) + Number(v));
  return m;
}

export async function capitalWarning(companyId: number, at = today()) {
  const [c] = await sql<{ t: string }[]>`SELECT company_type AS t FROM companies WHERE id = ${companyId}`;
  if (c?.t !== 'AB') return null;
  return warning(await balancesAt(companyId, at).catch(() => new Map()));
}

type Sheet = { id: number; date: string; share_capital: number; booked_equity: number; untaxed: number; adjustments: Adjustment[]; equity: number; deficit: boolean; audited_by: string;
  stage: string; first_meeting: string | null; second_meeting: string | null };

export async function overview(companyId: number, at = today()) {
  const e = equityFromBalances(await balancesAt(companyId, at));
  const now = controlBalance({ ...e, adjustments: [] });
  const sheets = await sql<Sheet[]>`SELECT id, to_char(date,'YYYY-MM-DD') AS date, share_capital::float8 AS share_capital, booked_equity::float8 AS booked_equity, untaxed::float8 AS untaxed, adjustments,
    equity::float8 AS equity, deficit, audited_by, stage, to_char(first_meeting,'YYYY-MM-DD') AS first_meeting, to_char(second_meeting,'YYYY-MM-DD') AS second_meeting
    FROM control_balance_sheets WHERE company_id = ${companyId} ORDER BY date DESC, id DESC`;
  const open = sheets.find((s) => s.deficit && ['drawn', 'first_meeting'].includes(s.stage)) ?? null;
  const [liq] = await sql<{ decided_on: string; liquidator: string; reason: string; registered_on: string | null; creditor_notice_on: string | null; final_report_on: string | null }[]>`
    SELECT to_char(decided_on,'YYYY-MM-DD') AS decided_on, liquidator, reason, to_char(registered_on,'YYYY-MM-DD') AS registered_on, to_char(creditor_notice_on,'YYYY-MM-DD') AS creditor_notice_on,
      to_char(final_report_on,'YYYY-MM-DD') AS final_report_on FROM liquidations WHERE company_id = ${companyId}`;
  return { at, ...e, now, sheets, open, deadline: open ? deadlines(open.first_meeting).second : null, liquidation: liq ?? null };
}

/** Styrelsen upprättar en kontrollbalansräkning (ska granskas av revisorn om bolaget har en) */
export async function draw(actor: Actor, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  let adjustments: Adjustment[];
  try { adjustments = parseAdjustments(String(input.adjustments ?? '')); } catch (e) { throw new ValidationError((e as Error).message); }
  const e = equityFromBalances(await balancesAt(actor.companyId, d));
  if (e.shareCapital <= 0) throw new ValidationError('Bolaget har inget registrerat aktiekapital på 2081');
  const c = controlBalance({ ...e, adjustments });
  const [r] = await sql<{ id: number }[]>`INSERT INTO control_balance_sheets ${sql({ company_id: actor.companyId, date: d, share_capital: e.shareCapital, booked_equity: e.equity, untaxed: e.untaxed,
    adjustments: sql.json(adjustments as never) as never, equity: c.equity, deficit: c.deficit, audited_by: str(input, 'audited_by', { max: 200 }), stage: c.deficit ? 'drawn' : 'restored', created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'control_balance', 'company', actor.companyId, { date: d, equity: c.equity, deficit: c.deficit });
  return { id: r.id, ...c };
}

/** Kontrollstämma: första (fortsatt drift eller likvidation) och andra inom åtta månader (kapitalet återställt eller likvidation) */
export async function meeting(actor: Actor, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Stämmans datum');
  const outcome = str(input, 'outcome');
  return sql.begin(async (tx) => {
    const [s] = await tx<{ id: number; stage: string; date: string; first: string | null }[]>`SELECT id, stage, to_char(date,'YYYY-MM-DD') AS date, to_char(first_meeting,'YYYY-MM-DD') AS first FROM control_balance_sheets
      WHERE company_id = ${actor.companyId} AND deficit AND stage IN ('drawn','first_meeting') ORDER BY date DESC, id DESC LIMIT 1 FOR UPDATE`;
    if (!s) throw new NotFoundError('En kontrollbalansräkning som visar kapitalbrist');
    if (d < s.date) throw new ValidationError('Stämman kan inte hållas före kontrollbalansräkningen');
    if (s.stage === 'drawn') {
      if (!['continue', 'liquidate'].includes(outcome)) throw new ValidationError('Välj stämmans beslut');
      await tx`UPDATE control_balance_sheets SET stage = ${outcome === 'liquidate' ? 'liquidation' : 'first_meeting'}, first_meeting = ${d} WHERE id = ${s.id}`;
      if (outcome === 'liquidate') await startLiquidationTx(tx, actor, { decided_on: d, liquidator: str(input, 'liquidator', { required: true, label: 'Likvidator', max: 200 }), reason: 'capital' });
      await auditBy(tx, actor, 'control_meeting_1', 'company', actor.companyId, { date: d, outcome });
      return { stage: outcome === 'liquidate' ? 'liquidation' : 'first_meeting', second: deadlines(d).second };
    }
    const second = deadlines(s.first).second!;
    if (d > second) throw new ValidationError(`Den andra kontrollstämman skulle ha hållits senast ${second}. Styrelsen ska nu ansöka om likvidation hos tingsrätten.`);
    // Kapitalet är återställt bara om en ny kontrollbalansräkning (upprättad efter första stämman) visar att det egna kapitalet täcker hela aktiekapitalet
    const [ok] = await tx<{ id: number }[]>`SELECT id FROM control_balance_sheets WHERE company_id = ${actor.companyId} AND id <> ${s.id} AND date >= ${s.first} AND date <= ${d}
      AND equity >= share_capital ORDER BY date DESC LIMIT 1`;
    if (outcome === 'restored' && !ok) throw new ValidationError('Upprätta först en ny kontrollbalansräkning som visar att det egna kapitalet uppgår till minst aktiekapitalet');
    if (!['restored', 'liquidate'].includes(outcome)) throw new ValidationError('Välj stämmans beslut');
    await tx`UPDATE control_balance_sheets SET stage = ${outcome === 'restored' ? 'restored' : 'liquidation'}, second_meeting = ${d} WHERE id = ${s.id}`;
    if (outcome === 'liquidate') await startLiquidationTx(tx, actor, { decided_on: d, liquidator: str(input, 'liquidator', { required: true, label: 'Likvidator', max: 200 }), reason: 'capital' });
    await auditBy(tx, actor, 'control_meeting_2', 'company', actor.companyId, { date: d, outcome });
    return { stage: outcome === 'restored' ? 'restored' : 'liquidation', second: null };
  });
}

async function startLiquidationTx(db: Tx, actor: Actor, l: { decided_on: string; liquidator: string; reason: 'voluntary' | 'capital' }) {
  const [dup] = await db`SELECT 1 FROM liquidations WHERE company_id = ${actor.companyId}`;
  if (dup) throw new ConflictError('Bolaget är redan i likvidation');
  await db`INSERT INTO liquidations ${db({ company_id: actor.companyId, decided_on: l.decided_on, liquidator: l.liquidator, reason: l.reason, created_by: actor.userId })}`;
}

export async function startLiquidation(actor: Actor, input: Record<string, unknown>) {
  const l = { decided_on: date(input, 'decided_on', 'Beslutsdatum'), liquidator: str(input, 'liquidator', { required: true, label: 'Likvidator', max: 200 }), reason: 'voluntary' as const };
  await sql.begin((tx) => startLiquidationTx(tx, actor, l));
  await auditBy(sql, actor, 'liquidation', 'company', actor.companyId, l);
}

const STEPS = ['registered_on', 'creditor_notice_on', 'final_report_on'] as const;
export async function liquidationStep(actor: Actor, input: Record<string, unknown>) {
  const step = str(input, 'step') as (typeof STEPS)[number];
  if (!STEPS.includes(step)) throw new ValidationError('Okänt steg');
  const d = date(input, 'date', 'Datum');
  const [l] = await sql<{ decided_on: string; creditor_notice_on: string | null }[]>`SELECT to_char(decided_on,'YYYY-MM-DD') AS decided_on, to_char(creditor_notice_on,'YYYY-MM-DD') AS creditor_notice_on FROM liquidations WHERE company_id = ${actor.companyId}`;
  if (!l) throw new NotFoundError('Likvidationen');
  if (d < l.decided_on) throw new ValidationError('Datumet ligger före likvidationsbeslutet');
  // Skifte får ske först när tiden i kallelsen på okända borgenärer har gått ut (sex månader efter kungörelsen)
  if (step === 'final_report_on') {
    if (!l.creditor_notice_on) throw new ValidationError('Kallelse på okända borgenärer ska ha kungjorts innan skifte och slutredovisning');
    const earliest = addMonths(l.creditor_notice_on, 6);
    if (d < earliest) throw new ValidationError(`Skifte kan ske tidigast ${earliest}, när tiden för okända borgenärer har gått ut`);
  }
  await sql`UPDATE liquidations SET ${sql({ [step]: d })} WHERE company_id = ${actor.companyId}`;
  await auditBy(sql, actor, 'liquidation_step', 'company', actor.companyId, { step, date: d });
}

/** Slutredovisning: nettotillgångar och skifte per aktieägare */
export async function finalReport(companyId: number, at = today()) {
  const b = await balancesAt(companyId, at);
  let assets = 0, liabilities = 0;
  for (const [n, v] of b) { if (n < 2000) assets += v; else if (n >= 2200 && n < 3000) liabilities -= v; }
  const owners = await sql<{ name: string; pct: number }[]>`SELECT name, share_pct::float8 AS pct FROM company_owners WHERE company_id = ${companyId} AND share_pct > 0 ORDER BY share_pct DESC, name`;
  const net = assets - liabilities;
  return { at, assets, liabilities, net, owners: distribution(net, owners) };
}

/** Skiftet bokförs: likvida medel betalas ut till ägarna efter ägarandel, och kapitalvinsten per ägare räknas fram (underlag för K10/K4) */
export async function bookDistribution(actor: Actor, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Skiftesdag');
  return sql.begin(async (tx) => {
    const [l] = await tx<{ decided_on: string; creditor_notice_on: string | null; distribution_voucher_id: number | null }[]>`SELECT to_char(decided_on,'YYYY-MM-DD') AS decided_on,
      to_char(creditor_notice_on,'YYYY-MM-DD') AS creditor_notice_on, distribution_voucher_id FROM liquidations WHERE company_id = ${actor.companyId} FOR UPDATE`;
    if (!l) throw new NotFoundError('Likvidationen');
    if (l.distribution_voucher_id) throw new ConflictError('Skiftet är redan bokfört');
    if (!l.creditor_notice_on) throw new ValidationError('Kallelse på okända borgenärer ska ha kungjorts innan skifte');
    const earliest = addMonths(l.creditor_notice_on, 6);
    if (d < earliest) throw new ValidationError(`Skifte kan ske tidigast ${earliest}, när tiden för okända borgenärer har gått ut`);
    let r: ReturnType<typeof distributionLines>;
    try { r = distributionLines(await balancesAt(actor.companyId, d)); } catch (e) { throw new ValidationError((e as Error).message); }
    const owners = await tx<{ id: number; name: string; pct: number; cost_basis: number }[]>`SELECT id, name, share_pct::float8 AS pct, cost_basis::float8 AS cost_basis FROM company_owners
      WHERE company_id = ${actor.companyId} AND share_pct > 0 ORDER BY share_pct DESC, name`;
    if (!owners.length) throw new ValidationError('Lägg upp aktieägarna under Ägare och utdelning före skiftet');
    const dist = distribution(r.net, owners);
    const v = await createVoucher(tx, { actor, date: d, description: 'Skifte vid likvidation, utbetalning till aktieägarna', lines: fromSigned(r.lines), sourceType: 'liquidation' });
    const rows = gains(dist.map((x, i) => ({ name: x.name, amount: x.amount, costBasis: Number(owners[i].cost_basis) })));
    for (const [i, x] of rows.entries()) await tx`INSERT INTO liquidation_payouts ${tx({ company_id: actor.companyId, owner_id: owners[i].id, name: x.name, amount: x.amount, cost_basis: x.costBasis, gain: x.gain })}`;
    await tx`UPDATE liquidations SET distribution_voucher_id = ${v.id}, final_report_on = COALESCE(final_report_on, ${d}::date) WHERE company_id = ${actor.companyId}`;
    await auditBy(tx, actor, 'liquidation_distribution', 'company', actor.companyId, { net: r.net });
    return { net: r.net, rows };
  });
}

export async function payouts(companyId: number) {
  return sql<{ name: string; amount: number; cost_basis: number; gain: number }[]>`SELECT name, amount::float8 AS amount, cost_basis::float8 AS cost_basis, gain::float8 AS gain FROM liquidation_payouts WHERE company_id = ${companyId} ORDER BY amount DESC, id`;
}
