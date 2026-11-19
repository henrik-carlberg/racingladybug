import 'server-only';
import { sql } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { mailConfigured, sendMail } from '@/lib/server/mail';
import { formatAmount } from '@/lib/money';
import { today as todayFn } from '@/lib/format';
import { workbook } from '@/lib/xlsx';
import type { Actor } from './actor';
import { rrbrSheets } from './xlsx-reports';
import { statements, type Compare } from './statements';

export async function listSchedules(companyId: number) {
  return [...await sql<{ id: number; recipients: string[]; day: number; compare: Compare; last_sent: string | null }[]>`
    SELECT id, recipients, day, compare, to_char(last_sent,'YYYY-MM-DD') AS last_sent FROM report_schedules WHERE company_id = ${companyId} ORDER BY id`];
}

export async function createSchedule(actor: Actor, input: { recipients: string; day: number; compare: string }) {
  const list = input.recipients.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!list.length || list.length > 5) throw new ValidationError('Ange en till fem e-postadresser');
  for (const e of list) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new ValidationError(`Ogiltig e-postadress: ${e}`);
  if (!(input.day >= 1 && input.day <= 28)) throw new ValidationError('Välj en dag mellan 1 och 28');
  const compare = ['none', 'fjol', 'budget'].includes(input.compare) ? input.compare : 'fjol';
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM report_schedules WHERE company_id = ${actor.companyId}`;
  if (n >= 10) throw new ValidationError('Högst tio schemalagda utskick');
  const [r] = await sql<{ id: number }[]>`INSERT INTO report_schedules (company_id, created_by, recipients, day, compare) VALUES (${actor.companyId}, ${actor.userId}, ${list}, ${input.day}, ${compare}) RETURNING id`;
  await auditBy(sql, actor, 'create', 'report_schedule', r.id, { recipients: list.length });
  return r.id;
}

export async function deleteSchedule(actor: Actor, id: number) {
  await sql`DELETE FROM report_schedules WHERE id = ${id} AND company_id = ${actor.companyId}`;
}

/** Perioden som skickas: räkenskapsårets början till och med sista dagen förra månaden */
function lastMonthEnd(today: string) {
  const d = new Date(today.slice(0, 8) + '01T00:00:00Z');
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

export async function buildReport(companyId: number, compare: Compare, today = todayFn()) {
  const to = lastMonthEnd(today);
  const r = await rrbrSheets(companyId, { to, compare });
  if (!r) return null;
  const [c] = await sql<{ name: string }[]>`SELECT name FROM companies WHERE id = ${companyId}`;
  const st = await statements(companyId, { to, compare });
  const k = st ? {
    from: st.from,
    sales: st.income.groups.find((g) => g.label === 'Nettoomsättning')?.total ?? 0,
    result: st.income.result,
    cash: [...st.ub].filter(([n]) => n >= 1900 && n <= 1999).reduce((x, [, v]) => x + v, 0),
  } : null;
  const kr = (o: number) => formatAmount(Number(o)) + ' kr';
  const subject = `${c.name}: resultat och balans till och med ${to}`;
  const text = [`Hej!`, '', `Här är ${c.name}s resultat- och balansräkning för perioden ${k?.from ?? ''} – ${to} (bifogad som Excel).`, '',
    `Nettoomsättning: ${kr(k?.sales ?? 0)}`, `Resultat: ${kr(k?.result ?? 0)}`, `Kassa och bank: ${kr(k?.cash ?? 0)}`, '', 'Rapporten skickas automatiskt från bokföringen.'].join('\n');
  return { subject, text, attachment: { filename: `${r.name}.xlsx`, content: workbook(r.sheets) } };
}

/** Skickar ett utskick nu (knappen "Skicka nu" och den dagliga körningen) */
export async function sendSchedule(companyId: number, id: number, today = todayFn()) {
  const [s] = await sql<{ recipients: string[]; compare: Compare }[]>`SELECT recipients, compare FROM report_schedules WHERE id = ${id} AND company_id = ${companyId}`;
  if (!s) return { sent: 0 };
  const rep = await buildReport(companyId, s.compare, today);
  if (!rep) return { sent: 0 };
  let sent = 0;
  for (const to of s.recipients) if (await sendMail(to, rep.subject, rep.text, [rep.attachment])) sent++;
  if (sent) await sql`UPDATE report_schedules SET last_sent = ${today} WHERE id = ${id}`;
  return { sent };
}

/** Daglig körning: utskick vars dag är i dag och som inte redan har skickats i dag */
export async function runDueSchedules(today = todayFn()) {
  const day = Number(today.slice(8, 10));
  // Skickas bara så länge den som skapade utskicket fortfarande har tillgång till bokföringen
  const due = await sql<{ id: number; company_id: number }[]>`
    SELECT s.id, s.company_id FROM report_schedules s WHERE s.day = ${day} AND (s.last_sent IS NULL OR s.last_sent < ${today})
      AND (EXISTS (SELECT 1 FROM memberships m WHERE m.company_id = s.company_id AND m.user_id = s.created_by AND m.role IN ('owner','accountant')
                     AND (m.role = 'owner' OR m.permissions IS NULL OR 'ledger' = ANY(m.permissions)))
        OR EXISTS (SELECT 1 FROM firm_members fm JOIN firm_clients fc ON fc.firm_id = fm.firm_id WHERE fc.company_id = s.company_id AND fm.user_id = s.created_by))`;
  let sent = 0;
  if (mailConfigured()) for (const d of due) sent += (await sendSchedule(d.company_id, d.id, today)).sent;
  return { due: due.length, sent };
}
