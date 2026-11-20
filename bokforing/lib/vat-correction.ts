// Rättelse av momsdeklaration (ren logik). Saldo = debet − kredit i öre.
import { vatReport, vatSettlementLines, type AccountSums } from './vat';

/** Skillnaden mellan periodens saldon nu och när den deklarerades */
export function diffSums(current: AccountSums, declared: AccountSums): AccountSums {
  const out = new Map<number, number>();
  for (const n of new Set([...current.keys(), ...declared.keys()])) { const d = (current.get(n) ?? 0) - (declared.get(n) ?? 0); if (d) out.set(n, d); }
  return out;
}

/** Rutorna som ändras: deklarerat, nytt belopp och skillnad */
export function boxDiff(current: AccountSums, declared: AccountSums) {
  const a = vatReport(current), b = vatReport(declared);
  const prev = new Map(b.boxes.map((x) => [x.box, x.amount]));
  const rows = a.boxes.map((x) => ({ box: x.box, label: x.label, declared: prev.get(x.box) ?? 0, current: x.amount, diff: x.amount - (prev.get(x.box) ?? 0) })).filter((r) => r.diff);
  return { rows, declaredToPay: b.toPay, currentToPay: a.toPay, toPayDiff: a.toPay - b.toPay };
}

/** Rättelseverifikationen: momskontona som tillkommit efter deklarationen förs till 2650 (positivt = mer att betala) */
export function correctionLines(current: AccountSums, declared: AccountSums) {
  const d = diffSums(current, declared);
  const only = new Map([...d].filter(([n]) => n >= 2610 && n <= 2649));
  return vatSettlementLines(only);
}

/** Ungefärlig förfallodag för månads- och kvartalsmoms: den 12:e i andra månaden efter perioden */
export function dueDate(periodEnd: string) {
  const [y, m] = periodEnd.split('-').map(Number);
  const d = new Date(Date.UTC(y, m + 1, 12));
  return d.toISOString().slice(0, 10);
}

export const toMap = (o: Record<string, number>): AccountSums => new Map(Object.entries(o).map(([k, v]) => [Number(k), Number(v)]));
export const fromMap = (m: AccountSums): Record<string, number> => Object.fromEntries([...m].filter(([, v]) => v).map(([k, v]) => [String(k), v]));
