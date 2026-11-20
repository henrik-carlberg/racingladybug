// Kassaflödesanalys enligt indirekt metod (K3 kap. 7) – ren logik.
// Utgår från periodens rörelser per konto (debet − kredit) och delar in varje konto i exakt en post,
// så att summan alltid blir förändringen av likvida medel (19xx).
export type Movements = Map<number, number>;

export interface CashFlowLine { key: string; label: string; amount: number }
export interface CashFlow {
  operating: CashFlowLine[]; beforeWorkingCapital: number; workingCapital: CashFlowLine[]; operatingTotal: number;
  investing: CashFlowLine[]; investingTotal: number; financing: CashFlowLine[]; financingTotal: number;
  change: number; cashChange: number;
}

const inR = (n: number, a: number, b: number) => n >= a && n <= b;
type Bucket = 'result' | 'tax' | 'other_noncash' | 'provisions' | 'inventory' | 'receivables' | 'liabilities' | 'invest_fixed' | 'invest_short' | 'loans' | 'equity' | 'dividend' | 'cash';

export function bucketOf(n: number): Bucket {
  if (inR(n, 1900, 1999)) return 'cash';
  if (inR(n, 1000, 1399)) return 'invest_fixed';
  if (inR(n, 1400, 1499)) return 'inventory';
  if (inR(n, 1500, 1799)) return 'receivables';
  if (inR(n, 1800, 1899)) return 'invest_short';
  if (inR(n, 2000, 2099) || inR(n, 8990, 8999)) return 'equity';
  if (inR(n, 2100, 2199) || inR(n, 8500, 8899)) return 'other_noncash';
  if (inR(n, 2200, 2299)) return 'provisions';
  if (inR(n, 2300, 2399) || inR(n, 2410, 2419)) return 'loans';
  if (inR(n, 2510, 2519) || inR(n, 8900, 8989)) return 'tax';
  if (n === 2898) return 'dividend';
  if (inR(n, 2400, 2999)) return 'liabilities';
  return 'result'; // 3000–8499
}

/** Indirekt kassaflödesanalys för en period. Belopp i öre, inflöde positivt. */
export function cashFlow(m: Movements): CashFlow {
  const b = new Map<Bucket, number>();
  let depreciation = 0, gains = 0;
  for (const [n, v] of m) {
    const k = bucketOf(n);
    b.set(k, (b.get(k) ?? 0) + v);
    if (inR(n, 7700, 7899)) depreciation += v;
    if (inR(n, 3970, 3979) || inR(n, 7970, 7979)) gains += v; // realisationsresultat (vinst kredit → negativ)
  }
  const g = (k: Bucket) => -(b.get(k) ?? 0);
  const result = g('result');
  const operating: CashFlowLine[] = [
    { key: 'result', label: 'Resultat efter finansiella poster', amount: result },
    { key: 'depreciation', label: 'Av- och nedskrivningar', amount: depreciation },
    { key: 'gains', label: 'Realisationsresultat vid avyttring', amount: gains },
    { key: 'provisions', label: 'Förändring av avsättningar', amount: g('provisions') },
    { key: 'other', label: 'Bokslutsdispositioner och övriga ej kassapåverkande poster', amount: g('other_noncash') },
    { key: 'tax', label: 'Betald inkomstskatt', amount: g('tax') },
  ];
  const beforeWorkingCapital = operating.reduce((s, l) => s + l.amount, 0);
  const workingCapital: CashFlowLine[] = [
    { key: 'inventory', label: 'Förändring av varulager', amount: g('inventory') },
    { key: 'receivables', label: 'Förändring av rörelsefordringar', amount: g('receivables') },
    { key: 'liabilities', label: 'Förändring av rörelseskulder', amount: g('liabilities') },
  ];
  const operatingTotal = beforeWorkingCapital + workingCapital.reduce((s, l) => s + l.amount, 0);
  // Anläggningstillgångar netto (inkl. ackumulerade avskrivningar): avskrivningar och realisationsresultat är redan återlagda ovan
  const investing: CashFlowLine[] = [
    { key: 'fixed', label: 'Investeringar i och avyttringar av anläggningstillgångar', amount: g('invest_fixed') - depreciation - gains },
    { key: 'short', label: 'Förändring av kortfristiga placeringar', amount: g('invest_short') },
  ];
  const investingTotal = investing.reduce((s, l) => s + l.amount, 0);
  const financing: CashFlowLine[] = [
    { key: 'loans', label: 'Upptagna och amorterade lån', amount: g('loans') },
    { key: 'equity', label: 'Nyemission, aktieägartillskott och utdelning', amount: g('equity') + g('dividend') },
  ];
  const financingTotal = financing.reduce((s, l) => s + l.amount, 0);
  return { operating, beforeWorkingCapital, workingCapital, operatingTotal, investing, investingTotal, financing, financingTotal,
    change: operatingTotal + investingTotal + financingTotal, cashChange: b.get('cash') ?? 0 };
}

