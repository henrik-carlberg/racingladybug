// Egna rapporter och nyckeltal – ren logik (testbar). Belopp i öre.

export interface Term { from: number; to: number; sign: 1 | -1 }
export interface RowDef { key: string; label: string; type: 'accounts' | 'formula' | 'heading'; value: string; bold?: boolean }
export interface ReportDef { rows: RowDef[]; columns: 'months' | 'quarters' | 'year'; compare: boolean; budget: boolean }

/** "3000-3999, -4000-4999, 8310" → intervall med tecken. Konton 1000–8999. */
export function parseRanges(s: string): Term[] {
  const out: Term[] = [];
  for (const part of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([+-])?\s*(\d{4})(?:\s*-\s*(\d{4}))?$/.exec(part);
    if (!m) throw new Error(`Ogiltigt kontointervall "${part}" – skriv t.ex. 3000-3999 eller -4000-4999`);
    const from = Number(m[2]), to = Number(m[3] ?? m[2]);
    if (from < 1000 || to > 8999 || to < from) throw new Error(`Ogiltigt kontointervall "${part}"`);
    out.push({ from, to, sign: m[1] === '-' ? -1 : 1 });
  }
  if (!out.length) throw new Error('Ange minst ett konto eller kontointervall');
  return out;
}
/** Visningstecken: tillgångar och kostnader positiva i debet, skulder, eget kapital och intäkter positiva i kredit */
export const displaySign = (acct: number) => (acct < 2000 ? 1 : acct < 4000 ? -1 : acct < 8000 ? 1 : -1);
export const isBalanceRow = (terms: Term[]) => terms.every((t) => t.to < 3000);

/** Summa för intervallen. Bokförda saldon (debet − kredit) får visningstecken; budgeten är redan i visningstecken. */
export function sumTerms(terms: Term[], m: Map<number, number>, alreadyDisplayed = false): number {
  let v = 0;
  for (const [acct, raw] of m) for (const t of terms) if (acct >= t.from && acct <= t.to) v += t.sign * (alreadyDisplayed ? 1 : displaySign(acct)) * Number(raw);
  return v;
}

// ---------- Formler: rader refereras med nyckel (r1, r2 …); + − * / och parenteser. Ingen eval. ----------
type Tok = { t: 'num'; v: number } | { t: 'ref'; v: string } | { t: 'op'; v: string } | { t: '('} | { t: ')' };
function tokenize(s: string): Tok[] {
  const out: Tok[] = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; out.push({ t: 'num', v: Number(s.slice(i, j)) }); i = j; continue; }
    if (/[a-z]/i.test(c)) { let j = i; while (j < s.length && /[a-z0-9_]/i.test(s[j])) j++; out.push({ t: 'ref', v: s.slice(i, j).toLowerCase() }); i = j; continue; }
    if ('+-*/'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    if (c === '(' || c === ')') { out.push({ t: c }); i++; continue; }
    throw new Error(`Ogiltigt tecken "${c}" i formeln`);
  }
  return out;
}
/** Räknar ut en formel. Division med noll ger null. Referenser till okända rader är fel. */
export function evalFormula(expr: string, vals: Record<string, number | null>): number | null {
  const toks = tokenize(expr); let p = 0;
  const peek = () => toks[p];
  const prim = (): number | null => {
    const k = toks[p++];
    if (!k) throw new Error('Formeln slutar för tidigt');
    if (k.t === 'num') return k.v;
    if (k.t === 'ref') { if (!Object.hasOwn(vals, k.v)) throw new Error(`Okänd rad "${k.v}" i formeln`); return vals[k.v]; }
    if (k.t === 'op' && k.v === '-') { const x = prim(); return x == null ? null : -x; }
    if (k.t === '(') { const x = sum(); if (toks[p++]?.t !== ')') throw new Error('Parentes saknas i formeln'); return x; }
    throw new Error('Ogiltig formel');
  };
  const prod = (): number | null => {
    let x = prim();
    while (peek()?.t === 'op' && ['*', '/'].includes((peek() as { v: string }).v)) {
      const op = (toks[p++] as { v: string }).v, y = prim();
      x = x == null || y == null ? null : op === '*' ? x * y : y === 0 ? null : x / y;
    }
    return x;
  };
  const sum = (): number | null => {
    let x = prod();
    while (peek()?.t === 'op' && ['+', '-'].includes((peek() as { v: string }).v)) {
      const op = (toks[p++] as { v: string }).v, y = prod();
      x = x == null || y == null ? null : op === '+' ? x + y : x - y;
    }
    return x;
  };
  const v = sum();
  if (p !== toks.length) throw new Error('Ogiltig formel');
  return v;
}

