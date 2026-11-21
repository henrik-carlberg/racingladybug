// Underlag för inkomstdeklaration: BAS-konton → rutor i NE (SKV 2161) och INK2/INK2R/INK2S (SKV 2002),
// med SRU-fältkoder enligt Skatteverkets specifikation för beskattningsperiod 2026P4 och BAS SRU-mappning.
// Belopp i SRU anges i hela kronor. Kostnads- och skuldfält anges som positiva tal (blanketten anger tecknet).

export type Sums = Map<number, number>; // konto → saldo i öre (debet − kredit)
type Range = [number, number];

export interface FormField { code: string; box: string; label: string; amount: number; sign: '+' | '-' | '*'; accounts: number[] }

function collect(sums: Sums, ranges: Range[]): { total: number; accounts: number[] } {
  let total = 0;
  const accounts: number[] = [];
  for (const [n, v] of sums) {
    if (v !== 0 && ranges.some(([a, b]) => n >= a && n <= b)) { total += v; accounts.push(n); }
  }
  return { total, accounts: accounts.sort((x, y) => x - y) };
}

const kr = (ore: number) => Math.round(ore / 100);

// ---------- NE (enskild näringsidkare) ----------

const NE_BALANCE: [string, string, string, Range[], 'asset' | 'liab'][] = [
  ['7200', 'B1', 'Immateriella anläggningstillgångar', [[1000, 1099]], 'asset'],
  ['7210', 'B2', 'Byggnader och markanläggningar', [[1100, 1129], [1150, 1179], [1190, 1199]], 'asset'],
  ['7211', 'B3', 'Mark och andra tillgångar som inte får skrivas av', [[1130, 1149], [1180, 1189], [1291, 1291]], 'asset'],
  ['7212', 'B4', 'Maskiner och inventarier', [[1200, 1290], [1292, 1299]], 'asset'],
  ['7213', 'B5', 'Övriga anläggningstillgångar', [[1300, 1399]], 'asset'],
  ['7240', 'B6', 'Varulager', [[1400, 1499]], 'asset'],
  ['7250', 'B7', 'Kundfordringar', [[1500, 1599]], 'asset'],
  ['7260', 'B8', 'Övriga fordringar', [[1600, 1899]], 'asset'],
  ['7280', 'B9', 'Kassa och bank', [[1900, 1999]], 'asset'],
  ['7320', 'B11', 'Obeskattade reserver', [[2100, 2199]], 'liab'],
  ['7330', 'B12', 'Avsättningar', [[2200, 2299]], 'liab'],
  ['7380', 'B13', 'Låneskulder', [[2300, 2399], [2410, 2419], [2480, 2489]], 'liab'],
  ['7381', 'B14', 'Skatteskulder', [[2500, 2599]], 'liab'],
  ['7382', 'B15', 'Leverantörsskulder', [[2440, 2449], [2460, 2479]], 'liab'],
  ['7383', 'B16', 'Övriga skulder', [[2420, 2439], [2450, 2459], [2490, 2499], [2600, 2999]], 'liab'],
];

const NE_RESULT: [string, string, string, Range[], '+' | '-'][] = [
  ['7400', 'R1', 'Försäljning och utfört arbete samt övriga momspliktiga intäkter', [[3000, 3003], [3005, 3799], [3900, 3979], [3990, 3999]], '+'],
  ['7401', 'R2', 'Momsfria intäkter', [[3004, 3004], [3980, 3989]], '+'],
  ['7402', 'R3', 'Bil- och bostadsförmån m.m.', [], '+'],
  ['7403', 'R4', 'Ränteintäkter m.m.', [[3800, 3899], [8000, 8399]], '+'],
  ['7500', 'R5', 'Varor, material och tjänster', [[4000, 4999]], '-'],
  ['7501', 'R6', 'Övriga externa kostnader', [[5000, 6999]], '-'],
  ['7502', 'R7', 'Anställd personal', [[7000, 7699]], '-'],
  ['7503', 'R8', 'Räntekostnader m.m.', [[7900, 7999], [8400, 8499]], '-'],
  ['7504', 'R9', 'Avskrivningar och nedskrivningar byggnader och markanläggningar', [[7720, 7729], [7770, 7779], [7820, 7829], [7840, 7849]], '-'],
  ['7505', 'R10', 'Avskrivningar och nedskrivningar maskiner, inventarier och immateriella tillgångar',
    [[7700, 7719], [7730, 7769], [7780, 7819], [7830, 7839], [7850, 7899]], '-'],
];

