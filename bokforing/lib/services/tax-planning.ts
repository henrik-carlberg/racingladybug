import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, createVoucher, fiscalYears, openingBalances } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { addDays, monthEnd, today } from '@/lib/format';
import { vatReport } from '@/lib/vat';
import { parseEskd, prelimProposal, taxForecast, vatReconcile, yearEndProposals, type Inventories, type TaxEvent } from '@/lib/tax-planning';
import type { Actor } from './actor';
import { companyDeadlines } from './deadlines';
import { yearStatus } from './yearend';
import { listAssets } from './assets';

const sumOf = (m: Map<number, number>, p: (n: number) => boolean) => [...m].reduce((s, [n, v]) => (p(n) ? s + v : s), 0);

export async function prelimMonthly(companyId: number) {
  return Number((await sql<{ m: number }[]>`SELECT prelim_monthly::bigint AS m FROM tax_settings WHERE company_id = ${companyId}`)[0]?.m ?? 0);
}

export async function savePrelim(actor: Actor, monthly: number) {
  if (!Number.isFinite(monthly) || monthly < 0 || monthly > 1e12) throw new ValidationError('Ange debiterad preliminärskatt per månad');
  await sql`INSERT INTO tax_settings (company_id, prelim_monthly) VALUES (${actor.companyId}, ${monthly})
    ON CONFLICT (company_id) DO UPDATE SET prelim_monthly = EXCLUDED.prelim_monthly, updated_at = now()`;
  await auditBy(sql, actor, 'prelim', 'tax_settings', actor.companyId, { monthly });
}

/** Skattekontot de kommande tre månaderna: saldo på 1630 och kommande moms, arbetsgivardeklarationer och F-skatt */
export async function taxAccountForecast(companyId: number) {
  const t = today(), to = addDays(t, 95);
  const balance = sumOf(await openingBalances(companyId, addDays(t, 1)), (n) => n === 1630);
  const monthly = await prelimMonthly(companyId);
  const events: TaxEvent[] = [];
  for (const d of await companyDeadlines(companyId, { from: t, to })) {
    if (d.status === 'done' && d.kind !== 'prelskatt') continue;
    if (d.kind === 'vat' && d.periodStart && d.periodEnd) {
      const { toPay } = vatReport(await accountSums(companyId, d.periodStart, d.periodEnd, { excludeVatSettlements: true }));
      if (toPay) events.push({ date: d.due, text: d.title, amount: -toPay });
    } else if (d.kind === 'agi') {
      const month = d.key.slice(4);
      const s = await accountSums(companyId, `${month}-01`, monthEnd(month));
      const owed = -sumOf(s, (n) => n === 2710 || (n >= 2730 && n <= 2731));
      if (owed > 0) events.push({ date: d.due, text: d.title, amount: -owed });
    } else if (d.kind === 'prelskatt' && monthly > 0) events.push({ date: d.due, text: d.title, amount: -monthly });
  }
  return { balance, monthly, ...taxForecast(balance, events) };
}

/** Prognos för årets skatt jämförd med debiterad preliminärskatt */
export async function prelimAdvice(companyId: number) {
  const t = today();
  const fy = (await fiscalYears(companyId)).find((y) => y.start_date <= t && y.end_date >= t);
  if (!fy) return null;
  const s = await yearStatus(companyId, fy.id);
  const months = (Number(t.slice(0, 4)) - Number(fy.start_date.slice(0, 4))) * 12 + Number(t.slice(5, 7)) - Number(fy.start_date.slice(5, 7)) + 1;
  const total = (Number(fy.end_date.slice(0, 4)) - Number(fy.start_date.slice(0, 4))) * 12 + Number(fy.end_date.slice(5, 7)) - Number(fy.start_date.slice(5, 7)) + 1;
  return { fy, months, ...prelimProposal({ type: s.companyType, ytdProfit: s.resultBeforeTax, nonDeductible: s.nonDeductible, monthsElapsed: months, monthsInYear: total, currentMonthly: await prelimMonthly(companyId) }) };
}

