import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { today } from '@/lib/format';
import { isModuleEnabled } from '@/lib/modules/enabled';
import { addDaysIso, isWheelModule, occurrences, type Recurrence, type WheelItem, type WheelModule } from '@/lib/wheel';
import type { Actor } from './actor';
import { companyDeadlines, markDeadline } from './deadlines';

const DEADLINE_MODULE: Record<string, WheelModule> = { vat: 'skatt', agi: 'skatt', prelskatt: 'skatt', ink1: 'skatt', ink2: 'skatt', bokslut: 'bokslut', arsredovisning: 'bokslut', arsstamma: 'bokslut' };
const DEADLINE_KEY = /^(vat|agi|prel|ink1|ink2|ne|bokslut|arsredovisning|arsstamma):/;
const months = (from: string, to: string) => { const out: string[] = []; for (let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)); `${y}-${String(m).padStart(2, '0')}` <= to.slice(0, 7); m === 12 ? (y++, (m = 1)) : m++) out.push(`${y}-${String(m).padStart(2, '0')}`); return out; };

export interface Activity { id: number; module: WheelModule; title: string; description: string; recurrence: Recurrence; day: number | null; month: number | null; start_date: string; end_date: string | null; owner_user_id: number | null; owner: string | null; remind_days: number }
export async function listActivities(companyId: number) {
  return [...await sql<Activity[]>`SELECT a.id, a.module, a.title, a.description, a.recurrence, a.day, a.month, to_char(a.start_date,'YYYY-MM-DD') AS start_date, to_char(a.end_date,'YYYY-MM-DD') AS end_date,
    a.owner_user_id, u.name AS owner, a.remind_days FROM wheel_activities a LEFT JOIN users u ON u.id = a.owner_user_id WHERE a.company_id = ${companyId} ORDER BY a.module, a.title`];
}