/** Konton som normalt inte är avdragsgilla (representation, ej avdragsgilla avgifter, skattetillägg/ränta på skatt) */
export const NON_DEDUCTIBLE_ACCOUNTS = [6072, 6342, 6982, 6992, 6993, 7623, 7632, 8423];

export function neForm(closing: Sums, result: Sums): { balance: FormField[]; income: FormField[]; adjustments: FormField[]; unmapped: number[]; bookedResult: number } {
  const balance: FormField[] = [];
  let assets = 0, liabs = 0;
  const used = new Set<number>();
  for (const [code, box, label, ranges, kind] of NE_BALANCE) {
    const c = collect(closing, ranges);
    c.accounts.forEach((a) => used.add(a));
    const amt = kind === 'asset' ? c.total : -c.total;
    if (kind === 'asset') assets += amt; else liabs += amt;
    balance.push({ code, box, label, amount: amt, sign: '*', accounts: c.accounts });
  }
  // B10 Eget kapital = tillgångar − skulder (enligt blanketten)
  balance.splice(9, 0, { code: '7300', box: 'B10', label: 'Eget kapital (tillgångar − skulder)', amount: assets - liabs, sign: '*', accounts: [] });
  for (const n of closing.keys()) if (n >= 2000 && n <= 2099) used.add(n);

  const income: FormField[] = [];
  let r = 0;
  for (const [code, box, label, ranges, sign] of NE_RESULT) {
    const c = collect(result, ranges);
    c.accounts.forEach((a) => used.add(a));
    const amt = sign === '+' ? -c.total : c.total;
    r += sign === '+' ? amt : -amt;
    income.push({ code, box, label, amount: amt, sign, accounts: c.accounts });
  }
  income.push({ code: '7440', box: 'R11', label: 'Bokfört resultat', amount: r, sign: '*', accounts: [] });
  const nd = collect(result, NON_DEDUCTIBLE_ACCOUNTS.map((a) => [a, a] as Range));
  const adjustments: FormField[] = [
    { code: '7600', box: 'R12', label: 'Bokfört resultat (från R11)', amount: r, sign: '*', accounts: [] },
    { code: '7601', box: 'R13', label: 'Bokförda kostnader som inte ska dras av', amount: nd.total, sign: '+', accounts: nd.accounts },
  ];
  const unmapped = [...closing.keys(), ...result.keys()].filter((n) => !used.has(n) && n !== 8999 && (closing.get(n) || result.get(n)));
  return { balance, income, adjustments, unmapped: [...new Set(unmapped)].sort((a, b) => a - b), bookedResult: r };
}

// ---------- INK2R / INK2S (aktiebolag) ----------

