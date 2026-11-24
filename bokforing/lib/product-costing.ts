// Produktkalkyl enligt påläggsmetoden. Belopp i öre per enhet.
export type CalcInput = { materials: { qty: number; unitCost: number }[]; batchQty: number; labourMinutes: number; labourRate: number; mo: number; to: number; affo: number };

export function calculate(c: CalcInput, price: number) {
  const batch = c.batchQty > 0 ? c.batchQty : 1;
  const material = c.materials.reduce((s, m) => s + m.qty * m.unitCost, 0) / batch;
  const labour = (c.labourMinutes / 60) * c.labourRate / batch;
  const manufacturing = material * (1 + c.mo / 100) + labour * (1 + c.to / 100);
  const selfCost = Math.round(manufacturing * (1 + c.affo / 100));
  const variable = Math.round(material + labour);
  const contribution = price - variable;
  return {
    material: Math.round(material), labour: Math.round(labour), manufacturing: Math.round(manufacturing), selfCost, variable, contribution,
    contributionPct: price ? Math.round(contribution / price * 1000) / 10 : null,
    margin: price ? Math.round((price - selfCost) / price * 1000) / 10 : null,
  };
}
/** Pris som ger målmarginalen på självkostnaden, avrundat uppåt till hela kronor */
export const suggestPrice = (selfCost: number, targetPct: number) => (targetPct >= 100 ? null : Math.ceil(selfCost / (1 - targetPct / 100) / 100 - 1e-9) * 100);
/** Kostnadsökning sedan kalkylen sparades, i procent */
export const costChange = (saved: number, now: number) => (saved > 0 ? Math.round((now - saved) / saved * 1000) / 10 : 0);