export async function saveActivity(actor: Actor, input: Record<string, string>) {
  const title = (input.title ?? '').trim().slice(0, 140);
  if (!title) throw new ValidationError('Ange vad som ska göras');
  const module = input.module ?? 'allmant';
  if (!isWheelModule(module)) throw new ValidationError('Välj modul');
  const recurrence = input.recurrence as Recurrence;
  if (!['once', 'weekly', 'monthly', 'quarterly', 'yearly'].includes(recurrence)) throw new ValidationError('Välj hur ofta');
  const start = (input.start_date ?? '').trim() || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new ValidationError('Ogiltigt startdatum');
  const end = (input.end_date ?? '').trim() || null;
  if (end && (!/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start)) throw new ValidationError('Slutdatumet ska vara efter startdatumet');
  const num = (v: string | undefined, lo: number, hi: number, label: string) => { if (!v?.trim()) return null; const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) throw new ValidationError(`Ogiltig ${label}`); return n; };
  let day = num(input.day, 1, 31, 'dag');
  const month = recurrence === 'quarterly' ? num(input.month, 1, 3, 'månad i kvartalet') : recurrence === 'yearly' ? num(input.month, 1, 12, 'månad') : null;
  if (recurrence === 'weekly') day = num(input.day, 1, 7, 'veckodag') ?? 1;
  const remind = num(input.remind_days, 0, 60, 'påminnelse') ?? 3;
  const owner = num(input.owner_user_id, 1, 2 ** 31 - 1, 'ansvarig');
  if (owner) { const [m] = await sql`SELECT 1 FROM memberships WHERE company_id = ${actor.companyId} AND user_id = ${owner}`; if (!m) throw new ValidationError('Den ansvarige är inte användare i bolaget'); }
  const f = { module, title, description: (input.description ?? '').trim().slice(0, 1000), recurrence, day, month, start_date: start, end_date: end, owner_user_id: owner, remind_days: remind };
  const id = Number(input.id) || null;
  if (id) {
    const r = await sql`UPDATE wheel_activities SET ${sql(f)} WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
    if (!r.length) throw new NotFoundError('Aktiviteten');
    await auditBy(sql, actor, 'update', 'wheel_activity', id);
    return id;
  }
  const [r] = await sql<{ id: number }[]>`INSERT INTO wheel_activities ${sql({ ...f, company_id: actor.companyId, created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'wheel_activity', r.id, { title });
  return r.id;
}

export async function deleteActivity(actor: Actor, id: number) {
  const r = await sql`DELETE FROM wheel_activities WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Aktiviteten');
  await sql`DELETE FROM wheel_done WHERE company_id = ${actor.companyId} AND key LIKE ${`egen:${id}:%`}`;
  await auditBy(sql, actor, 'delete', 'wheel_activity', id);
}

/** Bockar av (eller ångrar) ett tillfälle. Deadlines bockas av i deadlinelistan så att båda vyerna stämmer. */
export async function markItem(actor: Actor, key: string, done: boolean) {
  if (!/^[a-z0-9:_-]{3,80}$/.test(key)) throw new ValidationError('Ogiltig aktivitet');
  if (DEADLINE_KEY.test(key)) { if (key.length > 60) throw new ValidationError('Ogiltig aktivitet'); return markDeadline(actor, key, done); }
  if (done) await sql`INSERT INTO wheel_done (company_id, key, done_by) VALUES (${actor.companyId}, ${key}, ${actor.userId}) ON CONFLICT DO NOTHING`;
  else await sql`DELETE FROM wheel_done WHERE company_id = ${actor.companyId} AND key = ${key}`;
  await auditBy(sql, actor, done ? 'complete' : 'reopen', 'wheel_item', null, { key });
}

/** Alla aktiviteter i perioden: hämtade från modulerna och egna återkommande. */
export async function wheelItems(companyId: number, from: string, to: string): Promise<WheelItem[]> {
  const b = `/c/${companyId}`;
  const done = new Set((await sql<{ key: string }[]>`SELECT key FROM wheel_done WHERE company_id = ${companyId}`).map((r) => r.key));
  const items: WheelItem[] = [];
  // Genererade månadsaktiviteter visas inte för tiden innan bolaget lades upp i appen (de har skötts på annat sätt)
  const [co] = await sql<{ created: string }[]>`SELECT to_char(created_at,'YYYY-MM-DD') AS created FROM companies WHERE id = ${companyId}`;
  const push = (i: Omit<WheelItem, 'done' | 'own'> & { done?: boolean; own?: boolean }, generated = false) => {
    if (generated && i.date < co.created && !i.done && !done.has(i.key)) return;
    items.push({ own: false, ...i, done: !!i.done || done.has(i.key) });
  };

  // Skatter, deklarationer och bokslut (samma som deadlinelistan)
  for (const d of await companyDeadlines(companyId, { from: addDaysIso(from, -1), to })) {
    if (d.due < from || d.due > to) continue;
    push({ key: d.key, date: d.due, module: DEADLINE_MODULE[d.kind] ?? 'skatt', title: d.title, href: d.href, done: d.status === 'done' });
  }
  // Lön: lönekörning varje månad (dag som senaste utbetalningen, annars den 25:e)
  const [emp] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employees WHERE company_id = ${companyId} AND active`;
  if (emp.n) {
    const runs = await sql<{ period: string; status: string; id: number; day: number }[]>`SELECT period, status, id, extract(day FROM payment_date)::int AS day FROM payroll_runs WHERE company_id = ${companyId} ORDER BY period DESC`;
    const day = runs[0]?.day ?? 25;
    const byPeriod = new Map(runs.map((r) => [r.period, r]));
    const [pen] = await sql<{ itp: number; saf: number }[]>`SELECT count(*) FILTER (WHERE pension_plan IN ('itp1','itp2'))::int AS itp, count(*) FILTER (WHERE pension_plan = 'saf_lo')::int AS saf FROM employees WHERE company_id = ${companyId} AND active`;
    for (const p of months(from, to)) {
      const r = byPeriod.get(p);
      const date = `${p}-${String(Math.min(day, 28)).padStart(2, '0')}`;
      if (date >= from && date <= to) push({ key: `lon:${p}`, date, module: 'lon', title: `Lönekörning ${p}`, href: r ? `${b}/lon/${r.id}` : `${b}/lon`, done: r?.status === 'booked' }, true);
      if (pen.itp || pen.saf) {
        const d2 = addDaysIso(`${p}-01`, 40).slice(0, 7) + '-05';
        if (d2 >= from && d2 <= to) push({ key: `pension:${p}`, date: d2, module: 'lon', title: `Rapportera ${[pen.itp && 'Collectum', pen.saf && 'Fora'].filter(Boolean).join(' och ')} för ${p}`, href: r ? `${b}/lon/${r.id}/pension` : `${b}/lon` }, true);
      }
    }
  }
  // Bokföring: avskrivningar och periodiseringar varje månad, valutaomvärdering och inventering vid årets slut
  const [flags] = await sql<{ assets: number; accruals: number; fx: number }[]>`SELECT
    (SELECT count(*)::int FROM assets WHERE company_id = ${companyId} AND status = 'active') AS assets,
    (SELECT count(*)::int FROM accruals WHERE company_id = ${companyId}) AS accruals,
    (SELECT count(*)::int FROM bank_accounts WHERE company_id = ${companyId} AND currency <> 'SEK') + (SELECT count(*)::int FROM invoices WHERE company_id = ${companyId} AND currency <> 'SEK' AND status = 'booked') AS fx`;
  for (const p of months(from, to)) {
    const end = new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).toISOString().slice(0, 10);
    if (end < from || end > to) continue;
    if (flags.assets) push({ key: `avskr:${p}`, date: end, module: 'bokslut', title: `Bokför avskrivningar ${p}`, href: `${b}/anlaggningar` }, true);
    if (flags.accruals) push({ key: `period:${p}`, date: end, module: 'bokslut', title: `Bokför periodiseringar ${p}`, href: `${b}/periodiseringar` }, true);
  }
  const lager = await isModuleEnabled(companyId, 'lager');
  for (const fy of await sql<{ end: string }[]>`SELECT to_char(end_date,'YYYY-MM-DD') AS end FROM fiscal_years WHERE company_id = ${companyId} AND end_date BETWEEN ${from} AND ${to}`) {
    if (flags.fx) push({ key: `fx:${fy.end}`, date: fy.end, module: 'bokslut', title: 'Omvärdera valuta till balansdagens kurs', href: `${b}/bokslut/valuta?datum=${fy.end}`, done: !!(await sql`SELECT 1 FROM vouchers WHERE company_id = ${companyId} AND source_type = 'fx_revaluation' AND date = ${fy.end}`).length });
    if (lager) push({ key: `inventering:${fy.end}`, date: fy.end, module: 'bokslut', title: 'Inventera lagret', href: `${b}/m/lager` });
  }
  // Avtal: fakturering per period och sista dag för uppsägning
  if (await isModuleEnabled(companyId, 'avtal')) {
    const cs = await sql<{ id: number; name: string; start: string; end: string | null; interval: number; next: string; notice: number; in_advance: boolean }[]>`
      SELECT id, name, to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS "end", interval_months AS interval, to_char(next_period_start,'YYYY-MM-DD') AS next, notice_months AS notice, in_advance
      FROM avt_contracts WHERE company_id = ${companyId} AND status = 'active'`;
    for (const c of cs) {
      for (const d of occurrences({ recurrence: c.interval === 12 ? 'yearly' : c.interval === 1 ? 'monthly' : 'quarterly', startDate: c.start, endDate: c.end, day: Number(c.start.slice(8, 10)), month: c.interval === 12 ? Number(c.start.slice(5, 7)) : ((Number(c.start.slice(5, 7)) - 1) % 3) + 1 }, from, to)) {
        if (c.interval === 6 && (Number(d.slice(5, 7)) - Number(c.start.slice(5, 7)) + 12) % 6 !== 0) continue;
        push({ key: `avtal:${c.id}:${d}`, date: d, module: 'avtal', title: `Fakturera ${c.name}`, href: `${b}/m/avtal/${c.id}`, done: d < c.next });
      }
      if (c.end) {
        const last = new Date(Date.UTC(Number(c.end.slice(0, 4)), Number(c.end.slice(5, 7)) - 1 - c.notice, Number(c.end.slice(8, 10)))).toISOString().slice(0, 10);
        if (last >= from && last <= to) push({ key: `avtal-uppsagning:${c.id}`, date: last, module: 'avtal', title: `Sista dag att säga upp eller förnya ${c.name}`, href: `${b}/m/avtal/${c.id}` });
      }
    }
  }
  if (await isModuleEnabled(companyId, 'lonerevision'))
    for (const r of await sql<{ id: number; name: string; date: string; status: string }[]>`SELECT id, name, to_char(effective_date,'YYYY-MM-DD') AS date, status FROM salary_reviews WHERE company_id = ${companyId} AND status <> 'cancelled' AND effective_date BETWEEN ${from} AND ${to}`)
      push({ key: `lonerevision:${r.id}`, date: r.date, module: 'lonerevision', title: `${r.name}: nya löner gäller`, href: `${b}/m/lonerevision`, done: r.status === 'applied' });
  if (await isModuleEnabled(companyId, 'marknad'))
    for (const c of await sql<{ id: number; name: string; start: string; end: string | null; status: string }[]>`SELECT id, name, to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS "end", status FROM mkt_campaigns WHERE company_id = ${companyId} AND (start_date BETWEEN ${from} AND ${to} OR end_date BETWEEN ${from} AND ${to})`) {
      if (c.start >= from && c.start <= to) push({ key: `kampanj-start:${c.id}`, date: c.start, module: 'marknad', title: `Kampanjen ${c.name} startar`, href: `${b}/m/marknad`, done: c.status !== 'planned' });
      if (c.end && c.end >= from && c.end <= to) push({ key: `kampanj-slut:${c.id}`, date: c.end, module: 'marknad', title: `Kampanjen ${c.name} slutar – följ upp`, href: `${b}/m/marknad`, done: c.status === 'done' });
    }
  if (await isModuleEnabled(companyId, 'projekt'))
    for (const m of await sql<{ id: number; name: string; project: string; project_id: number; date: string; done: boolean }[]>`SELECT m.id, m.name, p.name AS project, p.id AS project_id, to_char(m.due_date,'YYYY-MM-DD') AS date, m.done FROM proj_milestones m JOIN projects p ON p.id = m.project_id WHERE p.company_id = ${companyId} AND m.due_date BETWEEN ${from} AND ${to}`)
      push({ key: `delmoment:${m.id}`, date: m.date, module: 'projekt', title: `${m.project}: ${m.name}`, href: `${b}/m/projekt/${m.project_id}`, done: m.done });

  // Egna återkommande aktiviteter
  for (const a of await listActivities(companyId))
    for (const d of occurrences({ recurrence: a.recurrence, startDate: a.start_date, endDate: a.end_date, day: a.day, month: a.month }, from, to))
      push({ key: `egen:${a.id}:${d}`, date: d, module: a.module, title: a.title, own: true, owner: a.owner });

  return items.sort((x, y) => x.date.localeCompare(y.date) || x.module.localeCompare(y.module));
}

// ---------- Kalenderlänk (iCal) ----------
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
export async function calendarToken(actor: Actor) {
  const token = randomBytes(24).toString('base64url');
  await sql`INSERT INTO calendar_tokens (token_hash, user_id, company_id) VALUES (${hash(token)}, ${actor.userId}, ${actor.companyId})
    ON CONFLICT (user_id, company_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now()`;
  await auditBy(sql, actor, 'create', 'calendar_token', null);
  return token;
}
export async function hasCalendarToken(userId: number, companyId: number) {
  return (await sql`SELECT 1 FROM calendar_tokens WHERE user_id = ${userId} AND company_id = ${companyId}`).length > 0;
}
/** Tokenen gäller bara så länge användaren är kvar i bolaget */
export async function companyForCalendar(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [r] = await sql<{ company_id: number; name: string }[]>`SELECT t.company_id, c.name FROM calendar_tokens t JOIN companies c ON c.id = t.company_id
    JOIN memberships m ON m.company_id = t.company_id AND m.user_id = t.user_id WHERE t.token_hash = ${hash(token)} AND m.role IN ('owner','accountant','auditor')`;
  return r ?? null;
}

// ---------- Påminnelser (cron) ----------
export async function sendWheelReminders() {
  const { sendToUsers } = await import('./push');
  const t = today();
  const acts = await sql<{ id: number; company_id: number; title: string; recurrence: Recurrence; day: number | null; month: number | null; start: string; end: string | null; owner: number | null; remind_days: number }[]>`
    SELECT id, company_id, title, recurrence, day, month, to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS "end", owner_user_id AS owner, remind_days
    FROM wheel_activities WHERE owner_user_id IS NOT NULL`;
  let n = 0;
  for (const a of acts) {
    const due = addDaysIso(t, a.remind_days);
    for (const d of occurrences({ recurrence: a.recurrence, startDate: a.start, endDate: a.end, day: a.day, month: a.month }, due, due)) {
      const key = `egen:${a.id}:${d}`;
      const [already] = await sql`SELECT 1 FROM wheel_done WHERE company_id = ${a.company_id} AND key = ${key}`;
      if (already) continue;
      const [ins] = await sql`INSERT INTO wheel_reminders (company_id, key) VALUES (${a.company_id}, ${key}) ON CONFLICT DO NOTHING RETURNING 1`;
      if (!ins) continue;
      n++;
      await sendToUsers([a.owner!], 'deadline', { title: a.remind_days ? `Om ${a.remind_days} dagar: ${a.title}` : `I dag: ${a.title}`, body: `Årshjulet ${d}`, url: `/c/${a.company_id}/arshjul?vy=lista` }).catch(() => 0);
    }
  }
  return n;
}