const INK2R_BALANCE: [string, string, string, Range[], 'asset' | 'liab'][] = [
  ['7201', '2.1', 'Koncessioner, patent, licenser, varumärken, hyresrätter, goodwill m.m.', [[1000, 1087], [1089, 1099]], 'asset'],
  ['7202', '2.2', 'Pågående förbättringar och förskott avseende immateriella anläggningstillgångar', [[1088, 1088]], 'asset'],
  ['7214', '2.3', 'Byggnader och mark', [[1100, 1119], [1130, 1179], [1190, 1199]], 'asset'],
  ['7215', '2.4', 'Maskiner, inventarier och övriga materiella anläggningstillgångar', [[1200, 1279], [1290, 1299]], 'asset'],
  ['7216', '2.5', 'Förbättringsutgifter på annans fastighet', [[1120, 1129]], 'asset'],
  ['7217', '2.6', 'Pågående nyanläggningar och förskott, materiella anläggningstillgångar', [[1180, 1189], [1280, 1289]], 'asset'],
  ['7230', '2.7', 'Andelar i koncernföretag', [[1310, 1319]], 'asset'],
  ['7231', '2.8', 'Andelar i intresseföretag och gemensamt styrda företag', [[1330, 1339]], 'asset'],
  ['7233', '2.9', 'Ägarintressen i övriga företag och andra långfristiga värdepappersinnehav', [[1350, 1359]], 'asset'],
  ['7232', '2.10', 'Fordringar hos koncern-, intresse- och gemensamt styrda företag', [[1320, 1329], [1340, 1349]], 'asset'],
  ['7234', '2.11', 'Lån till delägare eller närstående', [[1360, 1369]], 'asset'],
  ['7235', '2.12', 'Andra långfristiga fordringar', [[1370, 1399]], 'asset'],
  ['7241', '2.13', 'Råvaror och förnödenheter', [[1410, 1439]], 'asset'],
  ['7242', '2.14', 'Varor under tillverkning', [[1440, 1449]], 'asset'],
  ['7243', '2.15', 'Färdiga varor och handelsvaror', [[1450, 1469]], 'asset'],
  ['7244', '2.16', 'Övriga lagertillgångar', [[1490, 1499]], 'asset'],
  ['7245', '2.17', 'Pågående arbeten för annans räkning', [[1470, 1479]], 'asset'],
  ['7246', '2.18', 'Förskott till leverantörer', [[1480, 1489]], 'asset'],
  ['7251', '2.19', 'Kundfordringar', [[1500, 1559], [1580, 1589]], 'asset'],
  ['7252', '2.20', 'Fordringar hos koncern-, intresse- och gemensamt styrda företag', [[1560, 1569], [1660, 1669]], 'asset'],
  ['7261', '2.21', 'Övriga fordringar', [[1570, 1579], [1590, 1619], [1630, 1659], [1670, 1699]], 'asset'],
  ['7262', '2.22', 'Upparbetad men ej fakturerad intäkt', [[1620, 1629]], 'asset'],
  ['7263', '2.23', 'Förutbetalda kostnader och upplupna intäkter', [[1700, 1799]], 'asset'],
  ['7270', '2.24', 'Kortfristiga placeringar: andelar i koncernföretag', [[1860, 1869]], 'asset'],
  ['7271', '2.25', 'Övriga kortfristiga placeringar', [[1800, 1859], [1870, 1899]], 'asset'],
  ['7281', '2.26', 'Kassa, bank och redovisningsmedel', [[1900, 1999]], 'asset'],
  ['7301', '2.27', 'Bundet eget kapital', [[2080, 2089]], 'liab'],
  ['7302', '2.28', 'Fritt eget kapital', [[2000, 2079], [2090, 2099]], 'liab'],
  ['7321', '2.29', 'Periodiseringsfonder', [[2110, 2139]], 'liab'],
  ['7322', '2.30', 'Ackumulerade överavskrivningar', [[2150, 2159]], 'liab'],
  ['7323', '2.31', 'Övriga obeskattade reserver', [[2100, 2109], [2140, 2149], [2160, 2199]], 'liab'],
  ['7331', '2.32', 'Avsättningar för pensioner enligt tryggandelagen', [[2210, 2219]], 'liab'],
  ['7332', '2.33', 'Övriga avsättningar för pensioner', [[2220, 2239]], 'liab'],
  ['7333', '2.34', 'Övriga avsättningar', [[2240, 2299]], 'liab'],
  ['7350', '2.35', 'Obligationslån', [[2310, 2329]], 'liab'],
  ['7351', '2.36', 'Långfristig kontokredit', [[2330, 2339]], 'liab'],
  ['7352', '2.37', 'Övriga långfristiga skulder till kreditinstitut', [[2340, 2359]], 'liab'],
  ['7353', '2.38', 'Långfristiga skulder till koncern-, intresse- och gemensamt styrda företag', [[2360, 2369]], 'liab'],
  ['7354', '2.39', 'Övriga långfristiga skulder', [[2300, 2309], [2370, 2399]], 'liab'],
  ['7360', '2.40', 'Kortfristig kontokredit', [[2480, 2489]], 'liab'],
  ['7361', '2.41', 'Övriga kortfristiga skulder till kreditinstitut', [[2410, 2419]], 'liab'],
  ['7362', '2.42', 'Förskott från kunder', [[2420, 2429]], 'liab'],
  ['7363', '2.43', 'Pågående arbeten för annans räkning', [[2430, 2439]], 'liab'],
  ['7364', '2.44', 'Fakturerad men ej upparbetad intäkt', [[2450, 2459]], 'liab'],
  ['7365', '2.45', 'Leverantörsskulder', [[2440, 2449]], 'liab'],
  ['7366', '2.46', 'Växelskulder', [[2490, 2499]], 'liab'],
  ['7367', '2.47', 'Kortfristiga skulder till koncern-, intresse- och gemensamt styrda företag', [[2460, 2479], [2860, 2869]], 'liab'],
  ['7369', '2.48', 'Övriga kortfristiga skulder', [[2600, 2859], [2870, 2899]], 'liab'],
  ['7368', '2.49', 'Skatteskulder', [[2500, 2599]], 'liab'],
  ['7370', '2.50', 'Upplupna kostnader och förutbetalda intäkter', [[2900, 2999]], 'liab'],
];

