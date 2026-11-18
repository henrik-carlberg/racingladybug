// Periodiseringar – ren logik (testbar)
import { addMonths } from './assets';

export const ACCRUAL_KINDS = {
  prepaid_expense: { label: 'Förutbetald kostnad', balance: 1790, balanceName: 'Övriga förutbetalda kostnader och upplupna intäkter' },
  prepaid_income: { label: 'Förutbetald intäkt', balance: 2990, balanceName: 'Övriga upplupna kostnader och förutbetalda intäkter' },
} as const;
export type AccrualKind = keyof typeof ACCRUAL_KINDS;

/** Jämn fördelning över månader; öresavrundningen läggs på sista månaden */
export function accrualSchedule(amount: number, months: number, first: string): { period: string; amount: number }[] {
  const per = Math.floor(amount / months);
  return Array.from({ length: months }, (_, i) => ({ period: addMonths(first, i), amount: i === months - 1 ? amount - per * (months - 1) : per }));
}

/** Månader som ska bokföras till och med upTo och inte redan är bokförda */
export function dueAccrualPeriods(amount: number, months: number, first: string, upTo: string, booked: Set<string>) {
  return accrualSchedule(amount, months, first).filter((p) => p.period <= upTo && !booked.has(p.period));
}

/** Upplupna arbetsgivaravgifter på semesterlöneskulden (standard 31,42 %) */
export const EMPLOYER_FEE_RATE = 0.3142;
export function accruedEmployerFees(vacationLiability: number, rate = EMPLOYER_FEE_RATE) {
  return Math.round(vacationLiability * rate);
}

/** Värdet av en sparad/outtagen semesterdag enligt sammalöneregeln: 4,6 % av månadslönen */
export const VACATION_DAY_SHARE = 0.046;
export const vacationLiability = (monthly: number, daysLeft: number) => Math.round(monthly * VACATION_DAY_SHARE * Math.max(0, daysLeft));
