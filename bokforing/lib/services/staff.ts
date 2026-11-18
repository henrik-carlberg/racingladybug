import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { normalizePersonalNumber } from '@/lib/validate';
import type { Actor } from './actor';

const TZ = 'Europe/Stockholm';
/** "2026-11-18T08:30" (svensk tid) → timestamptz-uttryck */
const local = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) throw new ValidationError('Ange datum och tid');
  return sql`(${s}::timestamp AT TIME ZONE ${TZ})`;
};
const fmt = (col: string) => sql`to_char(${sql.unsafe(col)} AT TIME ZONE ${TZ}, 'YYYY-MM-DD"T"HH24:MI')`;

// ---------- Arbetsplatser ----------

export interface Site { id: number; name: string; address: string; kiosk_token: string; active: boolean; kind: 'general' | 'construction'; site_ref: string }
export async function listSites(companyId: number, activeOnly = false): Promise<Site[]> {
  return [...await sql<Site[]>`SELECT id, name, address, kiosk_token, active, kind, site_ref FROM work_sites WHERE company_id = ${companyId} ${activeOnly ? sql`AND active` : sql``} ORDER BY name`];
}
export async function createSite(actor: Actor, name: string, address: string, opts: { construction?: boolean; siteRef?: string } = {}) {
  if (!name.trim()) throw new ValidationError('Ange arbetsplatsens namn');
  const ref = (opts.siteRef ?? '').trim().toUpperCase();
  if (opts.construction && !/^[A-Z0-9-]{6,20}$/.test(ref)) throw new ValidationError('Ange byggarbetsplatsens ID från Skatteverket (byggherren anmäler byggarbetsplatsen)');
  const [r] = await sql<{ id: number }[]>`INSERT INTO work_sites (company_id, name, address, kiosk_token, kind, site_ref) VALUES (${actor.companyId}, ${name.trim()}, ${address.trim()}, ${randomBytes(18).toString('base64url')}, ${opts.construction ? 'construction' : 'general'}, ${ref}) RETURNING id`;
  await auditBy(sql, actor, 'create', 'work_site', r.id);
  return r.id;
}
export async function newKioskToken(actor: Actor, id: number) {
  await sql`UPDATE work_sites SET kiosk_token = ${randomBytes(18).toString('base64url')} WHERE id = ${id} AND company_id = ${actor.companyId}`;
}

// ---------- Schema ----------

export interface Shift { id: number; employee_id: number; employee: string; site_id: number | null; site: string | null; starts_at: string; ends_at: string; role: string; note: string; minutes: number }

export async function listShifts(companyId: number, from: string, to: string, employeeId?: number): Promise<Shift[]> {
  return [...await sql<Shift[]>`
    SELECT s.id, s.employee_id, e.first_name || ' ' || e.last_name AS employee, s.site_id, w.name AS site, ${fmt('s.starts_at')} AS starts_at, ${fmt('s.ends_at')} AS ends_at,
      s.role, s.note, (extract(epoch FROM s.ends_at - s.starts_at) / 60)::int AS minutes
    FROM shifts s JOIN employees e ON e.id = s.employee_id LEFT JOIN work_sites w ON w.id = s.site_id
    WHERE s.company_id = ${companyId} AND s.starts_at >= (${from}::date::timestamp AT TIME ZONE ${TZ}) AND s.starts_at < ((${to}::date + 1)::timestamp AT TIME ZONE ${TZ})
      ${employeeId ? sql`AND s.employee_id = ${employeeId}` : sql``}
    ORDER BY s.starts_at`];
}

export async function createShift(actor: Actor, input: { employee_id: number; date: string; start: string; end: string; site_id?: number | null; role?: string; note?: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.start) || !/^\d{2}:\d{2}$/.test(input.end)) throw new ValidationError('Ange datum, start och slut');
  const [e] = await sql`SELECT 1 FROM employees WHERE id = ${input.employee_id} AND company_id = ${actor.companyId}`;
  if (!e) throw new ValidationError('Välj anställd');
  // Pass som slutar före start går över midnatt
  const endDate = input.end <= input.start ? sql`(${input.date}::date + 1)` : sql`${input.date}::date`;
  const [overlap] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM shifts WHERE employee_id = ${input.employee_id}
      AND starts_at < ((${endDate} + ${input.end}::time)::timestamp AT TIME ZONE ${TZ}) AND ends_at > ((${input.date}::date + ${input.start}::time)::timestamp AT TIME ZONE ${TZ})`;
  if (overlap.n) throw new ConflictError('Den anställda har redan ett pass som överlappar');
  const [r] = await sql<{ id: number }[]>`
    INSERT INTO shifts (company_id, employee_id, site_id, starts_at, ends_at, role, note, created_by)
    VALUES (${actor.companyId}, ${input.employee_id}, ${input.site_id ?? null}, ((${input.date}::date + ${input.start}::time)::timestamp AT TIME ZONE ${TZ}),
      ((${endDate} + ${input.end}::time)::timestamp AT TIME ZONE ${TZ}), ${input.role ?? ''}, ${input.note ?? ''}, ${actor.userId}) RETURNING id`;
  return r.id;
}

export async function deleteShift(actor: Actor, id: number) {
  const r = await sql`DELETE FROM shifts WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!r.count) throw new NotFoundError('Passet');
}