// [kod om positivt, kod om negativt, ruta, namn, intervall, normal riktning]
const INK2R_RESULT: [string, string | null, string, string, Range[], '+' | '-'][] = [
  ['7410', null, '3.1', 'Nettoomsättning', [[3000, 3799]], '+'],
  ['7411', '7510', '3.2', 'Förändring av lager av produkter i arbete, färdiga varor m.m.', [[4900, 4909], [4930, 4959], [4970, 4979], [4990, 4999]], '+'],
  ['7412', null, '3.3', 'Aktiverat arbete för egen räkning', [[3800, 3899]], '+'],
  ['7413', null, '3.4', 'Övriga rörelseintäkter', [[3900, 3999]], '+'],
  ['7511', null, '3.5', 'Råvaror och förnödenheter', [[4000, 4799], [4910, 4929]], '-'],
  ['7512', null, '3.6', 'Handelsvaror', [[4960, 4969], [4980, 4989]], '-'],
  ['7513', null, '3.7', 'Övriga externa kostnader', [[5000, 6999]], '-'],
  ['7514', null, '3.8', 'Personalkostnader', [[7000, 7699]], '-'],
  ['7515', null, '3.9', 'Av- och nedskrivningar av materiella och immateriella anläggningstillgångar', [[7700, 7739], [7750, 7789], [7800, 7899]], '-'],
  ['7516', null, '3.10', 'Nedskrivningar av omsättningstillgångar utöver normala nedskrivningar', [[7740, 7749], [7790, 7799]], '-'],
  ['7517', null, '3.11', 'Övriga rörelsekostnader', [[7900, 7999]], '-'],
  ['7416', '7520', '3.15', 'Resultat från övriga finansiella anläggningstillgångar (inkl. andelar)', [[8000, 8299]], '+'],
  ['7417', null, '3.16', 'Övriga ränteintäkter och liknande resultatposter', [[8300, 8369], [8390, 8399]], '+'],
  ['7521', null, '3.17', 'Nedskrivning av finansiella anläggningstillgångar och kortfristiga placeringar', [[8370, 8389]], '-'],
  ['7522', null, '3.18', 'Räntekostnader och liknande resultatposter', [[8400, 8499]], '-'],
  ['7524', null, '3.19', 'Lämnade koncernbidrag', [[8830, 8839]], '-'],
  ['7419', null, '3.20', 'Mottagna koncernbidrag', [[8820, 8829]], '+'],
  ['7420', '7525', '3.21/3.22', 'Återföring av (+) / avsättning till (−) periodiseringsfond', [[8810, 8819]], '+'],
  ['7421', '7526', '3.23', 'Förändring av överavskrivningar', [[8850, 8859]], '+'],
  ['7422', '7527', '3.24', 'Övriga bokslutsdispositioner', [[8840, 8849], [8860, 8899]], '+'],
  ['7528', null, '3.25', 'Skatt på årets resultat', [[8900, 8989]], '-'],
];

