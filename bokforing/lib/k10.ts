// 3:12-reglerna för fåmansaktiebolag: gränsbelopp (K10) och lön eller utdelning. Ren logik, belopp i öre.
// Regler före och från inkomstår 2026 (förenklade 3:12-regler). Parametrarna visas i appen och kan ändras;
// kontrollera alltid mot Skatteverkets K10-blankett för inkomståret.

/** Inkomstbasbelopp (kr) per år */
export const IBB: Record<number, number> = { 2021: 68200, 2022: 71000, 2023: 74300, 2024: 76200, 2025: 80600, 2026: 83400 };
export const ibbFor = (year: number) => IBB[year] ?? IBB[Math.max(...Object.keys(IBB).map(Number).filter((y) => y <= year))] ?? 80600;

export interface K10Params {
  year: number; // inkomstår (året utdelningen tas emot)
  ibb: number; // kr, inkomstbasbeloppet året före inkomståret
  slr: number; // statslåneräntan (%) i slutet av november två år före... anges som procent, t.ex. 2.0
  newRules: boolean;
}
export function defaultParams(year: number): K10Params {
  return { year, ibb: ibbFor(year - 1), slr: 2.0, newRules: year >= 2026 };
}

export interface K10Input {
  share: number; // ägarandel i procent
  costBasis: number; // omkostnadsbelopp för aktierna (öre)
  savedSpace: number; // sparat utdelningsutrymme från förra årets K10 (öre)
  wages: number; // kontant lön i bolaget (och dotterbolag) året före inkomståret (öre)
  ownSalary: number; // egen kontant lön året före (öre)
  dividends: number; // utdelning som tas emot under inkomståret (öre)
}

export interface K10Result {
  rule: 'förenkling' | 'huvudregel' | 'grundbelopp';
  basic: number; // förenklingsbelopp eller grundbelopp
  capital: number; // ränta på omkostnadsbeloppet
  wageBased: number; // lönebaserat utrymme
  wageRequirementMet: boolean | null; // null när lönekravet inte finns (nya regler)
  wageRequirement: number;
  savedUplifted: number;
  limit: number; // årets gränsbelopp inkl. sparat utrymme
  withinLimit: number; // utdelning inom gränsbeloppet (beskattas med 20 %)
  aboveLimit: number; // utdelning över gränsbeloppet (beskattas som tjänst)
  savedNext: number; // sparat utdelningsutrymme att föra vidare
  taxWithin: number;
  notes: string[];
}

const r = (x: number) => Math.round(x);

export function k10(p: K10Params, i: K10Input): K10Result {
  const s = Math.max(0, Math.min(100, i.share)) / 100;
  const ibb = p.ibb * 100; // öre
  const notes: string[] = [];
  if (i.share < 4) notes.push('Lönebaserat utrymme kräver att du äger minst 4 % av kapitalet.');
  const capital = i.costBasis > 10_000_000 ? r(i.costBasis * ((p.slr + 9) / 100)) : 0;
  let basic: number, wageBased = 0, rule: K10Result['rule'], wageRequirement = 0, met: boolean | null = null, savedUplifted: number;
  if (p.newRules) {
    // Från 2026: grundbelopp 4 IBB fördelat efter ägarandel, lönebaserat 50 % av lönerna över 8 IBB, inget lönekrav, ingen uppräkning av sparat utrymme
    basic = r(4 * ibb * s);
    if (i.share >= 4) wageBased = r(0.5 * Math.max(0, i.wages - 8 * ibb) * s);
    savedUplifted = i.savedSpace;
    rule = 'grundbelopp';
    notes.push('Förenklade 3:12-regler från inkomstår 2026: grundbelopp 4 inkomstbasbelopp, lönebaserat utrymme 50 % av lönesumman över 8 inkomstbasbelopp.');
  } else {
    // Före 2026: förenklingsregeln 2,75 IBB eller huvudregeln (ränta på omkostnadsbelopp + lönebaserat utrymme med lönekrav)
    const simplified = r(2.75 * ibb * s);
    wageRequirement = r(Math.min(6 * ibb + 0.05 * i.wages, 9.6 * ibb));
    met = i.ownSalary >= wageRequirement;
    if (met && i.share >= 4) wageBased = Math.min(r(0.5 * i.wages * s), 50 * i.ownSalary);
    else if (!met) notes.push(`Lönekravet är inte uppfyllt (egen lön behövde vara minst ${Math.round(wageRequirement / 100).toLocaleString('sv-SE')} kr).`);
    const main = capital + wageBased;
    rule = main > simplified ? 'huvudregel' : 'förenkling';
    basic = rule === 'förenkling' ? simplified : 0;
    savedUplifted = r(i.savedSpace * (1 + (p.slr + 3) / 100));
  }
  const yearSpace = p.newRules ? basic + capital + wageBased : rule === 'förenkling' ? basic : capital + wageBased;
  const limit = yearSpace + savedUplifted;
  const withinLimit = Math.min(i.dividends, limit);
  const aboveLimit = Math.max(0, i.dividends - limit);
  return {
    rule, basic, capital: p.newRules || rule === 'huvudregel' ? capital : 0, wageBased: p.newRules || rule === 'huvudregel' ? wageBased : 0,
    wageRequirementMet: met, wageRequirement, savedUplifted, limit, withinLimit, aboveLimit, savedNext: limit - withinLimit, taxWithin: r(withinLimit * 0.2), notes,
  };
}

