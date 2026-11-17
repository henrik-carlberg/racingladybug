import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { computeDeadlines } from '@/lib/deadlines';
import { today } from '@/lib/format';
import type { Actor } from '@/lib/services/actor';
import { date, int, optInt, str } from '@/lib/services/input';
import { CATEGORIES, addDaysIso, categoryOf, occurrences, result, weekly, type Category, type Flow } from './calc';

// ---------- Budget ----------

export async function budget(companyId: number, year: number) {
  const rows = await sql<{ month: number; category: Category; amount: number }[]>`SELECT month, category, amount::bigint AS amount FROM liq_budget WHERE company_id = ${companyId} AND year = ${year}`;
  const actualRows = await sql<{ month: number; account: number; amount: number }[]>`
    SELECT EXTRACT(MONTH FROM v.date)::int AS month, l.account_number AS account, SUM(l.debit - l.credit)::bigint AS amount
    FROM vouchers v JOIN voucher_lines l ON l.voucher_id = v.id
    WHERE v.company_id = ${companyId} AND EXTRACT(YEAR FROM v.date) = ${year} AND l.account_number BETWEEN 3000 AND 8799
      AND v.source_type IS DISTINCT FROM 'yearend' GROUP BY 1, 2`;
  const months = [...Array(12)].map((_, i) => {
    const m = i + 1;
    const b: Record<string, number> = {}, a: Record<string, number> = {};
    for (const c of CATEGORIES) {
      b[c.key] = Number(rows.find((r) => r.month === m && r.category === c.key)?.amount ?? 0);
      a[c.key] = 0;
    }
    for (const r of actualRows.filter((x) => x.month === m)) {
      const cat = categoryOf(r.account);
      if (cat) a[cat] += Number(r.amount) * (CATEGORIES.find((c) => c.key === cat)!.sign);
    }
    return { month: m, budget: b, actual: a, budgetResult: result(b), actualResult: result(a) };
  });
  return { year, months, hasBudget: rows.length > 0 };
}

export async function saveBudget(actor: Actor, year: number, values: Record<string, (number | null)[]>) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new ValidationError('Ogiltigt år');
  await sql.begin(async (tx) => {
    for (const c of CATEGORIES) {
      const arr = values[c.key] ?? [];
      for (let m = 1; m <= 12; m++) {
        const v = arr[m - 1] ?? 0;
        await tx`INSERT INTO liq_budget (company_id, year, month, category, amount) VALUES (${actor.companyId}, ${year}, ${m}, ${c.key}, ${v})
          ON CONFLICT (company_id, year, month, category) DO UPDATE SET amount = EXCLUDED.amount`;
      }
    }
    await auditBy(tx, actor, 'budget', 'likviditet', year);
  });
}

/** Fyller budgeten med förra årets utfall per månad, uppräknat med `percent` */
export async function budgetFromLastYear(actor: Actor, year: number, percent: number) {
  if (!Number.isFinite(percent) || percent < -90 || percent > 500) throw new ValidationError('Ogiltig procentsats');
  const last = await budget(actor.companyId, year - 1);
  const values: Record<string, number[]> = {};
  for (const c of CATEGORIES) values[c.key] = last.months.map((m) => Math.round((m.actual[c.key] * (1 + percent / 100)) / 10000) * 10000);
  await saveBudget(actor, year, values);
}

// ---------- Inställningar och planerade poster ----------

export async function settings(companyId: number) {
  const [s] = await sql<{ prelskatt_monthly: number; payment_delay: number; min_balance: number }[]>`
    SELECT prelskatt_monthly::bigint AS prelskatt_monthly, payment_delay, min_balance::bigint AS min_balance FROM liq_settings WHERE company_id = ${companyId}`;
  return s ? { prelskatt_monthly: Number(s.prelskatt_monthly), payment_delay: s.payment_delay, min_balance: Number(s.min_balance) } : { prelskatt_monthly: 0, payment_delay: 0, min_balance: 0 };
}