export interface Ink2 {
  page1: FormField[]; // INK2 sid 1
  balance: FormField[]; // INK2R 2.x
  income: FormField[]; // INK2R 3.x
  adjustments: FormField[]; // INK2S 4.x
  result: number; // årets resultat (öre, vinst positiv)
  taxable: number; // överskott (+) / underskott (−)
  unmapped: number[];
  warnings: string[];
}

export function ink2Form(closing: Sums, result: Sums, opening: Sums): Ink2 {
  const used = new Set<number>();
  const balance: FormField[] = INK2R_BALANCE.map(([code, box, label, ranges, kind]) => {
    const c = collect(closing, ranges);
    c.accounts.forEach((a) => used.add(a));
    return { code, box, label, amount: kind === 'asset' ? c.total : -c.total, sign: '*' as const, accounts: c.accounts };
  });
  const income: FormField[] = [];
  let res = 0;
  for (const [pos, neg, box, label, ranges, dir] of INK2R_RESULT) {
    const c = collect(result, ranges);
    c.accounts.forEach((a) => used.add(a));
    const signed = -c.total; // intäkt positiv, kostnad negativ
    res += signed;
    if (dir === '-') income.push({ code: pos, box, label, amount: -signed, sign: '-', accounts: c.accounts });
    else if (signed >= 0 || !neg) income.push({ code: pos, box, label, amount: signed, sign: '+', accounts: c.accounts });
    else income.push({ code: neg, box, label, amount: -signed, sign: '-', accounts: c.accounts });
  }
  income.push(res >= 0
    ? { code: '7450', box: '3.26', label: 'Årets resultat, vinst', amount: res, sign: '+', accounts: [] }
    : { code: '7550', box: '3.27', label: 'Årets resultat, förlust', amount: -res, sign: '-', accounts: [] });

  const tax = income.find((f) => f.box === '3.25')!.amount;
  const nd = collect(result, NON_DEDUCTIBLE_ACCOUNTS.map((a) => [a, a] as Range));
  const taxable = res + tax + nd.total;
  const adjustments: FormField[] = [
    res >= 0 ? { code: '7650', box: '4.1', label: 'Årets resultat, vinst', amount: res, sign: '+', accounts: [] }
      : { code: '7750', box: '4.2', label: 'Årets resultat, förlust', amount: -res, sign: '-', accounts: [] },
    { code: '7651', box: '4.3a', label: 'Skatt på årets resultat', amount: tax, sign: '+', accounts: [] },
    { code: '7653', box: '4.3c', label: 'Andra bokförda kostnader som inte ska dras av', amount: nd.total, sign: '+', accounts: nd.accounts },
    taxable >= 0 ? { code: '7670', box: '4.15', label: 'Överskott (flyttas till 1.1)', amount: taxable, sign: '+', accounts: [] }
      : { code: '7770', box: '4.16', label: 'Underskott (flyttas till 1.2)', amount: -taxable, sign: '-', accounts: [] },
  ];
  const ownerLoan = -(closing.get(2893) ?? 0) - (closing.get(2393) ?? 0);
  if (ownerLoan > 0) adjustments.push({ code: '8026', box: '4.20', label: 'Lån från aktieägare (fysisk person) vid räkenskapsårets utgång', amount: ownerLoan, sign: '*', accounts: [2393, 2893] });
  const pension = collect(result, [[7410, 7419]]);
  if (pension.total) adjustments.push({ code: '8022', box: '4.21', label: 'Pensionskostnader (ingår i 3.8)', amount: pension.total, sign: '*', accounts: pension.accounts });

  const page1: FormField[] = [
    taxable >= 0 ? { code: '7104', box: '1.1', label: 'Överskott av näringsverksamhet', amount: taxable, sign: '*', accounts: [] }
      : { code: '7114', box: '1.2', label: 'Underskott av näringsverksamhet', amount: -taxable, sign: '*', accounts: [] },
  ];
  if (pension.total) page1.push({ code: '7132', box: '1.4', label: 'Underlag för särskild löneskatt på pensionskostnader', amount: pension.total, sign: '*', accounts: pension.accounts });

  const warnings: string[] = [];
  const fund = -collect(opening, [[2110, 2139]]).total;
  if (fund > 0) warnings.push('Bolaget hade periodiseringsfonder vid årets början. Schablonintäkt ska tas upp i ruta 4.6a (fondernas belopp × statslåneräntan 30 november föregående år) – lägg till den manuellt.');
  const unmapped = [...new Set([...closing.keys(), ...result.keys()])].filter((n) => !used.has(n) && n !== 8999 && n >= 1000 && (closing.get(n) || result.get(n))).sort((a, b) => a - b);
  return { page1, balance, income, adjustments, result: res, taxable, unmapped, warnings };
}