// ---------- K3 ----------
export const DEFERRED_TAX_RATE = 20.6;
export const DEFERRED_TAX_LIABILITY = 2240; // Avsättningar för uppskjutna skatter
export const DEFERRED_TAX_ASSET = 1370;     // Uppskjuten skattefordran
export const DEFERRED_TAX_COST = 8940;      // Uppskjuten skatt

/**
 * Uppskjuten skatt på temporära skillnader (K3 kap. 29). Positiv skillnad = bokfört värde över skattemässigt (skatteskuld),
 * negativ = skattefordran (t.ex. underskottsavdrag). Obeskattade reserver i juridisk person redovisas brutto och ingår inte.
 */
export function deferredTax(diffs: { label: string; amount: number }[], rate = DEFERRED_TAX_RATE) {
  const rows = diffs.map((d) => ({ ...d, tax: Math.round((d.amount * rate) / 100) }));
  const liability = rows.filter((r) => r.tax > 0).reduce((s, r) => s + r.tax, 0);
  const asset = -rows.filter((r) => r.tax < 0).reduce((s, r) => s + r.tax, 0);
  return { rows, liability, asset, net: liability - asset };
}

/** Bokning av förändringen av uppskjuten skatt: nytt nettobelopp mot nuvarande saldo på 2240 och 1370 */
export function deferredTaxEntry(target: { liability: number; asset: number }, current: { liability: number; asset: number }) {
  const dl = target.liability - current.liability; // ökning av skuld (kredit 2240)
  const da = target.asset - current.asset;          // ökning av fordran (debet 1370)
  const lines: { account: number; amount: number }[] = [];
  if (dl) lines.push({ account: DEFERRED_TAX_LIABILITY, amount: -dl });
  if (da) lines.push({ account: DEFERRED_TAX_ASSET, amount: da });
  const cost = dl - da;
  if (cost) lines.push({ account: DEFERRED_TAX_COST, amount: cost });
  return lines;
}

/** Vad som ändras vid byte från K2 till K3 – underlag för förklaringen innan bytet */
export function k3Changes(o: { buildingsWithoutComponents: number; untaxedReserves: number; hasCashFlow: boolean; larger: boolean }) {
  const out: { title: string; detail: string }[] = [
    { title: 'Jämförelsetalen räknas om', detail: 'Första året med K3 ska föregående års siffror presenteras som om K3 alltid tillämpats (K3 kap. 35). Ingående eget kapital justeras för effekten.' },
    { title: 'Komponentavskrivning', detail: o.buildingsWithoutComponents ? `${o.buildingsWithoutComponents} byggnad(er) saknar uppdelning i komponenter. Byggnader med väsentliga delar med olika nyttjandeperiod ska delas upp (K3 kap. 17).` : 'Byggnaderna är redan uppdelade i komponenter.' },
    { title: 'Uppskjuten skatt', detail: 'Temporära skillnader mellan bokförda och skattemässiga värden ger uppskjuten skatt (2240/1370). Obeskattade reserver redovisas fortsatt brutto i juridisk person, men uppskjuten skatt i dem anges i not.' },
    { title: 'Utökade noter', detail: 'Redovisningsprinciper, uppskattningar och bedömningar, anläggningstillgångar per slag, uppskjuten skatt, ställda säkerheter och eventualförpliktelser.' },
    { title: 'Kassaflödesanalys', detail: o.larger ? 'Krävs för större företag (ÅRL 2:1) – den tas med i årsredovisningen.' : 'Krävs inte för mindre företag men tas med i årsredovisningen eftersom den ger bättre information.' },
  ];
  if (o.untaxedReserves) out.push({ title: 'Obeskattade reserver', detail: 'Den uppskjutna skatten i obeskattade reserver (20,6 %) upplyses i not. I koncernredovisning delas de upp i eget kapital och uppskjuten skatt.' });
  return out;
}