export async function saveSettings(actor: Actor, input: Record<string, unknown>) {
  const f = { prelskatt_monthly: optInt(input, 'prelskatt_monthly', 'Preliminärskatt') ?? 0, payment_delay: optInt(input, 'payment_delay', 'Försening') ?? 0, min_balance: optInt(input, 'min_balance', 'Lägsta saldo') ?? 0 };
  if (f.prelskatt_monthly < 0 || f.payment_delay < 0 || f.payment_delay > 120) throw new ValidationError('Ogiltigt värde');
  await sql`INSERT INTO liq_settings ${sql({ ...f, company_id: actor.companyId })} ON CONFLICT (company_id) DO UPDATE SET ${sql(f)}`;
  await auditBy(sql, actor, 'settings', 'likviditet', 0);
}

export async function items(companyId: number) {
  return sql<{ id: number; date: string; amount: number; description: string; recurrence: 'none' | 'monthly' | 'quarterly' | 'yearly'; until: string | null }[]>`
    SELECT id, to_char(date,'YYYY-MM-DD') AS date, amount::bigint AS amount, description, recurrence, to_char(until,'YYYY-MM-DD') AS until FROM liq_items WHERE company_id = ${companyId} ORDER BY date`;
}

export async function addItem(actor: Actor, input: Record<string, unknown>) {
  const rec = str(input, 'recurrence') || 'none';
  if (!['none', 'monthly', 'quarterly', 'yearly'].includes(rec)) throw new ValidationError('Ogiltig upprepning');
  const amount = int(input, 'amount', 'Belopp');
  if (!amount) throw new ValidationError('Ange belopp');
  await sql`INSERT INTO liq_items ${sql({ company_id: actor.companyId, date: date(input, 'date', 'Datum'), amount, description: str(input, 'description', { required: true, label: 'Beskrivning' }),
    recurrence: rec, until: date(input, 'until', 'Till och med', false) || null, created_by: actor.userId })}`;
  await auditBy(sql, actor, 'add_item', 'likviditet', 0);
}