/** Kopierar förra veckans pass till veckan som börjar weekStart (hoppar över pass som skulle överlappa) */
export async function copyWeek(actor: Actor, weekStart: string) {
  const r = await sql`
    INSERT INTO shifts (company_id, employee_id, site_id, starts_at, ends_at, role, note, created_by)
    SELECT s.company_id, s.employee_id, s.site_id, s.starts_at + interval '7 days', s.ends_at + interval '7 days', s.role, s.note, ${actor.userId}
    FROM shifts s WHERE s.company_id = ${actor.companyId}
      AND s.starts_at >= ((${weekStart}::date - 7)::timestamp AT TIME ZONE ${TZ}) AND s.starts_at < (${weekStart}::date::timestamp AT TIME ZONE ${TZ})
      AND NOT EXISTS (SELECT 1 FROM shifts x WHERE x.employee_id = s.employee_id AND x.starts_at < s.ends_at + interval '7 days' AND x.ends_at > s.starts_at + interval '7 days')`;
  return r.count;
}

// ---------- Personalliggare ----------

export interface LogEntry {
  id: number; site_id: number; site: string; site_ref: string; id06: string; employee_id: number | null; person_name: string; personal_number: string;
  check_in: string; check_out: string | null; source: string; changes: { field: string; old_value: string; new_value: string; reason: string; by: string | null; at: string }[];
}

export async function listLog(companyId: number, f: { siteId?: number; date?: string; open?: boolean }): Promise<LogEntry[]> {
  return [...await sql<LogEntry[]>`
    SELECT l.id, l.site_id, w.name AS site, w.site_ref, l.id06, l.employee_id, l.person_name, l.personal_number, ${fmt('l.check_in')} AS check_in,
      CASE WHEN l.check_out IS NULL THEN NULL ELSE ${fmt('l.check_out')} END AS check_out, l.source,
      COALESCE((SELECT json_agg(json_build_object('field', c.field, 'old_value', c.old_value, 'new_value', c.new_value, 'reason', c.reason, 'by', u.name,
        'at', to_char(c.changed_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD HH24:MI')) ORDER BY c.id) FROM staff_log_changes c LEFT JOIN users u ON u.id = c.changed_by WHERE c.log_id = l.id), '[]') AS changes
    FROM staff_log l JOIN work_sites w ON w.id = l.site_id
    WHERE l.company_id = ${companyId} ${f.siteId ? sql`AND l.site_id = ${f.siteId}` : sql``}
      ${f.date ? sql`AND (l.check_in AT TIME ZONE ${TZ})::date = ${f.date}::date` : sql``} ${f.open ? sql`AND l.check_out IS NULL` : sql``}
    ORDER BY l.check_in DESC LIMIT 500`];
}

/**
 * Stämplar in eller ut. Har personen ett öppet pass på arbetsplatsen stämplas hen ut, annars in.
 * Anställda identifieras med personnummer; andra verksamma (ägare, inhyrda) anger namn och personnummer.
 */
export async function stamp(companyId: number, siteId: number, who: { personalNumber: string; name?: string; id06?: string }, source: 'self' | 'kiosk' | 'manager', userId: number | null) {
  const pnr = normalizePersonalNumber(who.personalNumber);
  if (!pnr) throw new ValidationError('Ogiltigt personnummer');
  const [site] = await sql<{ kind: string }[]>`SELECT kind FROM work_sites WHERE id = ${siteId} AND company_id = ${companyId} AND active`;
  if (!site) throw new ValidationError('Välj arbetsplats');
  const [emp] = await sql<{ id: number; name: string; id06: string }[]>`SELECT id, first_name || ' ' || last_name AS name, id06 FROM employees WHERE company_id = ${companyId} AND personal_number = ${pnr} AND active`;
  const name = emp?.name ?? who.name?.trim();
  if (!name) throw new ValidationError('Personnumret finns inte bland de anställda – ange även namn');
  return sql.begin(async (tx) => {
    const [open] = await tx<{ id: number }[]>`SELECT id FROM staff_log WHERE company_id = ${companyId} AND site_id = ${siteId} AND personal_number = ${pnr} AND check_out IS NULL FOR UPDATE`;
    if (open) {
      await tx`UPDATE staff_log SET check_out = now() WHERE id = ${open.id}`;
      return { action: 'out' as const, name };
    }
    // På byggarbetsplatser registreras ID06-kortet (krav i personalliggaren för byggbranschen)
    const id06 = (emp?.id06 || who.id06 || '').trim();
    if (site.kind === 'construction' && !id06) throw new ValidationError('Ange ID06-kortets nummer – krävs på byggarbetsplatser');
    await tx`INSERT INTO staff_log (company_id, site_id, employee_id, person_name, personal_number, check_in, source, created_by, id06)
      VALUES (${companyId}, ${siteId}, ${emp?.id ?? null}, ${name}, ${pnr}, now(), ${source}, ${userId}, ${id06})`;
    return { action: 'in' as const, name };
  });
}

