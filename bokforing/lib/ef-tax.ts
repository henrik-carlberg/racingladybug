// Skatteplanering för enskild firma (ren logik): räntefördelning, periodiseringsfond, expansionsfond och schablonavdrag för egenavgifter.
// Satser som ändras varje år (statslåneränta, kommunalskatt, brytpunkt) anges av användaren. Belopp i öre. Förenklingar anges i texten.
export const EGENAVGIFT = 0.2897;          // full egenavgift (under 66 år)
export const SCHABLON = 0.25;              // schablonavdrag för egenavgifter
export const CAPITAL_TAX = 0.30;           // skatt på positiv räntefördelning (inkomst av kapital)
export const EXPANSION_TAX = 0.206;        // expansionsfondsskatt
export const EXPANSION_FACTOR = 1.2594;    // högsta expansionsfond i förhållande till kapitalunderlaget
export const PFOND_SHARE = 0.30;           // periodiseringsfond, enskild firma
export const POS_LIMIT = 5000000;          // positiv räntefördelning när kapitalunderlaget överstiger 50 000 kr
export const NEG_LIMIT = -50000000;        // negativ räntefördelning när underlaget understiger −500 000 kr

export interface EfInput {
  result: number;            // bokfört resultat (vinst positiv)
  nonDeductible: number;     // ej avdragsgilla kostnader
  capitalStart: number;      // kapitalunderlag för räntefördelning (eget kapital vid årets ingång, skattemässigt)
  capitalEnd: number;        // kapitalunderlag för expansionsfond (eget kapital vid årets utgång före fondavsättningar)
  expansionExisting: number; // befintlig expansionsfond
  slrPct: number;            // statslåneräntan 30 november året före, procent
  municipalPct: number;      // kommunalskatt, procent
  brytpunkt: number;         // inkomst där statlig skatt börjar (före grundavdrag), öre
}

const r100 = (o: number) => Math.floor(o / 10000) * 10000; // hela hundralappar nedåt

/** Positiv (inkomst av kapital) eller negativ (ökar näringsinkomsten) räntefördelning */
export function interestAllocation(capital: number, slrPct: number) {
  if (capital > POS_LIMIT) return { kind: 'positive' as const, max: r100(capital * ((slrPct + 6) / 100)), mandatory: false };
  if (capital < NEG_LIMIT) return { kind: 'negative' as const, max: r100(-capital * ((slrPct + 1) / 100)), mandatory: true };
  return { kind: 'none' as const, max: 0, mandatory: false };
}

/** Skatt på aktiv näringsinkomst: egenavgifter (efter schablonavdrag) och kommunal + statlig skatt (förenklat, utan grundavdrag och jobbskatteavdrag) */
export function activeTax(income: number, i: Pick<EfInput, 'municipalPct' | 'brytpunkt'>) {
  if (income <= 0) return { fees: 0, deduction: 0, taxable: 0, tax: 0, total: 0 };
  const deduction = Math.round(income * SCHABLON);              // schablonavdrag för egenavgifter
  const taxable = income - deduction;                             // inkomst av näringsverksamhet efter avdraget
  const fees = Math.round(taxable * EGENAVGIFT);                  // egenavgifter på den inkomsten
  const tax = Math.round(taxable * (i.municipalPct / 100)) + Math.round(Math.max(0, taxable - i.brytpunkt) * 0.2);
  return { fees, deduction, taxable, tax, total: tax + fees };
}

export interface Plan { interest: number; pfond: number; expansion: number; active: number; tax: number; capitalTax: number; expansionTax: number; total: number }

/** Skatt för en vald kombination av räntefördelning, periodiseringsfond och expansionsfond */
export function evaluate(i: EfInput, choice: { interest: number; pfond: number; expansion: number }): Plan {
  const surplus = i.result + i.nonDeductible;
  const ra = interestAllocation(i.capitalStart, i.slrPct);
  const interest = ra.kind === 'negative' ? -ra.max : Math.min(choice.interest, ra.max);
  const afterInterest = surplus - interest;
  const active = afterInterest - choice.pfond - choice.expansion;
  const t = activeTax(active, i);
  const capitalTax = interest > 0 ? Math.round(interest * CAPITAL_TAX) : 0;
  const expansionTax = Math.round(choice.expansion * EXPANSION_TAX);
  return { interest, pfond: choice.pfond, expansion: choice.expansion, active, tax: t.tax + t.fees, capitalTax, expansionTax, total: t.tax + t.fees + capitalTax + expansionTax };
}

/**
 * Förslag: full positiv räntefördelning (30 % i stället för marginalskatt och egenavgifter), därefter periodiseringsfond och expansionsfond
 * så att den aktiva inkomsten inte överstiger brytpunkten (där marginalskatten är högst).
 */
export function propose(i: EfInput) {
  const surplus = i.result + i.nonDeductible;
  const ra = interestAllocation(i.capitalStart, i.slrPct);
  const interest = ra.kind === 'positive' ? Math.min(ra.max, Math.max(0, surplus)) : 0;
  const afterInterest = surplus - (ra.kind === 'negative' ? -ra.max : interest);
  const pfondMax = afterInterest > 0 ? r100(afterInterest * PFOND_SHARE) : 0;
  const expMax = Math.max(0, r100(Math.min(Math.max(0, afterInterest - pfondMax), i.capitalEnd * EXPANSION_FACTOR - i.expansionExisting)));
  // Aktiv inkomst som ger brytpunkten efter schablonavdrag: income − 25 % ≈ brytpunkt
  const target = Math.round(i.brytpunkt / (1 - SCHABLON));
  let over = Math.max(0, afterInterest - target);
  const pfond = Math.min(pfondMax, r100(over));
  over -= pfond;
  const expansion = Math.min(expMax, r100(over));
  const base = evaluate(i, { interest: 0, pfond: 0, expansion: 0 });
  const plan = evaluate(i, { interest, pfond, expansion });
  return { surplus, allocation: ra, pfondMax, expMax, plan, base, saving: base.total - plan.total };
}

/** Bokföring av fondavsättningarna: periodiseringsfond som obeskattad reserv (8811/212x) och expansionsfond inom eget kapital (2010 → 2050) */
export function fundLines(o: { year: number; pfond: number; expansion: number }) {
  const l: { account: number; amount: number }[] = [];
  if (o.pfond) l.push({ account: 8811, amount: o.pfond }, { account: 2120 + (o.year % 10), amount: -o.pfond });
  if (o.expansion) l.push({ account: 2010, amount: o.expansion }, { account: 2050, amount: -o.expansion });
  return l;
}