// ---- Lön eller utdelning (förenklad) ----
export interface PayoutParams { profit: number; limit: number; municipalTax: number; stateThreshold: number; employerFee?: number; corporateTax?: number }
export interface Scenario { salary: number; dividend: number; employerFee: number; corporateTax: number; incomeTax: number; dividendTax: number; net: number }

/** Kvar till ägaren när vinsten (före lön och skatt) tas ut som lön (salary, brutto) och resten som utdelning. */
export function scenario(p: PayoutParams, salary: number): Scenario {
  const fee = (p.employerFee ?? 31.42) / 100, ct = (p.corporateTax ?? 20.6) / 100, k = p.municipalTax / 100;
  const s = Math.max(0, Math.min(salary, p.profit / (1 + fee)));
  const employerFee = r(s * fee);
  const rest = Math.max(0, p.profit - s - employerFee);
  const corporateTax = r(rest * ct);
  const dividend = rest - corporateTax;
  const incomeTax = r(s * k + Math.max(0, s - p.stateThreshold) * 0.2);
  const within = Math.min(dividend, p.limit);
  // Utdelning över gränsbeloppet beskattas som tjänst ovanpå lönen
  const above = dividend - within;
  const aboveTax = r(above * k + Math.max(0, Math.min(above, s + above - p.stateThreshold)) * 0.2);
  const dividendTax = r(within * 0.2) + aboveTax;
  return { salary: r(s), dividend: r(dividend), employerFee, corporateTax, incomeTax, dividendTax, net: r(s - incomeTax + dividend - dividendTax) };
}

/** Jämför bara lön, bara utdelning, lön upp till brytpunkten och den bästa fördelningen (steg om 10 000 kr) */
export function compareScenarios(p: PayoutParams) {
  const maxSalary = p.profit / (1 + (p.employerFee ?? 31.42) / 100);
  let best = scenario(p, 0);
  for (let s = 0; s <= maxSalary; s += 1_000_000) { const x = scenario(p, s); if (x.net > best.net) best = x; }
  return {
    allSalary: scenario(p, maxSalary),
    allDividend: scenario(p, 0),
    toThreshold: scenario(p, Math.min(p.stateThreshold, maxSalary)),
    best,
  };
}

/** Skiktgräns för statlig inkomstskatt (kr, beskattningsbar inkomst) per år */
export const STATE_THRESHOLD: Record<number, number> = { 2024: 598500, 2025: 625800, 2026: 643000 };
export const stateThresholdFor = (year: number) => STATE_THRESHOLD[year] ?? STATE_THRESHOLD[Math.max(...Object.keys(STATE_THRESHOLD).map(Number).filter((y) => y <= year))] ?? 625800;
