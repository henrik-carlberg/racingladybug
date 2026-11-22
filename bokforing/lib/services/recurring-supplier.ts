import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { addMonths } from '@/lib/assets';
import { STATUS_LABEL, periodsBetween, status } from '@/lib/recurring-supplier';
import type { Actor } from './actor';
import { int, str } from './input';
import { registerSupplierInvoice } from './suppliers';

const period = (v: string, label: string) => { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new ValidationError(`Ange ${label} som ÅÅÅÅ-MM`); return v; };

/** Mallar med månadens status de senaste sex månaderna: mottagen faktura från leverantören i perioden, avvikande belopp eller saknad */
export async function overview(companyId: number) {
  const t = today(), now = t.slice(0, 7);
  const templates = await sql<{ id: number; supplier_id: number; supplier: string; description: string; total: number; vat: number; account: number; due_day: number; start_period: string; end_period: string | null; active: boolean }[]>`
    SELECT t.id, t.supplier_id, s.name AS supplier, t.description, t.total::float8 AS total, t.vat::float8 AS vat, t.account, t.due_day, t.start_period, t.end_period, t.active
    FROM supplier_templates t JOIN suppliers s ON s.id = t.supplier_id WHERE t.company_id = ${companyId} ORDER BY s.name`;
  const invoices = await sql<{ id: number; supplier_id: number; period: string; total: number; template_id: number | null }[]>`SELECT i.id, i.supplier_id, to_char(i.invoice_date,'YYYY-MM') AS period, i.total::float8 AS total,
    (SELECT p.template_id FROM supplier_template_periods p WHERE p.supplier_invoice_id = i.id LIMIT 1) AS template_id
    FROM supplier_invoices i WHERE i.company_id = ${companyId} AND i.invoice_date >= (now() - interval '8 months')`;
  const six = periodsBetween(addMonths(now, -5), now);
  const rows = templates.map((tp) => ({
    ...tp, months: six.filter((p) => p >= tp.start_period && (!tp.end_period || p <= tp.end_period)).map((p) => {
      const inv = invoices.find((i) => i.template_id === tp.id && i.period === p) ?? invoices.find((i) => i.supplier_id === tp.supplier_id && i.period === p && i.template_id == null);
      const st = tp.active ? status({ expected: tp.total, actual: inv?.total ?? null, dueDay: tp.due_day, period: p, today: t }) : 'received';
      return { period: p, status: st, label: STATUS_LABEL[st], invoiceId: inv?.id ?? null, actual: inv?.total ?? null };
    }),
  }));
  const suppliers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM suppliers WHERE company_id = ${companyId} ORDER BY name`;
  return { rows, suppliers, missing: rows.flatMap((r) => r.months.filter((m) => m.status === 'missing')).length, deviations: rows.flatMap((r) => r.months.filter((m) => m.status === 'deviation')).length };
}

export async function addTemplate(actor: Actor, input: Record<string, unknown>) {
  const supplierId = int(input, 'supplier_id', 'Leverantör');
  const [s] = await sql`SELECT 1 FROM suppliers WHERE id = ${supplierId} AND company_id = ${actor.companyId}`;
  if (!s) throw new NotFoundError('Leverantören');
  const total = parseAmount(str(input, 'total')), vat = parseAmount(str(input, 'vat') || '0');
  if (total == null || total <= 0 || vat == null || vat < 0 || vat >= total) throw new ValidationError('Ange belopp inkl. moms och momsen i kronor');
  const account = int(input, 'account', 'Konto');
  if (account < 4000 || account > 8999) throw new ValidationError('Välj ett kostnadskonto (4000–8999)');
  const dueDay = Number(str(input, 'due_day') || '25');
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new ValidationError('Förfallodagen ska vara 1–31');
  const start = period(str(input, 'start_period'), 'första månaden'), end = str(input, 'end_period') ? period(str(input, 'end_period'), 'sista månaden') : null;
  if (end && end < start) throw new ValidationError('Sista månaden är före den första');
  await sql`INSERT INTO supplier_templates ${sql({ company_id: actor.companyId, supplier_id: supplierId, description: str(input, 'description', { required: true, label: 'Beskrivning', max: 200 }),
    total, vat, account, due_day: dueDay, start_period: start, end_period: end, created_by: actor.userId })}`;
}

/** Registrerar månadens faktura från mallen (för avtal där leverantören inte skickar faktura varje månad) */
export async function createFromTemplate(actor: Actor, templateId: number, p: string) {
  period(p, 'månaden');
  const [tp] = await sql<{ supplier_id: number; description: string; total: number; vat: number; account: number; due_day: number; start_period: string; end_period: string | null; active: boolean }[]>`
    SELECT supplier_id, description, total::float8 AS total, vat::float8 AS vat, account, due_day, start_period, end_period, active FROM supplier_templates WHERE id = ${templateId} AND company_id = ${actor.companyId}`;
  if (!tp) throw new NotFoundError('Mallen');
  if (!tp.active || p < tp.start_period || (tp.end_period && p > tp.end_period)) throw new ValidationError('Månaden ligger utanför mallens period');
  const [dup] = await sql`SELECT 1 FROM supplier_template_periods WHERE template_id = ${templateId} AND period = ${p}`;
  if (dup) throw new ConflictError(`Fakturan för ${p} är redan skapad`);
  const due = `${p}-${String(Math.min(tp.due_day, 28)).padStart(2, '0')}`;
  const inv = await registerSupplierInvoice(actor, { supplier_id: tp.supplier_id, invoice_number: `AUTO-${templateId}-${p}`, invoice_date: `${p}-01`, due_date: due,
    description: `${tp.description} ${p}`, total: tp.total, vat: tp.vat, lines: [{ account: tp.account, amount: tp.total - tp.vat }] });
  try {
    await sql`INSERT INTO supplier_template_periods (template_id, period, supplier_invoice_id) VALUES (${templateId}, ${p}, ${inv.id})`;
  } catch { throw new ConflictError(`Fakturan för ${p} är redan skapad`); }
  await auditBy(sql, actor, 'supplier_template_invoice', 'supplier_template', templateId, { period: p });
  return inv.id;
}

export async function setActive(actor: Actor, templateId: number, active: boolean) {
  const r = await sql`UPDATE supplier_templates SET active = ${active} WHERE id = ${templateId} AND company_id = ${actor.companyId}`;
  if (!r.count) throw new NotFoundError('Mallen');
}
