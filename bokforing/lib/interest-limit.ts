// Ränteavdragsbegränsning (inkomstskattelagen 24 kap. 21–29 §§): EBITDA-regeln och förenklingsregeln. Belopp i öre.
export const EBITDA_SHARE = 0.3;
export const SIMPLIFICATION = 500000000; // 5 miljoner kronor (delas inom en intressegemenskap)
export const CARRY_YEARS = 6;

export interface YearIn { year: number; start: string; end: string; interestIncome: number; interestCost: number; taxable: number; depreciation: number }

/** Negativt räntenetto och skattemässig EBITDA för året (det skattemässiga resultatet är före ränteavdragsbegränsningen) */
export function yearBase(y: YearIn) {
  const netCost = Math.max(0, y.interestCost - y.interestIncome);
  const ebitda = y.taxable + netCost + y.depreciation;
  return { netCost, ebitda, room: Math.max(0, Math.round(ebitda * EBITDA_SHARE)) };
}

export interface YearOut { netCost: number; ebitda: number; room: number; rule: 'none' | 'simplification' | 'ebitda'; deductible: number; nonDeductible: number; usedSaved: number; expired: number; savedOut: number; saved: { year: number; amount: number }[] }

/**
 * Rullar året framåt. Förenklingsregeln ger avdrag för hela räntenettot om det är högst förenklingsbeloppet; annars gäller
 * EBITDA-regeln. Sparat negativt räntenetto (högst sex år) får bara användas inom EBITDA-utrymmet som blir över.
 */
export function rollForward<T extends YearIn>(years: T[], simplification = SIMPLIFICATION): (T & YearOut)[] {
  let saved: { year: number; amount: number }[] = [];
  return [...years].sort((a, b) => a.start.localeCompare(b.start)).map((y) => {
    const b = yearBase(y);
    const expired = saved.filter((s) => y.year - s.year > CARRY_YEARS).reduce((t, s) => t + s.amount, 0);
    saved = saved.filter((s) => y.year - s.year <= CARRY_YEARS);
    let rule: YearOut['rule'] = 'none', deductible = b.netCost, nonDeductible = 0, usedSaved = 0;
    if (b.netCost > 0 && b.netCost <= simplification) rule = 'simplification';
    else if (b.netCost > 0) {
      rule = 'ebitda';
      deductible = Math.min(b.netCost, b.room);
      nonDeductible = b.netCost - deductible;
    }
    if (rule !== 'simplification') {
      // Utrymme som blir över i år får användas för sparat räntenetto (äldst först)
      let left = b.room - (rule === 'ebitda' ? deductible : 0);
      for (const s of saved) { const u = Math.min(left, s.amount); s.amount -= u; usedSaved += u; left -= u; }
      saved = saved.filter((s) => s.amount > 0);
    }
    if (nonDeductible) saved.push({ year: y.year, amount: nonDeductible });
    return { ...y, ...b, rule, deductible, nonDeductible, usedSaved, expired, savedOut: saved.reduce((t, s) => t + s.amount, 0), saved: saved.map((s) => ({ ...s })) };
  });
}
