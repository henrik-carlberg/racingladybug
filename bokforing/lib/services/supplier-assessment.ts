import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { today } from '@/lib/format';
import { CHECKS, LEVELS, assess, dependency, type Check, type Level } from '@/lib/supplier-assessment';
import type { Actor } from './actor';
import { date, int, str } from './input';

export async function overview(companyId: number) {
  const t = today();
  const suppliers = await sql<{ id: number; name: string; level: Level | null; note: string | null; purchases: number; unpaid: number }[]>`
    SELECT s.id, s.name, r.level, r.note,
      COALESCE((SELECT SUM(i.total - i.vat) FROM supplier_invoices i WHERE i.supplier_id = s.id AND i.voucher_id IS NOT NULL AND i.invoice_date > ${t}::date - 365), 0)::float8 AS purchases,
      COALESCE((SELECT SUM(i.total - i.paid_amount) FROM supplier_invoices i WHERE i.supplier_id = s.id AND i.status <> 'paid'), 0)::float8 AS unpaid
    FROM suppliers s LEFT JOIN supplier_risk r ON r.supplier_id = s.id WHERE s.company_id = ${companyId} ORDER BY s.name LIMIT 500`;
  const checks = await sql<(Check & { supplier_id: number; note: string })[]>`SELECT supplier_id, kind, to_char(valid_until,'YYYY-MM-DD') AS valid_until, ok, to_char(checked_on,'YYYY-MM-DD') AS checked_on, note
    FROM supplier_checks WHERE company_id = ${companyId}`;
  const total = suppliers.reduce((s, x) => s + x.purchases, 0);
  return {
    suppliers: suppliers.map((s) => ({ ...s, level: s.level ?? 'low' as Level, share: dependency(s.purchases, total), ...assess(s.level ?? 'low', checks.filter((c) => c.supplier_id === s.id), t) }))
      .sort((a, b) => Number(a.ok) - Number(b.ok) || b.share - a.share),
  };
}

/** Varningar för en leverantör (visas vid registrering och betalning av fakturor) */
export async function warnings(companyId: number, supplierId: number) {
  const [r] = await sql<{ level: Level }[]>`SELECT level FROM supplier_risk WHERE supplier_id = ${supplierId} AND company_id = ${companyId}`;
  const checks = await sql<Check[]>`SELECT kind, to_char(valid_until,'YYYY-MM-DD') AS valid_until, ok, to_char(checked_on,'YYYY-MM-DD') AS checked_on FROM supplier_checks WHERE company_id = ${companyId} AND supplier_id = ${supplierId}`;
  return assess(r?.level ?? 'low', checks, today()).problems;
}

const ownSupplier = async (actor: Actor, id: number) => {
  const [s] = await sql`SELECT 1 FROM suppliers WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!s) throw new NotFoundError('Leverantören');
};

export async function setRisk(actor: Actor, supplierId: number, input: Record<string, unknown>) {
  await ownSupplier(actor, supplierId);
  const level = String(input.level) as Level;
  if (!Object.prototype.hasOwnProperty.call(LEVELS, level)) throw new ValidationError('Välj risknivå');
  await sql`INSERT INTO supplier_risk (supplier_id, company_id, level, note) VALUES (${supplierId}, ${actor.companyId}, ${level}, ${str(input, 'note', { max: 300 })})
    ON CONFLICT (supplier_id) DO UPDATE SET level = EXCLUDED.level, note = EXCLUDED.note`;
  await auditBy(sql, actor, 'supplier_risk', 'supplier', supplierId, { level });
}

export async function addCheck(actor: Actor, supplierId: number, input: Record<string, unknown>) {
  await ownSupplier(actor, supplierId);
  const kind = String(input.kind);
  if (!Object.prototype.hasOwnProperty.call(CHECKS, kind)) throw new ValidationError('Välj kontroll');
  const checked = date(input, 'checked_on', 'Kontrollerad', false) || today();
  const months = int(input, 'valid_months', 'Giltighet (månader)');
  if (months < 1 || months > 60) throw new ValidationError('Giltigheten ska vara 1–60 månader');
  const until = (() => { const d = new Date(`${checked}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10); })();
  await sql`INSERT INTO supplier_checks ${sql({ company_id: actor.companyId, supplier_id: supplierId, kind, checked_on: checked, valid_until: until, ok: input.ok !== 'no', note: str(input, 'note', { max: 300 }), created_by: actor.userId })}`;
  return { kind, until };
}