export async function removeItem(actor: Actor, id: number) {
  const r = await sql`DELETE FROM liq_items WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Posten');
}

// ---------- Likviditetsprognos ----------

/** 12:e i månaden (17:e i januari och augusti) – förfallodag för skatt och avgifter till skattekontot */
const taxDay = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-${m === 1 || m === 8 ? 17 : 12}`;

export async function forecast(companyId: number, weeks = 13) {
  const t = today();
  const end = addDaysIso(t, weeks * 7 + 7);
  const s = await settings(companyId);
  const [c] = await sql<{ invoice_terms: number; company_type: 'AB' | 'EF'; vat_period: 'month' | 'quarter' | 'year'; f_skatt: boolean }[]>`
    SELECT invoice_terms, company_type, vat_period, f_skatt FROM companies WHERE id = ${companyId}`;
  const [bank] = await sql<{ balance: number }[]>`SELECT COALESCE(SUM(l.debit - l.credit), 0)::bigint AS balance FROM vouchers v JOIN voucher_lines l ON l.voucher_id = v.id
    WHERE v.company_id = ${companyId} AND l.account_number BETWEEN 1900 AND 1999 AND v.date <= ${t}`;
  const flows: Flow[] = [];

  // Kundfakturor
  for (const i of await sql<{ number: number; customer: string; due: string; total: number }[]>`SELECT i.invoice_number AS number, c.name AS customer, to_char(i.due_date,'YYYY-MM-DD') AS due, i.total::bigint AS total
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.company_id = ${companyId} AND i.status = 'booked' AND i.total > 0`) {
    flows.push({ date: addDaysIso(i.due, s.payment_delay), amount: Number(i.total), kind: 'Kundfaktura', text: `Faktura ${i.number} ${i.customer}` });
  }
  // Leverantörsfakturor
  for (const i of await sql<{ number: string; supplier: string; due: string; total: number }[]>`SELECT i.invoice_number AS number, s.name AS supplier, to_char(i.due_date,'YYYY-MM-DD') AS due, i.total::bigint AS total
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.company_id = ${companyId} AND i.status IN ('booked', 'approved')`) {
    flows.push({ date: i.due, amount: -Number(i.total), kind: 'Leverantörsfaktura', text: `${i.supplier} ${i.number}` });
  }
  // Avtal (om avtalsmodulen används): kommande periodfakturor
  const hasAvtal = (await sql<{ ok: boolean }[]>`SELECT to_regclass('avt_contracts') IS NOT NULL AS ok`)[0].ok;
  if (hasAvtal) {
    const { listContracts } = await import('@/modules/avtal/service');
    const { invoiceDate, addMonths } = await import('@/modules/avtal/calc');
    for (const k of await listContracts(companyId, { status: 'active' })) {
      let start = k.next_period_start;
      for (let i = 0; i < 24; i++) {
        if (k.end_date && start > k.end_date && !k.auto_renew) break;
        const inv = invoiceDate(start, k.interval_months, k.in_advance);
        const pay = addDaysIso(inv, c.invoice_terms + s.payment_delay);
        if (pay > end) break;
        const vat = k.lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unit_price * l.vat_rate / 100), 0);
        flows.push({ date: pay, amount: k.period_net + vat, kind: 'Avtal', text: `${k.customer_name} – ${k.name}` });
        start = addMonths(start, k.interval_months);
      }
    }
  }
  // Lön: senaste bokförda lönekörning upprepas varje månad
  const [run] = await sql<{ day: number; net: number; tax: number; fees: number }[]>`SELECT EXTRACT(DAY FROM r.payment_date)::int AS day, SUM(p.net_pay)::bigint AS net,
    SUM(p.tax)::bigint AS tax, SUM(p.employer_fee)::bigint AS fees FROM payroll_runs r JOIN payslips p ON p.run_id = r.id
    WHERE r.company_id = ${companyId} AND r.status = 'booked' GROUP BY r.id, r.payment_date ORDER BY r.payment_date DESC LIMIT 1`;
  const [emps] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employees WHERE company_id = ${companyId} AND active`;
  if (run && emps.n) {
    for (let i = 0; i < 5; i++) {
      const d = new Date(t + 'T12:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + i);
      const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
      const payDay = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(run.day, 28)).padStart(2, '0')}`;
      if (payDay >= t) flows.push({ date: payDay, amount: -Number(run.net), kind: 'Lön', text: 'Nettolöner' });
      const nm = m === 12 ? 1 : m + 1, ny = m === 12 ? y + 1 : y;
      const tax = taxDay(ny, nm);
      if (tax >= t) flows.push({ date: tax, amount: -(Number(run.tax) + Number(run.fees)), kind: 'Skatt', text: 'Avdragen skatt och arbetsgivaravgifter (AGI)' });
    }
  }
  // Moms: nuvarande momsskuld betalas vid nästa momsdeadline
  const [vat] = await sql<{ v: number }[]>`SELECT COALESCE(SUM(l.credit - l.debit), 0)::bigint AS v FROM vouchers v JOIN voucher_lines l ON l.voucher_id = v.id
    WHERE v.company_id = ${companyId} AND l.account_number BETWEEN 2610 AND 2659 AND v.date <= ${t}`;
  const fys = await sql<{ start: string; end: string }[]>`SELECT to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS "end" FROM fiscal_years WHERE company_id = ${companyId}`;
  const nextVat = computeDeadlines({ companyType: c.company_type, vatPeriod: c.vat_period, fiscalYears: fys, hasEmployees: false, fSkatt: false, from: t, to: addDaysIso(t, 500) }).find((d) => d.kind === 'vat');
  if (nextVat && Number(vat.v) !== 0) flows.push({ date: nextVat.due, amount: -Number(vat.v), kind: 'Moms', text: `${nextVat.title} (nuvarande saldo)` });
  // Preliminärskatt
  if (s.prelskatt_monthly) {
    for (let i = 0; i < 5; i++) {
      const d = new Date(t + 'T12:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + i);
      const due = taxDay(d.getUTCFullYear(), d.getUTCMonth() + 1);
      if (due >= t) flows.push({ date: due, amount: -s.prelskatt_monthly, kind: 'Skatt', text: 'Debiterad preliminärskatt' });
    }
  }
  // Planerade poster
  for (const it of await items(companyId)) {
    for (const d of occurrences(it.date, it.recurrence, it.until, t, end)) flows.push({ date: d, amount: Number(it.amount), kind: 'Planerat', text: it.description });
  }
  const w = weekly(Number(bank.balance), flows, t, weeks);
  const lowest = w.reduce((min, x) => (x.balance < min.balance ? x : min), w[0]);
  return { opening: Number(bank.balance), weeks: w, lowest, minBalance: s.min_balance, warning: lowest.balance < s.min_balance };
}
