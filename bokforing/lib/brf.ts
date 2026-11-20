// Bostadsrättsföreningar (ren logik): avgifter per andelstal, avgifter vid överlåtelse och pantsättning,
// fond för yttre underhåll och de nyckeltal som ska finnas i årsredovisningen (ÅRL 6:1 och BFNAR 2023:1). Belopp i öre.
export const FEE_ACCOUNT = 3912;        // Årsavgifter (momsfria – utanför ruta 05)
export const TRANSFER_FEE_ACCOUNT = 3914; // Överlåtelse- och pantsättningsavgifter
export const INSATS_ACCOUNT = 2083;     // Inbetalda insatser
export const UPPLATELSE_ACCOUNT = 2084; // Upplåtelseavgifter
export const FUND_ACCOUNT = 2086;       // Fond för yttre underhåll
export const RETAINED_ACCOUNT = 2068;   // Balanserat resultat

/** Prisbasbelopp (för överlåtelse- och pantsättningsavgift, BRL 9:1) */
export const PRISBASBELOPP: Record<number, number> = { 2023: 5250000, 2024: 5730000, 2025: 5880000, 2026: 5920000 };
export const pbb = (year: number) => PRISBASBELOPP[year] ?? PRISBASBELOPP[Math.max(...Object.keys(PRISBASBELOPP).map(Number))];

/** Högsta tillåtna överlåtelseavgift (2,5 %) och pantsättningsavgift (1 %) av prisbasbeloppet, i hela kronor */
export const maxTransferFee = (year: number) => Math.floor((pbb(year) * 2.5) / 100 / 100) * 100;
export const maxPledgeFee = (year: number) => Math.floor(pbb(year) / 100 / 100) * 100;

export interface Apartment { id: number; share: number; area: number }

/**
 * Årsavgiften fördelad efter andelstal. Summan av alla lägenheters avgifter blir exakt budgeten
 * (avrundningsdifferens till lägenheten med högst andelstal). Returnerar avgift per period (månad eller kvartal).
 */
export function feesByShare(apartments: Apartment[], yearBudget: number, periodsPerYear: 12 | 4) {
  const total = apartments.reduce((s, a) => s + a.share, 0);
  if (!total) throw new Error('Lägenheterna saknar andelstal');
  const perPeriod = Math.round(yearBudget / periodsPerYear);
  const out = apartments.map((a) => ({ id: a.id, fee: Math.round((perPeriod * a.share) / total / 100) * 100 }));
  const diff = perPeriod - out.reduce((s, x) => s + x.fee, 0);
  const big = apartments.reduce((m, a) => (a.share > m.share ? a : m));
  out.find((x) => x.id === big.id)!.fee += diff;
  return out;
}

/** Andelstalen ska summera till 1 (eller 100) – kontroll för lägenhetsförteckningen */
export function shareSum(apartments: { share: number }[]) {
  const s = Math.round(apartments.reduce((t, a) => t + a.share, 0) * 1e6) / 1e6;
  return { sum: s, ok: Math.abs(s - 1) < 1e-4 || Math.abs(s - 100) < 1e-2 };
}

/** Förändring av fond för yttre underhåll: avsättning enligt plan (från balanserat resultat) eller ianspråktagande */
export function fundLines(o: { kind: 'reserve' | 'use'; amount: number }) {
  return o.kind === 'reserve'
    ? [{ account: RETAINED_ACCOUNT, amount: o.amount }, { account: FUND_ACCOUNT, amount: -o.amount }]
    : [{ account: FUND_ACCOUNT, amount: o.amount }, { account: RETAINED_ACCOUNT, amount: -o.amount }];
}

export interface KeyInput {
  fees: number;            // årsavgifter (bostadsrätter), öre
  revenue: number;         // totala rörelseintäkter
  result: number;          // årets resultat
  depreciation: number;    // avskrivningar
  plannedMaintenance: number; // kostnad för planerat underhåll
  debt: number;            // räntebärande skulder
  energy: number;          // el, värme, vatten
  brArea: number;          // yta upplåten med bostadsrätt, kvm
  totalArea: number;       // total yta (bostäder + lokaler), kvm
}

/** Nyckeltal för bostadsrättsföreningar (BFNAR 2023:1) – kronor per kvm resp. procent */
export function brfKeyFigures(k: KeyInput) {
  const perKvm = (v: number, a: number) => (a ? Math.round(v / 100 / a) : 0);
  return [
    { key: 'fee_per_kvm', label: 'Årsavgift per kvm upplåten med bostadsrätt, kr', value: perKvm(k.fees, k.brArea) },
    { key: 'fee_share', label: 'Årsavgifternas andel av totala rörelseintäkter, %', value: k.revenue ? Math.round((k.fees / k.revenue) * 1000) / 10 : 0 },
    { key: 'debt_per_kvm', label: 'Skuldsättning per kvm, kr', value: perKvm(k.debt, k.totalArea) },
    { key: 'debt_per_br_kvm', label: 'Skuldsättning per kvm upplåten med bostadsrätt, kr', value: perKvm(k.debt, k.brArea) },
    { key: 'saving_per_kvm', label: 'Sparande per kvm, kr', value: perKvm(k.result + k.depreciation + k.plannedMaintenance, k.totalArea) },
    { key: 'interest_sensitivity', label: 'Räntekänslighet, %', value: k.fees ? Math.round((k.debt / 100 / k.fees) * 1000) / 10 : 0 },
    { key: 'energy_per_kvm', label: 'Energikostnad per kvm, kr', value: perKvm(k.energy, k.totalArea) },
  ];
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kr = (o: number) => `${Math.round(o / 100).toLocaleString('sv-SE')} kr`;

/** Lägenhetsförteckning enligt BRL 9:8 */
export function registerHtml(o: { org: string; orgnr: string; date: string; rows: { number: string; skv: string; floor: string; rooms: string; area: number; purpose: string; owners: string; insats: number; since: string; pledges: string[] }[] }) {
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Lägenhetsförteckning</title><style>body{font-family:Georgia,serif;margin:24px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{border:1px solid #ccc;padding:3px 5px;text-align:left}</style></head><body>
<h1>Lägenhetsförteckning</h1><p>${esc(o.org)}${o.orgnr ? `, ${esc(o.orgnr)}` : ''} – per ${esc(o.date)}</p>
<table><thead><tr><th>Lgh</th><th>Skatteverkets nr</th><th>Läge</th><th>Rum</th><th>Yta kvm</th><th>Ändamål</th><th>Bostadsrättshavare</th><th>Insats</th><th>Upplåten/förvärvad</th><th>Pantsättningar</th></tr></thead><tbody>
${o.rows.map((r) => `<tr><td>${esc(r.number)}</td><td>${esc(r.skv)}</td><td>${esc(r.floor)}</td><td>${esc(r.rooms)}</td><td>${r.area}</td><td>${esc(r.purpose)}</td><td>${esc(r.owners)}</td><td>${kr(r.insats)}</td><td>${esc(r.since)}</td><td>${r.pledges.map(esc).join('<br>')}</td></tr>`).join('')}
</tbody></table></body></html>`;
}
