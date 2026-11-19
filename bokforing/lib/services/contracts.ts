import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { sendMail } from '@/lib/server/mail';
import { today } from '@/lib/format';
import { contractDates, contractState, type ContractState } from '@/lib/purchasing';
import type { Actor } from './actor';
import { date, optInt, str } from './input';

export interface ContractOut { id: number; name: string; supplier_id: number | null; supplier: string | null; start_date: string | null; end_date: string | null; notice_months: number;
  auto_renew: boolean; renew_months: number; monthly_cost: number | null; responsible: string | null; notes: string; current_end: string | null; notice_by: string | null; state: ContractState }

export async function listContracts(companyId: number): Promise<ContractOut[]> {
  const t = today();
  const rows = await sql<Omit<ContractOut, 'current_end' | 'notice_by' | 'state'>[]>`SELECT c.id, c.name, c.supplier_id, s.name AS supplier, to_char(c.start_date,'YYYY-MM-DD') AS start_date,
      to_char(c.end_date,'YYYY-MM-DD') AS end_date, c.notice_months, c.auto_renew, c.renew_months, c.monthly_cost::float8 AS monthly_cost, u.name AS responsible, c.notes
    FROM supplier_contracts c LEFT JOIN suppliers s ON s.id = c.supplier_id LEFT JOIN users u ON u.id = c.responsible WHERE c.company_id = ${companyId} ORDER BY c.name`;
  return rows.map((r) => {
    const d = contractDates({ end: r.end_date, noticeMonths: r.notice_months, autoRenew: r.auto_renew, renewMonths: r.renew_months }, t);
    return { ...r, current_end: d.end, notice_by: d.noticeBy, state: contractState(d, t) };
  }).sort((a, b) => (a.notice_by ?? '9999').localeCompare(b.notice_by ?? '9999'));
}

export async function saveContract(actor: Actor, input: Record<string, unknown>) {
  const name = str(input, 'name', { required: true, label: 'Avtal', max: 200 });
  const supplierId = optInt(input, 'supplier_id', 'Leverantör') ?? null;
  if (supplierId && !(await sql`SELECT 1 FROM suppliers WHERE id = ${supplierId} AND company_id = ${actor.companyId}`).length) throw new ValidationError('Leverantören finns inte');
  const notice = optInt(input, 'notice_months', 'Uppsägningstid') ?? 0, renew = optInt(input, 'renew_months', 'Förlängning') ?? 12;
  if (notice < 0 || notice > 60 || renew < 0 || renew > 120) throw new ValidationError('Ogiltig uppsägningstid eller förlängning');
  const cost = optInt(input, 'monthly_cost', 'Kostnad');
  const [r] = await sql<{ id: number }[]>`INSERT INTO supplier_contracts ${sql({ company_id: actor.companyId, supplier_id: supplierId, name, start_date: date(input, 'start_date', 'Start', false) || null,
    end_date: date(input, 'end_date', 'Slut', false) || null, notice_months: notice, auto_renew: input.auto_renew === true || input.auto_renew === 'on', renew_months: renew,
    monthly_cost: cost ?? null, responsible: actor.userId, notes: str(input, 'notes', { max: 2000 }), created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'supplier_contract', r.id, { name });
  return r.id;
}

export async function deleteContract(actor: Actor, id: number) {
  const r = await sql`DELETE FROM supplier_contracts WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Avtalet');
  await auditBy(sql, actor, 'delete', 'supplier_contract', id);
}

/** Daglig påminnelse till den ansvarige 45 dagar före sista dag att säga upp – en gång per uppsägningsdatum */
export async function contractReminders() {
  let n = 0;
  for (const c of await sql<{ id: number; company_id: number }[]>`SELECT id, company_id FROM supplier_contracts WHERE end_date IS NOT NULL`) {
    const [x] = (await listContracts(c.company_id)).filter((k) => k.id === c.id);
    if (!x || x.state !== 'notice_soon' || !x.notice_by) continue;
    const [r] = await sql<{ email: string | null; reminded: string | null }[]>`SELECT u.email, to_char(k.reminded_for,'YYYY-MM-DD') AS reminded FROM supplier_contracts k LEFT JOIN users u ON u.id = k.responsible WHERE k.id = ${c.id}`;
    if (r.reminded === x.notice_by) continue;
    if (r.email) await sendMail(r.email, `Avtal att säga upp: ${x.name}`, `Avtalet ${x.name}${x.supplier ? ` med ${x.supplier}` : ''} löper till ${x.current_end}${x.auto_renew ? ' och förlängs automatiskt' : ''}. Säg upp det senast ${x.notice_by} om det inte ska fortsätta.`);
    await sql`UPDATE supplier_contracts SET reminded_for = ${x.notice_by} WHERE id = ${c.id}`;
    n++;
  }
  return n;
}