/** Bokslutsdispositioner för räkenskapsåret: förslag med förklaring och skatteeffekt, och de som redan är bokförda */
export async function appropriations(companyId: number, fyId: number, userId: number) {
  const s = await yearStatus(companyId, fyId);
  const fy = s.fy, year = Number(fy.end_date.slice(0, 4));
  const [ib, per] = await Promise.all([openingBalances(companyId, fy.start_date), accountSums(companyId, fy.start_date, fy.end_date)]);
  const booked = [...await sql<{ kind: string; amount: number; voucher_id: number | null }[]>`SELECT kind, amount::float8 AS amount, voucher_id FROM tax_appropriations WHERE fiscal_year_id = ${fyId} AND company_id = ${companyId}`];
  // Resultat före bokslutsdispositioner: bokförda dispositioner (88xx) räknas bort
  const resultBefore = -sumOf(per, (n) => n >= 3000 && n <= 8799);
  const invAcc = (n: number) => n >= 1210 && n <= 1259;
  const assets = (await listAssets(companyId, 'active')).filter((a) => ['maskiner', 'inventarier', 'bilar', 'datorer'].includes(a.category) && a.acquired_on <= fy.end_date);
  const inventories: Inventories = {
    bookStart: sumOf(ib, invAcc), overStart: -(ib.get(2150) ?? 0),
    acquisitions: Math.max(0, sumOf(per, (n) => invAcc(n) && n % 10 !== 9)), disposals: Math.max(0, -sumOf(per, (n) => invAcc(n) && n % 10 !== 9)),
    bookEnd: sumOf(ib, invAcc) + sumOf(per, invAcc), reserveNow: -((ib.get(2150) ?? 0) + (per.get(2150) ?? 0)),
    bookedDepreciation: sumOf(per, (n) => n >= 7831 && n <= 7835),
    byYear: assets.length ? assets.map((a) => ({ yearsHeld: year - Number(a.acquired_on.slice(0, 4)) + 1, cost: Number(a.cost) })) : undefined,
  };
  const fonds = [...Array(10).keys()].map((d) => {
    const account = 2120 + d, amount = -(ib.get(account) ?? 0);
    let y = year - 1; while (y % 10 !== d) y--;
    return { account, year: y, amount };
  }).filter((f) => f.amount > 0);
  // Koncernbolag (över 90 %) som användaren själv har tillgång till
  const group = s.companyType === 'AB' ? await groupResults(companyId, fy.end_date, userId) : [];
  const r = yearEndProposals({ type: s.companyType, year, resultBeforeAppropriations: resultBefore, nonDeductible: s.nonDeductible, inventories, fonds, group });
  return { status: s, resultBefore, ...r, booked, inventories };
}

async function groupResults(companyId: number, date: string, userId: number) {
  const links = await sql<{ other: number; name: string; ownership: number }[]>`
    SELECT CASE WHEN g.parent_company_id = ${companyId} THEN g.subsidiary_company_id ELSE g.parent_company_id END AS other, c.name, g.ownership::float8 AS ownership
    FROM group_links g JOIN companies c ON c.id = CASE WHEN g.parent_company_id = ${companyId} THEN g.subsidiary_company_id ELSE g.parent_company_id END
    JOIN memberships m ON m.company_id = c.id AND m.user_id = ${userId} AND (m.role = 'owner' OR (m.role = 'accountant' AND (m.permissions IS NULL OR 'ledger' = ANY(m.permissions))))
    WHERE (g.parent_company_id = ${companyId} OR g.subsidiary_company_id = ${companyId}) AND c.company_type = 'AB'`;
  const out: { name: string; result: number; ownership: number }[] = [];
  for (const l of links) {
    const fy = (await fiscalYears(l.other)).find((y) => y.start_date <= date && y.end_date >= date);
    if (!fy) continue;
    const s = await yearStatus(l.other, fy.id);
    out.push({ name: l.name, result: s.resultBeforeTax + s.nonDeductible, ownership: l.ownership });
  }
  return out;
}

const ACCOUNT_NAMES: Record<number, string> = { 8811: 'Avsättning till periodiseringsfond', 8819: 'Återföring från periodiseringsfond', 8830: 'Lämnade koncernbidrag',
  8853: 'Förändring av överavskrivningar, inventarier', 2150: 'Ackumulerade överavskrivningar', 2860: 'Kortfristiga skulder till koncernföretag' };

export async function bookAppropriation(actor: Actor, fyId: number, kind: string) {
  const a = await appropriations(actor.companyId, fyId, actor.userId);
  if (a.status.fy.closed) throw new ConflictError('Räkenskapsåret är stängt');
  const p = a.proposals.find((x) => x.kind === kind);
  if (!p) throw new NotFoundError('Förslaget');
  if (a.booked.some((b) => b.kind === kind)) throw new ConflictError('Dispositionen är redan bokförd');
  return sql.begin(async (tx) => {
    for (const l of p.lines) {
      const name = ACCOUNT_NAMES[l.account] ?? (l.account >= 2120 && l.account <= 2129 ? `Periodiseringsfond ${l.account}` : null);
      if (name) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${l.account}, ${name}) ON CONFLICT DO NOTHING`;
    }
    const v = await createVoucher(tx, { actor, date: a.status.fy.end_date, description: p.title, lines: fromSigned(p.lines), sourceType: 'yearend' });
    await tx`INSERT INTO tax_appropriations (company_id, fiscal_year_id, kind, amount, voucher_id, created_by) VALUES (${actor.companyId}, ${fyId}, ${kind}, ${p.amount}, ${v.id}, ${actor.userId})`;
    await auditBy(tx, actor, 'appropriation', 'fiscal_year', fyId, { kind, amount: p.amount });
    return v.id;
  });
}

/** Momsdeklarationen ruta för ruta: rimlighetskontroller och jämförelse med den inlämnade deklarationen */
export async function vatChecks(companyId: number, from: string, to: string) {
  const { boxes } = vatReport(await accountSums(companyId, from, to, { excludeVatSettlements: true }));
  const [f] = await sql<{ payload: string; status: string }[]>`SELECT payload, status FROM filings WHERE company_id = ${companyId} AND kind = 'moms'
    AND period = ${`${from}:${to}`} AND status IN ('submitted','accepted') ORDER BY id DESC LIMIT 1`;
  return { checks: vatReconcile(new Map(boxes.map((b) => [b.box, b.amount])), f ? parseEskd(f.payload) : null), filed: !!f };
}
