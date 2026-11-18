import { ACC } from './bas';
import { fromSigned, type Line } from './ledger-lines';

export interface CostLine {
  account: number;
  amount: number; // öre exkl moms
  description?: string;
  costCenterId?: number | null;
  projectId?: number | null;
}

/** Kontering av leverantörsfaktura: kostnader + ingående moms mot leverantörsskuld */
export function supplierInvoiceLines(costs: CostLine[], vat: number, total: number): Line[] {
  const costSum = costs.reduce((s, c) => s + c.amount, 0);
  if (costSum + vat !== total) {
    throw new Error(`Kostnader (${costSum / 100}) + moms (${vat / 100}) stämmer inte med totalbeloppet (${total / 100})`);
  }
  return fromSigned([
    ...costs.map((c) => ({ account: c.account, amount: c.amount, description: c.description, costCenterId: c.costCenterId, projectId: c.projectId })),
    { account: ACC.vatIn, amount: vat },
    { account: ACC.supplierDebts, amount: -total },
  ]);
}

export function supplierPaymentLines(amount: number, bankAccount = ACC.bank): Line[] {
  return fromSigned([
    { account: ACC.supplierDebts, amount },
    { account: bankAccount, amount: -amount },
  ]);
}
