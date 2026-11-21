// Momsdeklaration (SKV 4700) härledd från kontosaldon för perioden.
// Saldo = debet − kredit. Intäkts- och skuldkonton har alltså negativt saldo.

export type AccountSums = Map<number, number>;

export interface VatBox {
  box: string;
  label: string;
  amount: number; // öre
}

const inRange = (n: number, from: number, to: number) => n >= from && n <= to;

function sum(sums: AccountSums, pred: (n: number) => boolean): number {
  let s = 0;
  for (const [n, v] of sums) if (pred(n)) s += v;
  return s;
}

export function vatReport(sums: AccountSums): { boxes: VatBox[]; toPay: number } {
  const neg = (v: number) => (v ? -v : 0); // kreditsaldo → positivt belopp (aldrig −0)

  // Ruta 05: momspliktig försäljning (konton 3000–3099 med moms, dvs 3001–3003 och övriga 30xx/31xx/32xx med moms)
  const box05 = neg(sum(sums, (n) => inRange(n, 3000, 3003) || inRange(n, 3010, 3099)));
  const box35 = neg(sum(sums, (n) => n === 3106 || n === 3108));
  const box36 = neg(sum(sums, (n) => n === 3105));
  const box39 = neg(sum(sums, (n) => n === 3308));
  const box40 = neg(sum(sums, (n) => n === 3305));
  const box41 = neg(sum(sums, (n) => n === 3231));
  const box42 = neg(sum(sums, (n) => n === 3004));
  // Vinstmarginalbeskattning: beskattningsunderlaget (marginalen exkl. moms) bokas på 3213 vid periodens avräkning
  const box07 = neg(sum(sums, (n) => n === 3213));
  // x4 = omvänd skattskyldighet (ruta 30–32), x5 = import av varor (ruta 60–62)
  const box10 = neg(sum(sums, (n) => inRange(n, 2610, 2613) || inRange(n, 2616, 2619)));
  const box11 = neg(sum(sums, (n) => inRange(n, 2620, 2623) || inRange(n, 2626, 2629)));
  const box12 = neg(sum(sums, (n) => inRange(n, 2630, 2633) || inRange(n, 2636, 2639)));
  const box20 = sum(sums, (n) => inRange(n, 4515, 4517));
  const box21 = sum(sums, (n) => n === 4535);
  const box30 = neg(sum(sums, (n) => n === 2614));
  const box31 = neg(sum(sums, (n) => n === 2624));
  const box32 = neg(sum(sums, (n) => n === 2634));
  // Import: beskattningsunderlag enligt Tullverkets beslut (4545–4547, motkonto 4549) och utgående moms på importen
  const box50 = sum(sums, (n) => inRange(n, 4545, 4547));
  const box60 = neg(sum(sums, (n) => n === 2615));
  const box61 = neg(sum(sums, (n) => n === 2625));
  const box62 = neg(sum(sums, (n) => n === 2635));
  const box48 = sum(sums, (n) => inRange(n, 2640, 2649));

  // Ruta 49 redovisas i hela kronor; öre stryks.
  const raw = box10 + box11 + box12 + box30 + box31 + box32 + box60 + box61 + box62 - box48;
  const toPay = Math.trunc(raw / 100) * 100;

  const boxes: VatBox[] = [
    { box: '05', label: 'Momspliktig försäljning som inte ingår i ruta 06–08', amount: box05 },
    ...(box07 ? [{ box: '07', label: 'Beskattningsunderlag vid vinstmarginalbeskattning', amount: box07 }] : []),
    { box: '10', label: 'Utgående moms 25 %', amount: box10 },
    { box: '11', label: 'Utgående moms 12 %', amount: box11 },
    { box: '12', label: 'Utgående moms 6 %', amount: box12 },
    ...(box20 ? [{ box: '20', label: 'Inköp av varor från annat EU-land', amount: box20 }] : []),
    { box: '21', label: 'Inköp av tjänster från annat EU-land (25 %)', amount: box21 },
    { box: '30', label: 'Utgående moms 25 % på inköp i ruta 20–24', amount: box30 },
    ...(box31 ? [{ box: '31', label: 'Utgående moms 12 % på inköp i ruta 20–24', amount: box31 }] : []),
    ...(box32 ? [{ box: '32', label: 'Utgående moms 6 % på inköp i ruta 20–24', amount: box32 }] : []),
    { box: '35', label: 'Försäljning av varor till annat EU-land', amount: box35 },
    { box: '36', label: 'Försäljning av varor utanför EU', amount: box36 },
    { box: '39', label: 'Försäljning av tjänster till näringsidkare i annat EU-land', amount: box39 },
    { box: '40', label: 'Övrig försäljning av tjänster omsatta utanför Sverige', amount: box40 },
    { box: '41', label: 'Försäljning när köparen är skattskyldig i Sverige', amount: box41 },
    { box: '42', label: 'Övrig försäljning m.m.', amount: box42 },
    ...(box50 || box60 || box61 || box62 ? [
      { box: '50', label: 'Beskattningsunderlag vid import', amount: box50 },
      { box: '60', label: 'Utgående moms 25 % på import i ruta 50', amount: box60 },
      ...(box61 ? [{ box: '61', label: 'Utgående moms 12 % på import i ruta 50', amount: box61 }] : []),
      ...(box62 ? [{ box: '62', label: 'Utgående moms 6 % på import i ruta 50', amount: box62 }] : []),
    ] : []),
    { box: '48', label: 'Ingående moms att dra av', amount: box48 },
    { box: '49', label: 'Moms att betala eller få tillbaka', amount: toPay },
  ];
  return { boxes, toPay };
}

/**
 * Momsavräkning: nollställer momskontona 2610–2649 mot 2650.
 * Öresdifferensen mot ruta 49 bokas på 3740.
 */
export function vatSettlementLines(sums: AccountSums): { account: number; debit: number; credit: number }[] {
  const lines: { account: number; debit: number; credit: number }[] = [];
  for (const [n, v] of [...sums].sort((a, b) => a[0] - b[0])) {
    if (!inRange(n, 2610, 2649) || v === 0) continue;
    // Motbokning som nollställer kontots saldo
    lines.push(v > 0 ? { account: n, debit: 0, credit: v } : { account: n, debit: -v, credit: 0 });
  }
  if (lines.length === 0) return lines;
  const { toPay } = vatReport(sums); // positivt = skuld till Skatteverket
  if (toPay > 0) lines.push({ account: 2650, debit: 0, credit: toPay });
  else if (toPay < 0) lines.push({ account: 2650, debit: -toPay, credit: 0 });
  // Öresavrundning så att verifikationen balanserar
  const d = lines.reduce((s, l) => s + l.debit - l.credit, 0);
  if (d !== 0) lines.push(d > 0 ? { account: 3740, debit: 0, credit: d } : { account: 3740, debit: -d, credit: 0 });
  return lines;
}
