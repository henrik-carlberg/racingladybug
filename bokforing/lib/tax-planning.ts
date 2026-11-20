// Skatteplanering: skattekontoprognos, preliminärskatt, bokslutsdispositioner och momsavstämning. Ren logik, belopp i öre.
import { ESKD_FIELDS } from './eskd';

export const CORPORATE_TAX = 0.206;
const pct = (n: number) => `${(n * 100).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} %`;
const krs = (o: number) => `${Math.round(o / 100).toLocaleString('sv-SE')} kr`;

// ---------- Skattekontot ----------
export interface TaxEvent { date: string; text: string; amount: number } // amount: negativt = dras från skattekontot
export function taxForecast(balance: number, events: TaxEvent[]) {
  let b = balance;
  const rows = [...events].sort((a, z) => a.date.localeCompare(z.date)).map((e) => ({ ...e, balance: (b += e.amount) }));
  const low = rows.find((r) => r.balance < 0);
  return { rows, shortfall: low ? { date: low.date, amount: -Math.min(...rows.map((r) => r.balance)) } : null, end: b };
}

// ---------- Preliminärskatt ----------
/**
 * Årets skattepliktiga resultat räknas upp från hittills (linjärt), skatten jämförs med debiterad F-skatt.
 * AB: 20,6 % bolagsskatt. EF: ungefärlig skatt (egenavgifter ~28,97 % efter schablonavdrag 25 % och 32 % kommunalskatt) – en uppskattning.
 */
export function prelimProposal(o: { type: 'AB' | 'EF' | 'HB' | 'KB'; ytdProfit: number; nonDeductible: number; monthsElapsed: number; monthsInYear?: number; currentMonthly: number }) {
  const months = o.monthsInYear ?? 12;
  const m = Math.min(Math.max(o.monthsElapsed, 1), months);
  const profit = Math.round(((o.ytdProfit + o.nonDeductible) / m) * months);
  let tax: number;
  if (o.type === 'AB') tax = Math.max(0, Math.round(profit * CORPORATE_TAX));
  else {
    const p = Math.max(0, profit), fees = Math.round(p * 0.75 * 0.2897);
    tax = fees + Math.round(Math.max(0, p - fees) * 0.32);
  }
  const monthly = Math.ceil(tax / months / 10000) * 10000; // hela hundralappar
  const current = o.currentMonthly * months;
  const diff = tax - current;
  const change = Math.abs(diff) > Math.max(500000, current * 0.1);
  const advice = !change ? 'Den debiterade preliminärskatten stämmer ungefär med prognosen.'
    : diff > 0 ? `Prognosen ger ${krs(diff)} mer i skatt än du betalar in. Höj preliminärskatten till ${krs(monthly)} i månaden för att undvika kostnadsränta och en stor kvarskatt.`
      : `Du betalar in ${krs(-diff)} mer än prognosen. Du kan sänka preliminärskatten till ${krs(monthly)} i månaden och behålla pengarna i bolaget.`;
  return { profit, tax, monthly, current, diff, change, advice };
}

// ---------- Bokslutsdispositioner ----------
export interface Inventories { bookStart: number; overStart: number; acquisitions: number; disposals: number; bookedDepreciation: number; byYear?: { yearsHeld: number; cost: number }[]; bookEnd?: number; reserveNow?: number }
export interface Proposal { kind: 'koncernbidrag' | 'overavskrivning' | 'periodiseringsfond' | 'aterforing' | 'aterforing_overavskrivning'; title: string; amount: number; taxEffect: number; explanation: string; lines: { account: number; amount: number }[]; required?: boolean }

/** Största tillåtna skattemässiga avskrivning på inventarier: huvudregeln (30-regeln) och kompletteringsregeln (20-regeln), det förmånligaste */
export function maxDepreciation(inv: Inventories) {
  const taxStart = inv.bookStart - inv.overStart;
  const base = Math.max(0, taxStart + inv.acquisitions - inv.disposals);
  const rest30 = Math.round(base * 0.7);
  const rest20 = inv.byYear ? inv.byYear.reduce((s, y) => s + Math.round(y.cost * Math.max(0, 1 - 0.2 * Math.min(5, y.yearsHeld))), 0) : Infinity;
  const rest = Math.min(rest30, rest20);
  return { base, taxStart, max: Math.max(0, base - rest), rule: rest20 < rest30 ? '20-regeln' : '30-regeln' as '20-regeln' | '30-regeln' };
}

/**
 * Inventariernas skattemässiga värde enligt de tre metoderna. Räkenskapsenlig avskrivning (30- och 20-regeln) kräver att
 * överavskrivningen bokförs (2150); restvärdesmetoden (25 %) används när bokföringen inte följer räkenskapsenlig avskrivning.
 * Reserven får som mest vara bokfört värde minus lägsta skattemässiga värde – överskjutande del ska återföras.
 */
