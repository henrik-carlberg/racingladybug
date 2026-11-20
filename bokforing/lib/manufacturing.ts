// Tillverkning med stycklistor (ren logik). Belopp i öre, tid i minuter.
export const WIP = 1440, INVENTORY = 1460, WIP_CHANGE = 4940;
export interface SignedLine { account: number; amount: number }

export interface Bom { laborMinutes: number; laborRate: number; overheadPct: number; lines: { componentId: number; qty: number; avgCost: number }[] }

/** Kalkylerad självkostnad för ett antal: material till snittpris, arbete och omkostnadspålägg */
export function calculate(b: Bom, qty: number) {
  const material = Math.round(b.lines.reduce((s, l) => s + l.qty * qty * l.avgCost, 0));
  const labor = Math.round((b.laborMinutes * qty * b.laborRate) / 60);
  const overhead = Math.round(((material + labor) * b.overheadPct) / 100);
  return { material, labor, overhead, total: material + labor + overhead, perUnit: qty ? (material + labor + overhead) / qty : 0 };
}

/** Start: materialet tas från lagret till produkter i arbete */
export const startLines = (material: number): SignedLine[] => material ? [{ account: WIP, amount: material }, { account: INVENTORY, amount: -material }] : [];

/** Färdigställande: arbete och omkostnader aktiveras (4940) och hela kostnaden förs från 1440 till lagret */
export function completeLines(material: number, labor: number, overhead: number): SignedLine[] {
  const total = material + labor + overhead;
  return [{ account: INVENTORY, amount: total }, { account: WIP, amount: -material }, { account: WIP_CHANGE, amount: -(labor + overhead) }].filter((l) => l.amount);
}

/** Avvikelse mellan kalkyl och utfall per kostnadsslag (positivt = dyrare än kalkylerat) */
export function variance(planned: { material: number; labor: number; overhead: number }, actual: { material: number; labor: number; overhead: number }) {
  const rows = (['material', 'labor', 'overhead'] as const).map((k) => ({ kind: k, planned: planned[k], actual: actual[k], diff: actual[k] - planned[k] }));
  const p = planned.material + planned.labor + planned.overhead, a = actual.material + actual.labor + actual.overhead;
  return { rows, planned: p, actual: a, diff: a - p, pct: p ? Math.round(((a - p) / p) * 1000) / 10 : 0 };
}