// ---------- SRU-filer ----------

const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const hms = (d: Date) => `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
const clean = (s: string) => s.replace(/[\r\n#]/g, ' ').trim();

export interface SruSender { id: string; name: string; postalCode: string; city: string; address?: string; email?: string; phone?: string; contact?: string }

export function sruInfo(sender: SruSender, now = new Date()): string {
  return [
    '#DATABESKRIVNING_START', '#PRODUKT SRU', `#SKAPAD ${ymd(now)} ${hms(now)}`, '#PROGRAM BOKFORING 1.0', '#FILNAMN BLANKETTER.SRU', '#DATABESKRIVNING_SLUT',
    '#MEDIELEV_START', `#ORGNR ${sender.id}`, `#NAMN ${clean(sender.name)}`,
    ...(sender.address ? [`#ADRESS ${clean(sender.address)}`] : []),
    `#POSTNR ${sender.postalCode.replace(/\s/g, '')}`, `#POSTORT ${clean(sender.city)}`,
    ...(sender.contact ? [`#KONTAKT ${clean(sender.contact)}`] : []),
    ...(sender.email ? [`#EMAIL ${clean(sender.email)}`] : []),
    ...(sender.phone ? [`#TELEFON ${clean(sender.phone)}`] : []),
    '#MEDIELEV_SLUT', '',
  ].join('\r\n');
}

export interface SruBlock { form: string; id: string; name: string; fyStart: string; fyEnd: string; fields: { code: string; value: number | string }[] }

export function sruBlankets(blocks: SruBlock[], now = new Date()): string {
  const out: string[] = [];
  for (const b of blocks) {
    out.push(`#BLANKETT ${b.form}`, `#IDENTITET ${b.id} ${ymd(now)} ${hms(now)}`, `#NAMN ${clean(b.name)}`);
    out.push(`#UPPGIFT 7011 ${b.fyStart.replace(/-/g, '')}`, `#UPPGIFT 7012 ${b.fyEnd.replace(/-/g, '')}`);
    for (const f of b.fields) {
      if (typeof f.value === 'number' && f.value === 0) continue;
      out.push(`#UPPGIFT ${f.code} ${f.value}`);
    }
    out.push('#BLANKETTSLUT');
  }
  out.push('#FIL_SLUT', '');
  return out.join('\r\n');
}

/** Fält → SRU-värden i hela kronor (tomma/noll utelämnas) */
export const sruFields = (fields: FormField[]) => fields.map((f) => ({ code: f.code, value: kr(f.amount) }));

/** SRU-filer ska vara ISO 8859-1 */
export function latin1(s: string): Buffer {
  return Buffer.from(s.replace(/[^\u0000-ÿ]/g, '?'), 'latin1');
}
