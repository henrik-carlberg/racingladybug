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
  ossRate?: number; // köparlandets moms vid försäljning till privatperson i annat EU-land (OSS)
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
    const rate = opts.reverseCharge ? 0 : (l.ossRate ?? l.vatRate);
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
  // OSS: köparlandets moms redovisas i OSS-deklarationen och bokas därför på ett eget konto (2670)
  const oss = lines.some((l) => l.ossRate != null);
  for (const [rate, v] of Object.entries(t.vatByRate)) {
    if (v.vat === 0) continue;
    e.push({ account: oss ? 2670 : ACC.vatOut[Number(rate)], amount: -sign * v.vat });
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

/** Fakturor i utländsk valuta: raderna och dokumentet är i fakturans valuta, bokföringen i kronor */
export const CURRENCIES = ['SEK', 'EUR', 'USD', 'GBP', 'NOK', 'DKK'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const isForeign = (c: string | null | undefined) => !!c && c !== 'SEK';

/** Räknar om en fakturas belopp till kronor med kursen (kronor per valutaenhet). Öresdifferensen hamnar som avrundning. */
export function convertTotals(t: InvoiceTotals, rate: number): InvoiceTotals {
  const lineNets = t.lineNets.map((n) => Math.round(n * rate));
  const vatByRate: InvoiceTotals['vatByRate'] = {};
  for (const [r, v] of Object.entries(t.vatByRate)) vatByRate[Number(r)] = { base: Math.round(v.base * rate), vat: Math.round(v.vat * rate) };
  const net = lineNets.reduce((a, b) => a + b, 0);
  const vat = Object.values(vatByRate).reduce((a, v) => a + v.vat, 0);
  const total = Math.round(t.total * rate);
  return { net, vat, vatByRate, rounding: total - net - vat, total, lineNets };
}

/** Totaler för dokumentet (fakturans valuta) och för bokföringen (kronor) */
export function invoiceTotals(lines: InvoiceLineInput[], o: { reverseCharge: boolean; currency?: string | null; rate?: number | string | null }) {
  const foreign = isForeign(o.currency);
  const doc = computeInvoice(lines, { reverseCharge: o.reverseCharge, roundToKrona: !foreign });
  return { doc, sek: foreign ? convertTotals(doc, Number(o.rate)) : doc, foreign };
}

/** Betalning av en faktura i utländsk valuta: hela fordran regleras, skillnaden mot inbetalt belopp är kursvinst (3960) eller kursförlust (7960) */
export function fxPaymentLines(receivable: number, received: number, bank: number, clearing: number = ACC.customerReceivables, sign: 1 | -1 = 1): Line[] {
  const diff = received - receivable; // kund: positivt = vinst; leverantör (sign -1): betalat mer = förlust
  return fromSigned([
    { account: bank, amount: sign * received },
    { account: clearing, amount: -sign * receivable },
    ...(diff ? [{ account: sign * diff > 0 ? 3960 : 7960, amount: -sign * diff }] : []),
  ]);
}
