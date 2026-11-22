import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { addDays, today } from '@/lib/format';
import { parseAmount } from '@/lib/money';
import { missingDays, obligationLimit, validSerial } from '@/lib/cash-register';
import type { Actor } from './actor';
import { date, str } from './input';

export async function overview(companyId: number) {
  const registers = await sql<{ id: number; name: string; control_unit: string; registered_on: string; skv_reference: string; open_days: number[]; active: boolean }[]>`
    SELECT id, name, control_unit, to_char(registered_on,'YYYY-MM-DD') AS registered_on, skv_reference, open_days, active FROM cash_registers WHERE company_id = ${companyId} ORDER BY name`;
  const reports = await sql<{ register: string; date: string }[]>`SELECT register, to_char(date,'YYYY-MM-DD') AS date FROM cash_reports WHERE company_id = ${companyId} AND date >= now() - interval '120 days'`;
  const yesterday = addDays(today(), -1);
  const withGaps = registers.map((r) => {
    const reported = new Set(reports.filter((x) => x.register === r.name).map((x) => x.date));
    const from = r.registered_on > addDays(today(), -60) ? r.registered_on : addDays(today(), -60);
    return { ...r, missing: r.active ? missingDays({ from, until: yesterday, openDays: r.open_days, reported }) : [] };
  });
  // Kassor som används i dagskassan utan anmäld kontrollenhet
  const names = new Set(registers.filter((r) => r.active).map((r) => r.name));
  const unregistered = [...new Set(reports.map((r) => r.register))].filter((n) => !names.has(n));
  const year = Number(today().slice(0, 4));
  const [{ sales }] = await sql<{ sales: number }[]>`SELECT COALESCE(SUM((SELECT SUM(value::bigint) FROM jsonb_each_text(data->'gross'))), 0)::float8 AS sales
    FROM cash_reports WHERE company_id = ${companyId} AND extract(year from date) = ${year}`;
  const xReports = await sql<{ id: number; register: string; taken_at: string; amount: number; note: string }[]>`SELECT id, register, to_char(taken_at,'YYYY-MM-DD HH24:MI') AS taken_at, amount::float8 AS amount, note
    FROM cash_x_reports WHERE company_id = ${companyId} ORDER BY taken_at DESC LIMIT 20`;
  return { registers: withGaps, unregistered, sales, limit: obligationLimit(year), obliged: sales > obligationLimit(year), xReports };
}

export async function addRegister(actor: Actor, input: Record<string, unknown>) {
  const name = str(input, 'name', { required: true, label: 'Kassans namn', max: 60 });
  const unit = str(input, 'control_unit', { required: true, label: 'Kontrollenhetens tillverkningsnummer', max: 40 }).toUpperCase();
  if (!validSerial(unit)) throw new ValidationError('Tillverkningsnumret ska vara 8–40 bokstäver och siffror');
  const days = [1, 2, 3, 4, 5, 6, 7].filter((d) => input[`day_${d}`] === 'on');
  if (!days.length) throw new ValidationError('Välj vilka dagar kassan är öppen');
  try {
    await sql`INSERT INTO cash_registers ${sql({ company_id: actor.companyId, name, control_unit: unit, registered_on: date(input, 'registered_on', 'Anmäld till Skatteverket'),
      skv_reference: str(input, 'skv_reference', { max: 60 }), open_days: days, created_by: actor.userId })}`;
  } catch (e) {
    if (String((e as Error).message).includes('cash_registers_company_id_name_key')) throw new ConflictError('Det finns redan en kassa med det namnet');
    throw e;
  }
  await auditBy(sql, actor, 'cash_register', 'company', actor.companyId, { name, unit });
}

/** X-rapport: avläsning under dagen utan nollställning – sparas som underlag, bokförs inte */
export async function addXReport(actor: Actor, input: Record<string, unknown>) {
  const register = str(input, 'register', { required: true, label: 'Kassa', max: 60 });
  const amount = parseAmount(str(input, 'amount'));
  if (amount == null || amount < 0) throw new ValidationError('Ange försäljningen hittills i kronor');
  await sql`INSERT INTO cash_x_reports ${sql({ company_id: actor.companyId, register, amount, note: str(input, 'note', { max: 200 }), created_by: actor.userId })}`;
}

export async function deactivate(actor: Actor, id: number) {
  const r = await sql`UPDATE cash_registers SET active = false WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!r.count) throw new ValidationError('Kassan finns inte');
}