export function depreciationMethods(inv: Inventories) {
  const m = maxDepreciation(inv);
  const rest30 = Math.round(m.base * 0.7);
  const rest20 = inv.byYear ? inv.byYear.reduce((s, y) => s + Math.round(y.cost * Math.max(0, 1 - 0.2 * Math.min(5, y.yearsHeld))), 0) : null;
  const restResidual = Math.round(m.base * 0.75);
  const lowest = rest20 == null ? rest30 : Math.min(rest30, rest20);
  const bookEnd = inv.bookEnd ?? null;
  const maxReserve = bookEnd == null ? null : Math.max(0, bookEnd - lowest);
  const reserve = inv.reserveNow ?? 0;
  return {
    base: m.base,
    rows: [
      { rule: '30-regeln (räkenskapsenlig)', depreciation: m.base - rest30, taxValue: rest30 },
      ...(rest20 == null ? [] : [{ rule: '20-regeln (kompletteringsregeln)', depreciation: m.base - rest20, taxValue: rest20 }]),
      { rule: 'Restvärdesmetoden (25 %)', depreciation: m.base - restResidual, taxValue: restResidual },
    ],
    lowest, bookEnd, maxReserve, reserve, reversal: maxReserve == null ? 0 : Math.max(0, reserve - maxReserve),
    room: maxReserve == null ? null : Math.max(0, maxReserve - reserve),
  };
}

export function yearEndProposals(o: {
  type: 'AB' | 'EF' | 'HB' | 'KB'; year: number; resultBeforeAppropriations: number; nonDeductible: number; inventories?: Inventories;
  fonds?: { account: number; year: number; amount: number }[]; group?: { name: string; result: number; ownership: number }[];
}): { proposals: Proposal[]; taxable: number; taxBefore: number; taxAfter: number } {
  const rate = o.type === 'AB' ? CORPORATE_TAX : 0.5; // EF: ungefärlig marginalskatt + egenavgifter
  const out: Proposal[] = [];
  let taxable = o.resultBeforeAppropriations + o.nonDeductible;
  const taxBefore = Math.max(0, Math.round(taxable * rate));
  // Periodiseringsfonder som är sex år gamla måste återföras i år
  for (const f of o.fonds ?? []) if (f.amount > 0 && o.year - f.year >= 6) {
    out.push({ kind: 'aterforing', title: `Återför periodiseringsfond ${f.year}`, amount: f.amount, taxEffect: -Math.round(f.amount * rate), required: true,
      explanation: `Fonden från ${f.year} måste återföras senast det sjätte året efter avsättningen. Den blir skattepliktig i år – en ny fond kan jämna ut effekten.`,
      lines: [{ account: f.account, amount: f.amount }, { account: 8819, amount: -f.amount }] });
    taxable += f.amount;
  }
  // Koncernbidrag (AB, ägt till mer än 90 %): flyttar vinst till ett koncernbolag med underskott
  if (o.type === 'AB' && taxable > 0) for (const g of o.group ?? []) if (g.ownership > 90 && g.result < 0) {
    const amount = Math.min(taxable, -g.result);
    out.push({ kind: 'koncernbidrag', title: `Koncernbidrag till ${g.name}`, amount, taxEffect: Math.round(amount * rate),
      explanation: `${g.name} har ett underskott på ${krs(-g.result)}. Ett koncernbidrag kvittar det mot vinsten här så att koncernen betalar ${krs(amount * rate)} mindre i skatt. `
        + 'Kräver att ägandet varit över 90 % hela året och att mottagaren bokför samma belopp som mottaget koncernbidrag (8820).',
      lines: [{ account: 8830, amount }, { account: 2860, amount: -amount }] });
    taxable -= amount;
  }
  // Överavskrivningar som överstiger det tillåtna måste återföras (t.ex. efter försäljning av inventarier)
  if (o.inventories && o.inventories.bookEnd != null) {
    const d = depreciationMethods(o.inventories);
    if (d.reversal > 0) {
      out.push({ kind: 'aterforing_overavskrivning', title: 'Återför överavskrivningar', amount: d.reversal, taxEffect: -Math.round(d.reversal * rate), required: true,
        explanation: `Ackumulerade överavskrivningar (${krs(d.reserve)}) får inte vara större än skillnaden mellan inventariernas bokförda värde (${krs(d.bookEnd ?? 0)}) och lägsta skattemässiga värde (${krs(d.lowest)}). Överskottet ${krs(d.reversal)} återförs och blir skattepliktigt.`,
        lines: [{ account: 2150, amount: d.reversal }, { account: 8853, amount: -d.reversal }] });
      taxable += d.reversal;
    }
  }
  // Överavskrivningar
  if (o.inventories && taxable > 0) {
    const m = maxDepreciation(o.inventories);
    const room = o.inventories.bookEnd != null ? depreciationMethods(o.inventories).room ?? Infinity : Infinity;
    const extra = Math.min(taxable, m.max - o.inventories.bookedDepreciation, room);
    if (extra > 10000) {
      out.push({ kind: 'overavskrivning', title: 'Överavskrivningar på inventarier', amount: extra, taxEffect: Math.round(extra * rate),
        explanation: `Enligt ${m.rule} får inventarierna skrivas av med upp till ${krs(m.max)} i deklarationen i år, men bokförd avskrivning enligt plan är ${krs(o.inventories.bookedDepreciation)}. `
          + `Mellanskillnaden ${krs(extra)} kan dras av som överavskrivning (obeskattad reserv) – skatten skjuts upp tills reserven löses upp.`,
        lines: [{ account: 8853, amount: extra }, { account: 2150, amount: -extra }] });
      taxable -= extra;
    }
  }
  // Periodiseringsfond: AB 25 % och EF 30 % av överskottet
  if (taxable > 0) {
    const share = o.type === 'AB' ? 0.25 : 0.3;
    const amount = Math.floor((taxable * share) / 10000) * 10000;
    if (amount > 0) {
      out.push({ kind: 'periodiseringsfond', title: `Periodiseringsfond ${o.year}`, amount, taxEffect: Math.round(amount * rate),
        explanation: `Upp till ${pct(share)} av överskottet (${krs(taxable)}) får sättas av och skjuter upp skatten i högst sex år. `
          + 'Fonden ger en schablonintäkt varje år (72 % av statslåneräntan på fondernas belopp vid årets ingång) som tas upp i deklarationen.',
        lines: [{ account: 2120 + (o.year % 10), amount: -amount }, { account: o.type === 'AB' ? 8811 : 8811, amount }] });
      taxable -= amount;
    }
  }
  return { proposals: out, taxable, taxBefore, taxAfter: Math.max(0, Math.round(taxable * rate)) };
}