export async function siteByKiosk(token: string) {
  const [s] = await sql<{ id: number; company_id: number; name: string; company: string; orgnr: string }[]>`
    SELECT w.id, w.company_id, w.name, c.name AS company, c.orgnr FROM work_sites w JOIN companies c ON c.id = w.company_id WHERE w.kiosk_token = ${token} AND w.active`;
  return s ?? null;
}

/** Manuell registrering i efterhand (t.ex. glömd stämpling) – syns som registrerad av chef */
export async function addEntry(actor: Actor, input: { site_id: number; name: string; personal_number: string; check_in: string; check_out?: string; reason: string }) {
  const pnr = normalizePersonalNumber(input.personal_number);
  if (!pnr) throw new ValidationError('Ogiltigt personnummer');
  if (!input.reason.trim()) throw new ValidationError('Ange orsak till registreringen i efterhand');
  const [emp] = await sql<{ id: number; name: string }[]>`SELECT id, first_name || ' ' || last_name AS name FROM employees WHERE company_id = ${actor.companyId} AND personal_number = ${pnr}`;
  const name = emp?.name ?? input.name.trim();
  if (!name) throw new ValidationError('Ange namn');
  return sql.begin(async (tx) => {
    const [r] = await tx<{ id: number }[]>`
      INSERT INTO staff_log (company_id, site_id, employee_id, person_name, personal_number, check_in, check_out, source, created_by)
      VALUES (${actor.companyId}, ${input.site_id}, ${emp?.id ?? null}, ${name}, ${pnr}, ${local(input.check_in)}, ${input.check_out ? local(input.check_out) : null}, 'manager', ${actor.userId}) RETURNING id`;
    await tx`INSERT INTO staff_log_changes (log_id, field, new_value, reason, changed_by) VALUES (${r.id}, 'registrerad i efterhand', ${input.check_in}, ${input.reason.trim()}, ${actor.userId})`;
    return r.id;
  });
}

/** Rättelse av in- eller utstämpling. Ursprungligt värde, nytt värde och orsak sparas. */
export async function correctEntry(actor: Actor, id: number, input: { check_in?: string; check_out?: string; reason: string }) {
  if (!input.reason.trim()) throw new ValidationError('Ange orsak till rättelsen');
  return sql.begin(async (tx) => {
    const [cur] = await tx<{ check_in: string; check_out: string | null }[]>`
      SELECT ${fmt('check_in')} AS check_in, CASE WHEN check_out IS NULL THEN NULL ELSE ${fmt('check_out')} END AS check_out
      FROM staff_log WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!cur) throw new NotFoundError('Registreringen');
    let n = 0;
    if (input.check_in && input.check_in !== cur.check_in) {
      await tx`UPDATE staff_log SET check_in = ${local(input.check_in)} WHERE id = ${id}`;
      await tx`INSERT INTO staff_log_changes (log_id, field, old_value, new_value, reason, changed_by) VALUES (${id}, 'in', ${cur.check_in}, ${input.check_in}, ${input.reason.trim()}, ${actor.userId})`;
      n++;
    }
    if (input.check_out && input.check_out !== (cur.check_out ?? '')) {
      await tx`UPDATE staff_log SET check_out = ${local(input.check_out)} WHERE id = ${id}`;
      await tx`INSERT INTO staff_log_changes (log_id, field, old_value, new_value, reason, changed_by) VALUES (${id}, 'ut', ${cur.check_out ?? ''}, ${input.check_out}, ${input.reason.trim()}, ${actor.userId})`;
      n++;
    }
    if (!n) throw new ValidationError('Inget att rätta');
    const [bad] = await tx<{ bad: boolean }[]>`SELECT check_out < check_in AS bad FROM staff_log WHERE id = ${id}`;
    if (bad.bad) throw new ValidationError('Utstämplingen kan inte vara före instämplingen');
    await auditBy(tx, actor, 'correct', 'staff_log', id, { reason: input.reason });
  });
}