export function validateDef(d: ReportDef): string[] {
  const errs: string[] = [];
  if (!d.rows.length) errs.push('Lägg till minst en rad');
  if (d.rows.length > 40) errs.push('Högst 40 rader');
  const keys = new Set<string>();
  d.rows.forEach((r, i) => {
    if (!/^r\d{1,2}$/.test(r.key)) errs.push(`Rad ${i + 1}: ogiltig nyckel`);
    if (!r.label.trim()) errs.push(`Rad ${i + 1}: ange en rubrik`);
    try {
      if (r.type === 'accounts') parseRanges(r.value);
      if (r.type === 'formula') evalFormula(r.value, Object.fromEntries([...keys].map((k) => [k, 1])));
    } catch (e) { errs.push(`Rad ${i + 1}: ${(e as Error).message}`); }
    keys.add(r.key);
  });
  return errs;
}

export interface ColumnData { label: string; result: Map<number, number>; balance: Map<number, number>; budget?: Map<number, number> | null }
/** Räknar ut rapporten: en kolumn per period; formler räknas per kolumn i radordning */
export function evaluate(d: ReportDef, cols: ColumnData[]) {
  return d.rows.map((r) => r).reduce<{ key: string; label: string; type: RowDef['type']; bold?: boolean; values: (number | null)[]; budget: (number | null)[] }[]>((acc, r) => {
    const prev = (ci: number, which: 'values' | 'budget') => Object.fromEntries(acc.filter((x) => x.type !== 'heading').map((x) => [x.key, x[which][ci]]));
    const val = (c: ColumnData, ci: number, which: 'values' | 'budget') => {
      if (r.type === 'heading') return null;
      if (r.type === 'formula') return evalFormula(r.value, prev(ci, which));
      const terms = parseRanges(r.value);
      if (which === 'budget') return c.budget && !isBalanceRow(terms) ? sumTerms(terms, c.budget, true) : null;
      return sumTerms(terms, isBalanceRow(terms) ? c.balance : c.result);
    };
    acc.push({ key: r.key, label: r.label, type: r.type, bold: r.bold, values: cols.map((c, ci) => val(c, ci, 'values')), budget: cols.map((c, ci) => val(c, ci, 'budget')) });
    return acc;
  }, []);
}

// ---------- Nyckeltal ----------
const range = (m: Map<number, number>, a: number, b: number) => [...m].filter(([k]) => k >= a && k <= b).reduce((s, [, v]) => s + Number(v), 0);
export interface Kpis { revenue: number; grossProfit: number; grossMargin: number | null; operatingResult: number; operatingMargin: number | null; result: number; equityRatio: number | null; quickRatio: number | null; cash: number; dso: number | null; currentLiabilities: number }
/** Nyckeltal för en period (result) och balansen vid periodens slut (balance) */
export function kpis(result: Map<number, number>, balance: Map<number, number>, days: number): Kpis {
  const revenue = -range(result, 3000, 3999);
  const goods = range(result, 4000, 4999);
  const operatingCosts = range(result, 4000, 7999);
  const operatingResult = revenue - operatingCosts;
  const res = -range(result, 3000, 8999);
  const assets = range(balance, 1000, 1999);
  const equity = -range(balance, 2000, 2099) - 0.794 * range(balance, 2100, 2199); // eget kapital + obeskattade reserver efter skatt (20,6 %)
  const cash = range(balance, 1900, 1999);
  const current = range(balance, 1500, 1899) + cash;
  const currentLiabilities = -range(balance, 2400, 2999);
  const receivables = range(balance, 1500, 1599);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return {
    revenue, grossProfit: revenue - goods, grossMargin: pct(revenue - goods, revenue), operatingResult, operatingMargin: pct(operatingResult, revenue), result: res,
    equityRatio: pct(Math.round(equity), assets), quickRatio: pct(current, currentLiabilities), cash, currentLiabilities,
    dso: revenue > 0 ? Math.round((receivables / (revenue * 1.25)) * days) : null,
  };
}
export const KPI_LABEL: Record<keyof Kpis, string> = {
  revenue: 'Nettoomsättning', grossProfit: 'Bruttovinst', grossMargin: 'Bruttomarginal', operatingResult: 'Rörelseresultat', operatingMargin: 'Rörelsemarginal', result: 'Resultat',
  equityRatio: 'Soliditet', quickRatio: 'Kassalikviditet', cash: 'Kassa och bank', dso: 'Kundernas betaltid (dagar)', currentLiabilities: 'Kortfristiga skulder',
};
export const ROLE_KPIS: Record<'vd' | 'ekonomi' | 'styrelse', (keyof Kpis)[]> = {
  vd: ['revenue', 'grossMargin', 'operatingResult', 'cash', 'dso'],
  ekonomi: ['revenue', 'grossMargin', 'operatingMargin', 'result', 'cash', 'quickRatio', 'dso', 'currentLiabilities'],
  styrelse: ['revenue', 'operatingMargin', 'result', 'equityRatio', 'quickRatio', 'cash'],
};
export const PCT_KPIS: (keyof Kpis)[] = ['grossMargin', 'operatingMargin', 'equityRatio', 'quickRatio'];