// ---------- Momsavstämning ruta för ruta ----------
export interface VatCheck { key: string; ok: boolean; title: string; detail: string }
export function parseEskd(xml: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [box, tag] of Object.entries(ESKD_FIELDS)) {
    const m = new RegExp(`<${tag}>(-?\\d+)</${tag}>`).exec(xml);
    if (m) out.set(box, Number(m[1]) * 100);
  }
  return out;
}

export function vatReconcile(boxes: Map<string, number>, filed?: Map<string, number> | null): VatCheck[] {
  const g = (b: string) => boxes.get(b) ?? 0;
  const tol = (x: number) => Math.max(10000, Math.abs(x) * 0.01);
  const checks: VatCheck[] = [];
  const implied = g('10') / 0.25 + g('11') / 0.12 + g('12') / 0.06;
  const sales = g('05') + g('06') + g('07') + g('08');
  checks.push({ key: 'utgaende', ok: Math.abs(implied - sales) <= tol(sales), title: 'Utgående moms stämmer mot försäljningen (ruta 05–08 mot 10–12)',
    detail: `Momsen i ruta 10–12 motsvarar försäljning för ${krs(implied)}; i ruta 05–08 finns ${krs(sales)}.` + (Math.abs(implied - sales) > tol(sales) ? ' Kontrollera att varje försäljning bokats med rätt momssats och på rätt intäktskonto.' : '') });
  const rc = g('20') + g('21') + g('22') + g('23') + g('24');
  const rcVat = g('30') + g('31') + g('32');
  if (rc || rcVat) checks.push({ key: 'omvand', ok: Math.abs(rc * 0.25 - rcVat) <= tol(rc * 0.25) || rcVat < rc * 0.25, title: 'Omvänd skattskyldighet (ruta 20–24 mot 30–32)',
    detail: `Inköp ${krs(rc)} ger utgående moms ${krs(rcVat)}.` });
  if (rcVat) checks.push({ key: 'avdrag', ok: g('48') >= rcVat, title: 'Ingående moms på inköp med omvänd skattskyldighet är avdragen (ruta 48)',
    detail: g('48') >= rcVat ? `Ruta 48 (${krs(g('48'))}) täcker momsen i ruta 30–32.` : `Ruta 48 (${krs(g('48'))}) är lägre än momsen i ruta 30–32 (${krs(rcVat)}) – avdraget saknas troligen.` });
  if (g('35') || g('38') || g('39')) checks.push({ key: 'ps', ok: true, title: 'Periodisk sammanställning', detail: 'Försäljning till andra EU-länder (ruta 35, 38, 39) ska också redovisas i en periodisk sammanställning.' });
  if (filed) {
    const diffs = [...new Set([...boxes.keys(), ...filed.keys()])].filter((b) => b !== '49' && Math.trunc(g(b) / 100) !== Math.trunc((filed.get(b) ?? 0) / 100)).sort();
    checks.push({ key: 'inlamnad', ok: diffs.length === 0, title: 'Bokföringen mot den inlämnade deklarationen',
      detail: diffs.length === 0 ? 'Alla rutor stämmer med deklarationen som lämnats in.'
        : `Ändrat efter inlämningen: ${diffs.map((b) => `ruta ${b} ${krs(filed.get(b) ?? 0)} → ${krs(g(b))}`).join(', ')}. Lämna en rättad deklaration.` });
  }
  return checks;
}
