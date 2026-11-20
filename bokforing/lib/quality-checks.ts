// Kvalitetskontroller före bokslut (ren logik). Saldo = debet − kredit i öre.
export interface QcInput {
  end: string;
  /** Utgående saldo per konto på bokslutsdagen (inklusive ingående balans) */
  balances: Map<number, number>;
  /** Årets rörelser per konto utan momsavräkningar */
  year: Map<number, number>;
  /** Senaste rörelse per konto */
  lastMovement: Map<number, string>;
  names?: Map<number, string>;
}
export interface QcFinding { key: string; level: 'error' | 'warn'; title: string; detail: string; action: string; account?: number }

const kr = (o: number) => (o / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr';
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const sum = (m: Map<number, number>, p: (n: number) => boolean) => { let s = 0; for (const [n, v] of m) if (p(n)) s += v; return s; };
const between = (n: number, a: number, b: number) => n >= a && n <= b;
/** Motkonton (ackumulerade av- och nedskrivningar) slutar på 8 eller 9 i klass 1 */
const isContra = (n: number) => n % 10 === 8 || n % 10 === 9;
/** Avräknings- och mellankonton som ska vara nollställda eller regleras löpande */
export const CLEARING = (n: number) => between(n, 1610, 1619) || between(n, 1680, 1689) || between(n, 2890, 2899) || n === 1630 || n === 2650;
export const STALE_DAYS = 90;

export function qualityChecks(i: QcInput): QcFinding[] {
  const out: QcFinding[] = [];
  const name = (n: number) => `${n}${i.names?.get(n) ? ' ' + i.names.get(n) : ''}`;
  for (const [n, v] of [...i.balances].sort((a, b) => a[0] - b[0])) {
    if (!v) continue;
    if (between(n, 1900, 1989) && v < 0) out.push({ key: `neg:${n}`, level: 'error', account: n, title: `${name(n)} har negativt saldo`, detail: `Saldo ${kr(v)} på bokslutsdagen`,
      action: 'Stäm av mot kontoutdraget. En utnyttjad checkräkningskredit redovisas som skuld på 2330; annars saknas en insättning eller är en utbetalning bokförd två gånger.' });
    else if (between(n, 1400, 1499) && !isContra(n) && v < 0) out.push({ key: `neg:${n}`, level: 'error', account: n, title: `${name(n)} har negativt lagervärde`, detail: `Saldo ${kr(v)}`,
      action: 'Lagret kan inte vara negativt. Kontrollera lagerförändringen (4990) mot inventeringen.' });
    else if (n === 1510 && v < 0) out.push({ key: `neg:${n}`, level: 'warn', account: n, title: 'Kundfordringarna har kreditsaldo', detail: `Saldo ${kr(v)}`,
      action: 'Kunder har betalat mer än fakturerat eller betalningar saknar faktura. Flytta förskott till 2420 eller matcha betalningarna mot fakturorna.' });
    else if (between(n, 1000, 1899) && !isContra(n) && !between(n, 1400, 1499) && n !== 1510 && !CLEARING(n) && v < 0) out.push({ key: `neg:${n}`, level: 'warn', account: n, title: `${name(n)} (tillgång) har kreditsaldo`, detail: `Saldo ${kr(v)}`,
      action: 'En tillgång har normalt debetsaldo. Kontrollera om något bokförts på fel konto.' });
    else if ((n === 2440 || between(n, 2710, 2759) || between(n, 2910, 2949)) && v > 0) out.push({ key: `debit:${n}`, level: 'warn', account: n, title: `${name(n)} (skuld) har debetsaldo`, detail: `Saldo ${kr(v)}`,
      action: n === 2440 ? 'Troligen en dubbelbetalning eller en betald leverantörsfaktura som inte är registrerad. Begär återbetalning eller registrera fakturan.' : 'Skulden är överbetald eller en kostnad saknas. Stäm av mot skattekontot och lönerna.' });
    if (CLEARING(n)) {
      const last = i.lastMovement.get(n);
      const age = last ? daysBetween(last, i.end) : Infinity;
      if (age > STALE_DAYS) out.push({ key: `stale:${n}`, level: 'warn', account: n, title: `Gammalt saldo på ${name(n)}`, detail: `Saldo ${kr(v)}, senaste rörelse ${last ?? 'saknas'}${last ? ` (${age} dagar före bokslutsdagen)` : ''}`,
        action: n === 2650 ? 'Momsen är inte betald eller återbetald. Stäm av mot skattekontot och bokför betalningen.' : n === 1630 ? 'Stäm av skattekontot mot Skatteverkets kontoutdrag och bokför räntor och avgifter.' : 'Avräkningskonton ska regleras. Ta reda på vad saldot avser och flytta det till rätt konto.' });
    }
  }
  // Resultatkonton med ovanligt tecken (rabatter, lagerförändring och avrundning kan ha båda)
  for (const [n, v] of i.year) {
    if (between(n, 3000, 3699) && v > 0) out.push({ key: `sign:${n}`, level: 'warn', account: n, title: `Intäktskontot ${name(n)} har debetsaldo`, detail: `Årets saldo ${kr(v)}`,
      action: 'Fler krediteringar än försäljning. Kontrollera kreditfakturor och felkonteringar.' });
    else if (between(n, 4000, 7699) && !between(n, 4700, 4799) && !between(n, 4900, 4999) && v < 0) out.push({ key: `sign:${n}`, level: 'warn', account: n, title: `Kostnadskontot ${name(n)} har kreditsaldo`, detail: `Årets saldo ${kr(v)}`,
      action: 'En kostnad är normalt debet. Kontrollera om en intäkt eller en återbetalning bokförts här.' });
  }
  // Utgående moms mot försäljningen
  const s25 = -sum(i.year, (n) => n === 3001), s12 = -sum(i.year, (n) => n === 3002), s6 = -sum(i.year, (n) => n === 3003);
  const other = -sum(i.year, (n) => n === 3000 || between(n, 3010, 3099));
  const vat = -sum(i.year, (n) => between(n, 2610, 2613) || between(n, 2620, 2623) || between(n, 2630, 2633));
  const sales = s25 + s12 + s6 + other;
  if (sales > 0 || vat > 0) {
    const min = Math.round(0.25 * s25 + 0.12 * s12 + 0.06 * s6 + 0.06 * other), max = Math.round(0.25 * s25 + 0.12 * s12 + 0.06 * s6 + 0.25 * other);
    const tol = Math.max(10000, Math.round(0.02 * max));
    if (vat < min - tol || vat > max + tol) {
      const exp = min === max ? kr(min) : `${kr(min)}–${kr(max)}`;
      out.push({ key: 'vat:out', level: 'warn', title: 'Utgående moms stämmer inte med försäljningen', detail: `Bokförd utgående moms ${kr(vat)}, förväntat ${exp} utifrån momspliktig försäljning ${kr(sales)}`,
        action: 'Kontrollera att försäljningen bokförts på konton med rätt momssats (3001 25 %, 3002 12 %, 3003 6 %) och att momsfri försäljning ligger på 3004 eller 3100-kontona.' });
    }
  }
  // Ej avräknad moms på bokslutsdagen
  const open = sum(i.balances, (n) => between(n, 2610, 2649));
  if (open) out.push({ key: 'vat:open', level: 'warn', title: 'Momsen för sista perioden är inte avräknad', detail: `Saldo ${kr(open)} på momskontona 2610–2649`,
    action: 'Gör momsavräkningen för den sista perioden så att momsen förs till 2650 före bokslutet.' });
  return out;
}

export function qcSummary(f: QcFinding[], acked: Set<string>) {
  const open = f.filter((x) => !acked.has(x.key));
  return { errors: open.filter((x) => x.level === 'error').length, warnings: open.filter((x) => x.level === 'warn').length, acked: f.length - open.length };
}
