import 'server-only';
import type { Tx } from '@/lib/db';
import { birthYearFromPersonalNumber, calculatePayslip, type PayItem, type PayslipCalc } from '@/lib/payroll';
import type { TaxTableRow } from '@/lib/payroll';

interface SlipContext {
  items: PayItem[];
  personal_number: string;
  tax_mode: 'table' | 'percent';
  tax_table: number | null;
  tax_column: number;
  tax_percent: string | null;
  fee_override: string | null;
  payment_date: string;
  name: string;
}

/** Räknar om en lönespec och sparar resultatet */
export async function recomputeSlip(tx: Tx, slipId: number): Promise<PayslipCalc> {
  const [s] = await tx<SlipContext[]>`
    SELECT p.items, e.personal_number, e.tax_mode, e.tax_table, e.tax_column, e.tax_percent, e.fee_override,
      to_char(r.payment_date,'YYYY-MM-DD') AS payment_date, e.first_name || ' ' || e.last_name AS name
    FROM payslips p JOIN employees e ON e.id = p.employee_id JOIN payroll_runs r ON r.id = p.run_id WHERE p.id = ${slipId}`;
  let rows: TaxTableRow[] = [];
  if (s.tax_mode === 'table') {
    if (!s.tax_table) throw new Error(`${s.name}: skattetabell saknas på den anställda`);
    const year = Number(s.payment_date.slice(0, 4));
    rows = await tx<TaxTableRow[]>`SELECT income_from, income_to, kind, columns FROM tax_table_rows WHERE year = ${year} AND table_no = ${s.tax_table}`;
    if (rows.length === 0) throw new Error(`Skattetabell ${s.tax_table} för ${year} saknas – hämta den under Lön → Skattetabeller`);
  }
  const c = calculatePayslip(
    s.items,
    { mode: s.tax_mode, rows, column: s.tax_column, percent: s.tax_percent != null ? Number(s.tax_percent) : 30 },
    birthYearFromPersonalNumber(s.personal_number),
    s.payment_date,
    s.fee_override != null ? Number(s.fee_override) : null,
  );
  await tx`UPDATE payslips SET gross_cash = ${c.grossCash}, benefits = ${c.benefits}, tax = ${c.tax}, net_deductions = ${c.netDeductions},
    reimbursements = ${c.reimbursements}, net_pay = ${c.netPay}, employer_fee_rate = ${c.employerFeeRate}, employer_fee = ${c.employerFee}
    WHERE id = ${slipId}`;
  return c;
}
