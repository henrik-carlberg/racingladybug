import { ACC } from './bas';
import { fromSigned, type Line } from './ledger-lines';

// ---------- Arbetsgivaravgifter ----------
// Källor: Skatteverket (arbetsgivaravgifter), prop. 2025/26:66 (tillfälligt nedsatta avgifter för 19–23-åringar).
// Kontrollera mot Skatteverket inför varje nytt år.

export const FULL_RATE = 31.42;
export const PENSION_ONLY_RATE = 10.21; // endast ålderspensionsavgift (66 år och äldre vid årets början)
export const YOUTH_RATE = 20.81; // ålderspensionsavgift + halva övriga avgifter
export const YOUTH_CAP = 25_000_00; // öre per kalendermånad
export const YOUTH_FROM = '2026-04-01';
export const YOUTH_TO = '2027-09-30';

export interface FeeResult {
  fee: number; // öre
  effectiveRate: number; // för visning
  rule: string;
}

/**
 * Arbetsgivaravgift för en ersättning.
 * @param base avgiftsunderlag i öre (kontant bruttolön + förmåner)
 * @param birthYear den anställdes födelseår
 * @param paymentDate utbetalningsdatum (ÅÅÅÅ-MM-DD) – avgörande för vilka regler som gäller
 * @param override avvikande procentsats (t.ex. växa-stöd), ersätter reglerna nedan
 */
export function employerFee(base: number, birthYear: number, paymentDate: string, override?: number | null): FeeResult {
  if (base <= 0) return { fee: 0, effectiveRate: 0, rule: 'Inget underlag' };
  if (override != null) return { fee: Math.round((base * override) / 100), effectiveRate: override, rule: `Avvikande avgift ${override} %` };
  const year = Number(paymentDate.slice(0, 4));
  const ageAtYearStart = year - birthYear - 1; // ålder vid årets ingång
  if (birthYear <= 1937) return { fee: 0, effectiveRate: 0, rule: 'Född 1937 eller tidigare – ingen avgift' };
  if (ageAtYearStart >= 66) {
    return { fee: Math.round((base * PENSION_ONLY_RATE) / 100), effectiveRate: PENSION_ONLY_RATE, rule: 'Fyllt 66 vid årets ingång – ålderspensionsavgift' };
  }
  // Ungdomsnedsättning: fyllt 18 men inte 23 vid årets ingång (2026: födda 2003–2007)
  if (paymentDate >= YOUTH_FROM && paymentDate <= YOUTH_TO && ageAtYearStart >= 18 && ageAtYearStart <= 22) {
    const reducedBase = Math.min(base, YOUTH_CAP);
    const fee = Math.round((reducedBase * YOUTH_RATE) / 100) + Math.round(((base - reducedBase) * FULL_RATE) / 100);
    return { fee, effectiveRate: Math.round((fee / base) * 10000) / 100, rule: 'Nedsatt avgift 19–23 år (upp till 25 000 kr/mån)' };
  }
  return { fee: Math.round((base * FULL_RATE) / 100), effectiveRate: FULL_RATE, rule: 'Full arbetsgivaravgift' };
}

export function birthYearFromPersonalNumber(pnr: string): number {
  return Number(pnr.slice(0, 4));
}

// ---------- Skatteavdrag ----------

export interface TaxTableRow {
  income_from: number; // kr
  income_to: number; // kr
  kind: 'B' | '%';
  columns: number[];
}

/**
 * Preliminärskatt enligt Skatteverkets månadstabell.
 * Rader med kind 'B' anger skatten i kronor, rader med '%' anger procent av hela inkomsten (höga inkomster).
 */
export function taxFromTable(taxableOre: number, rows: TaxTableRow[], column: number): number {
  if (taxableOre <= 0) return 0;
  const kr = Math.floor(taxableOre / 100);
  const idx = column - 1;
  const amountRow = rows.find((r) => r.kind === 'B' && kr >= r.income_from && kr <= r.income_to);
  if (amountRow) return (amountRow.columns[idx] ?? 0) * 100;
  const pctRow = rows.find((r) => r.kind === '%' && kr >= r.income_from && kr <= r.income_to);
  if (pctRow) return Math.floor((kr * (pctRow.columns[idx] ?? 0)) / 100) * 100;
  return 0;
}

export function taxFromPercent(taxableOre: number, percent: number): number {
  if (taxableOre <= 0) return 0;
  return Math.floor((taxableOre / 100) * (percent / 100)) * 100; // hela kronor, avrundat nedåt
}

// ---------- Lönespecifikation ----------

export type PayItemType = 'salary' | 'benefit' | 'net_deduction' | 'reimbursement';

export interface PayItem {
  type: PayItemType;
  description: string;
  amount: number; // öre. salary kan vara negativ (t.ex. sjukavdrag)
  account?: number; // för reimbursement: kostnadskonto
  code?: 'agreement' | 'sacrifice' | 'vacation' | 'loan' | 'garnishment'; // rader som skapats automatiskt (avtalstillägg, löneväxling, semester)
}

