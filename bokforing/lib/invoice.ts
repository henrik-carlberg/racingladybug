import { ACC } from './bas';
import { fromSigned, type Line } from './ledger-lines';
import { roundToKrona } from './money';

export interface InvoiceLineInput {
  description: string;
  quantity: number; // kan ha decimaler
  unit: string;
  unitPrice: number; // öre exkl moms
  vatRate: 0 | 6 | 12 | 25;
  account: number;
  labor?: boolean; // arbetskostnad (grund för ROT/RUT-avdrag)
}

export interface InvoiceTotals {
  net: number;
  vat: number;
  vatByRate: Record<number, { base: number; vat: number }>;
  rounding: number;
  total: number;
  lineNets: number[];
}

export function lineNet(l: Pick<InvoiceLineInput, 'quantity' | 'unitPrice'>): number {
  return Math.round(l.quantity * l.unitPrice);
}

export function computeInvoice(lines: InvoiceLineInput[], opts: { reverseCharge?: boolean; roundToKrona?: boolean } = {}): InvoiceTotals {
  const lineNets = lines.map(lineNet);
  const vatByRate: Record<number, { base: number; vat: number }> = {};
  lines.forEach((l, i) => {
    const rate = opts.reverseCharge ? 0 : l.vatRate;
    vatByRate[rate] ??= { base: 0, vat: 0 };
    vatByRate[rate].base += lineNets[i];
  });
  for (const [rate, v] of Object.entries(vatByRate)) v.vat = Math.round((v.base * Number(rate)) / 100);
  const net = lineNets.reduce((a, b) => a + b, 0);
  const vat = Object.values(vatByRate).reduce((a, v) => a + v.vat, 0);
  const exact = net + vat;
  const total = opts.roundToKrona === false ? exact : roundToKrona(exact);
  return { net, vat, vatByRate, rounding: total - exact, total, lineNets };
}

/** Kontering av kundfaktura (eller kreditfaktura om sign = -1). reduction: ROT/RUT-avdrag som fordras från Skatteverket (1513). */
export function invoiceBookingLines(lines: InvoiceLineInput[], t: InvoiceTotals, sign: 1 | -1 = 1, reduction = 0): Line[] {
  const e: { account: number; amount: number }[] = [];
  e.push({ account: ACC.customerReceivables, amount: sign * (t.total - reduction) });
  if (reduction) e.push({ account: ACC.taxReductionReceivable, amount: sign * reduction });
  lines.forEach((l, i) => e.push({ account: l.account, amount: -sign * t.lineNets[i] }));
  for (const [rate, v] of Object.entries(t.vatByRate)) {
    if (v.vat === 0) continue;
    e.push({ account: ACC.vatOut[Number(rate)], amount: -sign * v.vat });
  }
  if (t.rounding) e.push({ account: ACC.rounding, amount: -sign * t.rounding });
  return fromSigned(e);
}

export function invoicePaymentLines(amount: number, bankAccount = ACC.bank): Line[] {
  return fromSigned([
    { account: bankAccount, amount },
    { account: ACC.customerReceivables, amount: -amount },
  ]);
}

/** Föreslaget intäktskonto utifrån momssats och om köparen är EU-företag med omvänd skattskyldighet */
export function defaultSalesAccount(vatRate: number, reverseCharge: boolean): number {
  if (reverseCharge) return ACC.salesEuServices;
  return ACC.sales[vatRate] ?? ACC.sales[25];
}