export const PAY_ITEM_LABELS: Record<PayItemType, string> = {
  salary: 'Lön / tillägg / avdrag (skattepliktig kontant)',
  benefit: 'Skattepliktig förmån',
  net_deduction: 'Nettolöneavdrag',
  reimbursement: 'Skattefri ersättning / utlägg',
};

export interface PayslipCalc {
  grossCash: number;
  benefits: number;
  taxable: number;
  tax: number;
  netDeductions: number;
  reimbursements: number;
  netPay: number;
  employerFee: number;
  employerFeeRate: number;
  feeRule: string;
  /** normal, expertskatt (25 % skattefritt) eller SINK (25 % särskild inkomstskatt) */
  taxKind: 'normal' | 'expert' | 'sink';
  exemptCash: number;
  exemptBenefits: number;
}

export interface TaxSetup {
  mode: 'table' | 'percent';
  rows?: TaxTableRow[];
  column?: number;
  percent?: number;
}

export function calculatePayslip(
  items: PayItem[],
  tax: TaxSetup,
  birthYear: number,
  paymentDate: string,
  feeOverride?: number | null,
  special?: 'expert' | 'sink' | null,
): PayslipCalc {
  const by = (t: PayItemType) => items.filter((i) => i.type === t).reduce((s, i) => s + i.amount, 0);
  const grossCash = by('salary');
  const benefits = by('benefit');
  const netDeductions = by('net_deduction');
  const reimbursements = by('reimbursement');
  let taxable = grossCash + benefits;
  let exemptCash = 0, exemptBenefits = 0;
  if (special === 'expert') { exemptCash = Math.round(grossCash * 0.25); exemptBenefits = Math.round(benefits * 0.25); taxable -= exemptCash + exemptBenefits; }

  let taxAmount: number;
  if (special === 'sink') taxAmount = Math.floor((taxable * 25) / 10000) * 100;
  else if (tax.mode === 'percent') taxAmount = taxFromPercent(taxable, tax.percent ?? 30);
  else {
    if (!tax.rows || tax.rows.length === 0) throw new Error('Skattetabell saknas – hämta skattetabeller under Lön → Skattetabeller');
    taxAmount = taxFromTable(taxable, tax.rows, tax.column ?? 1);
  }
  // Skatten kan inte överstiga kontant lön (skatteavdrag görs bara från kontant ersättning)
  taxAmount = Math.min(taxAmount, Math.max(grossCash, 0));

  const fee = employerFee(taxable, birthYear, paymentDate, feeOverride);
  return {
    grossCash,
    benefits,
    taxable,
    tax: taxAmount,
    netDeductions,
    reimbursements,
    netPay: grossCash - taxAmount - netDeductions + reimbursements,
    employerFee: fee.fee,
    employerFeeRate: fee.effectiveRate,
    feeRule: fee.rule,
    taxKind: special ?? 'normal',
    exemptCash,
    exemptBenefits,
  };
}

/**
 * Kontering av en lönekörning (alla lönespecar):
 *   D 7210 bruttolön          K 2710 personalskatt
 *   D 7510 arbetsgivaravgift  K 2731 avräkning sociala avgifter
 *   D kostnadskonto utlägg    K 1610 nettolöneavdrag
 *                             K 1930 utbetald nettolön
 * Förmåner bokförs inte här (kostnaden finns redan bokförd), men ingår i skatte- och avgiftsunderlaget.
 */
export function payrollBookingLines(slips: { calc: PayslipCalc; items: PayItem[] }[], salaryAccount = ACC.salaries): Line[] {
  const e: { account: number; amount: number; description?: string }[] = [];
  for (const { calc, items } of slips) {
    e.push({ account: salaryAccount, amount: calc.grossCash });
    e.push({ account: ACC.personalTax, amount: -calc.tax });
    e.push({ account: ACC.employerFees, amount: calc.employerFee });
    e.push({ account: ACC.employerFeeDebt, amount: -calc.employerFee });
    for (const i of items.filter((x) => x.type === 'reimbursement')) e.push({ account: i.account ?? 6900, amount: i.amount });
    // Löneutmätning innehålls för Kronofogden (2750); övriga nettolöneavdrag minskar fordran på den anställde (1610)
    const garnished = items.filter((x) => x.type === 'net_deduction' && x.code === 'garnishment').reduce((s, x) => s + x.amount, 0);
    if (calc.netDeductions - garnished) e.push({ account: ACC.employeeReceivables, amount: -(calc.netDeductions - garnished) });
    if (garnished) e.push({ account: 2750, amount: -garnished, description: 'Löneutmätning' });
    e.push({ account: ACC.bank, amount: -calc.netPay });
  }
  return fromSigned(e);
}
