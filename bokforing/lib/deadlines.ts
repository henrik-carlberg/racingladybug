// Deadlines för moms, arbetsgivardeklaration, preliminärskatt, inkomstdeklaration och årsredovisning.
// Källor: SFL 26 kap. 26–30 §§, 32 kap. 1–2 §§, 62 kap. 4 §; ABL 7:10; ÅRL 8:3, 8:6; BFL 6:7; Skatteverket.
// Gäller företag med omsättning högst 40 Mkr och utan EU-handel. Infaller ett datum på lördag, söndag,
// helgdag, midsommarafton, julafton eller nyårsafton flyttas det till närmast följande vardag
// (lag 1930:173 om beräkning av lagstadgad tid).

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const dt = (s: string) => new Date(s + 'T12:00:00Z');

/** Påskdagen (gregoriansk, Meeus/Jones/Butcher) */
function easter(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}
const addDaysIso = (s: string, n: number) => { const d = dt(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Svenska helgdagar och dagar som likställs med helgdag vid beräkning av lagstadgad tid */
export function swedishNonWorkingDays(y: number): Set<string> {
  const e = easter(y);
  const midsummerEve = [19, 20, 21, 22, 23, 24, 25].map((d) => iso(y, 6, d)).find((s) => dt(s).getUTCDay() === 5)!;
  const allSaints = [...Array(7)].map((_, i) => addDaysIso(iso(y, 10, 31), i)).find((s) => dt(s).getUTCDay() === 6)!;
  return new Set([
    iso(y, 1, 1), iso(y, 1, 6), addDaysIso(e, -2), e, addDaysIso(e, 1), iso(y, 5, 1), addDaysIso(e, 39),
    iso(y, 6, 6), midsummerEve, addDaysIso(midsummerEve, 1), allSaints, iso(y, 12, 24), iso(y, 12, 25), iso(y, 12, 26), iso(y, 12, 31),
  ]);
}

/** Flyttar till närmast följande vardag om dagen är helg/helgdag */
export function nextWorkingDay(s: string): string {
  let d = s;
  for (;;) {
    const wd = dt(d).getUTCDay();
    if (wd !== 0 && wd !== 6 && !swedishNonWorkingDays(Number(d.slice(0, 4))).has(d)) return d;
    d = addDaysIso(d, 1);
  }
}

/** Den 12:e i månaden, men den 17:e i januari och augusti (SFL 26:26, 62:4) */
function twelfth(y: number, m: number): string {
  while (m > 12) { m -= 12; y++; }
  return nextWorkingDay(iso(y, m, m === 1 || m === 8 ? 17 : 12));
}

export type DeadlineKind = 'vat' | 'agi' | 'prelskatt' | 'ink2' | 'ink1' | 'arsstamma' | 'arsredovisning' | 'bokslut';

export interface Deadline {
  key: string; // unik per bolag, t.ex. vat:2026-04-01:2026-06-30
  kind: DeadlineKind;
  title: string;
  due: string;
  periodStart?: string;
  periodEnd?: string;
  help: string;
}

export interface DeadlineInput {
  companyType: 'AB' | 'EF';
  vatPeriod: 'month' | 'quarter' | 'year';
  fiscalYears: { start: string; end: string }[];
  hasEmployees: boolean;
  fSkatt: boolean;
  from: string; // visa deadlines från och med
  to: string; // till och med
}

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

/** Inkomstdeklaration 2 (elektroniskt): beror på räkenskapsårets sista månad (SFL 32:2) */
export function ink2Due(fyEnd: string): string {
  const y = Number(fyEnd.slice(0, 4)), m = Number(fyEnd.slice(5, 7));
  if (m <= 4) return nextWorkingDay(iso(y, 12, 1));
  if (m <= 6) return nextWorkingDay(iso(y + 1, 1, 15));
  if (m <= 8) return nextWorkingDay(iso(y + 1, 4, 1));
  return nextWorkingDay(iso(y + 1, 8, 1));
}

/** Årlig momsdeklaration utan EU-handel, elektroniskt */
export function yearlyVatDue(type: 'AB' | 'EF', fyEnd: string): string {
  const y = Number(fyEnd.slice(0, 4)), m = Number(fyEnd.slice(5, 7));
  if (type === 'EF') return nextWorkingDay(iso(y + 1, 5, 12));
  if (m <= 4) return nextWorkingDay(iso(y, 12, 12));
  if (m <= 6) return nextWorkingDay(iso(y + 1, 1, 17));
  if (m <= 8) return nextWorkingDay(iso(y + 1, 4, 12));
  return nextWorkingDay(iso(y + 1, 8, 17));
}

/** Beskattningsperiod för SRU-filer: P1 jan–apr, P2 maj–jun, P3 jul–aug, P4 sep–dec */
export function taxPeriod(fyEnd: string): string {
  const y = Number(fyEnd.slice(0, 4)), m = Number(fyEnd.slice(5, 7));
  return `${y}P${m <= 4 ? 1 : m <= 6 ? 2 : m <= 8 ? 3 : 4}`;
}

export function computeDeadlines(o: DeadlineInput): Deadline[] {
  const out: Deadline[] = [];
  const fromY = Number(o.from.slice(0, 4)) - 1, toY = Number(o.to.slice(0, 4)) + 1;

  // Moms
  if (o.vatPeriod === 'month') {
    for (let y = fromY; y <= toY; y++) for (let m = 1; m <= 12; m++) {
      const ps = iso(y, m, 1), pe = iso(y, m, lastDay(y, m));
      out.push({ key: `vat:${ps}:${pe}`, kind: 'vat', title: `Momsdeklaration ${MONTHS[m - 1]} ${y}`, due: twelfth(y, m + 2), periodStart: ps, periodEnd: pe,
        help: 'Deklarera och betala momsen till skattekontot. Bokför momsavräkningen först.' });
    }
  } else if (o.vatPeriod === 'quarter') {
    for (let y = fromY; y <= toY; y++) for (let q = 1; q <= 4; q++) {
      const sm = (q - 1) * 3 + 1, ps = iso(y, sm, 1), pe = iso(y, sm + 2, lastDay(y, sm + 2));
      const due = q === 1 ? nextWorkingDay(iso(y, 5, 12)) : q === 2 ? nextWorkingDay(iso(y, 8, 17)) : q === 3 ? nextWorkingDay(iso(y, 11, 12)) : nextWorkingDay(iso(y + 1, 2, 12));
      out.push({ key: `vat:${ps}:${pe}`, kind: 'vat', title: `Momsdeklaration kvartal ${q} ${y}`, due, periodStart: ps, periodEnd: pe,
        help: 'Deklarera och betala momsen till skattekontot. Bokför momsavräkningen först.' });
    }
  } else {
    for (const f of o.fiscalYears) {
      out.push({ key: `vat:${f.start}:${f.end}`, kind: 'vat', title: `Momsdeklaration helår ${f.start.slice(0, 4)}`, due: yearlyVatDue(o.companyType, f.end),
        periodStart: f.start, periodEnd: f.end, help: o.companyType === 'EF'
          ? 'Årsmoms för enskild firma deklareras senast 12 maj året efter (26 juni med byråanstånd).'
          : 'Deklarera och betala årets moms. Bokför momsavräkningen först.' });
    }
  }

  // Arbetsgivardeklaration (lön betald månad m → deklarera månaden efter)
  if (o.hasEmployees) {
    for (let y = fromY; y <= toY; y++) for (let m = 1; m <= 12; m++) {
      out.push({ key: `agi:${iso(y, m, 1).slice(0, 7)}`, kind: 'agi', title: `Arbetsgivardeklaration för löner i ${MONTHS[m - 1]} ${y}`, due: twelfth(y, m + 1),
        periodStart: iso(y, m, 1), periodEnd: iso(y, m, lastDay(y, m)), help: 'Lämna AGI-filen och betala avdragen skatt och arbetsgivaravgifter till skattekontot.' });
    }
  }

  // Debiterad preliminärskatt (F-skatt) – varje månad
  if (o.fSkatt) {
    for (let y = fromY; y <= toY; y++) for (let m = 1; m <= 12; m++) {
      out.push({ key: `prel:${y}-${pad(m)}`, kind: 'prelskatt', title: `Preliminärskatt ${MONTHS[m - 1]} ${y}`, due: twelfth(y, m),
        help: 'Betala månadens debiterade preliminärskatt (F-skatt) till skattekontot. Beloppet står i ditt beslut från Skatteverket.' });
    }
  }

  // Bokslut och deklaration per räkenskapsår
  for (const f of o.fiscalYears) {
    const y = Number(f.end.slice(0, 4)), m = Number(f.end.slice(5, 7));
    const plus = (months: number) => { let mm = m + months, yy = y; while (mm > 12) { mm -= 12; yy++; } return iso(yy, mm, lastDay(yy, mm)); };
    const year = f.start.slice(0, 4) === f.end.slice(0, 4) ? f.end.slice(0, 4) : `${f.start.slice(0, 4)}/${f.end.slice(2, 4)}`;
    if (o.companyType === 'AB') {
      out.push({ key: `arsstamma:${f.end}`, kind: 'arsstamma', title: `Årsstämma för ${year}`, due: plus(6), periodStart: f.start, periodEnd: f.end,
        help: 'Årsstämman ska hållas inom sex månader och fastställa resultat- och balansräkningen samt besluta om vinsten (ABL 7:10).' });
      out.push({ key: `arsredovisning:${f.end}`, kind: 'arsredovisning', title: `Skicka årsredovisning ${year} till Bolagsverket`, due: plus(7), periodStart: f.start, periodEnd: f.end,
        help: 'Årsredovisning med fastställelseintyg ska ha kommit in inom sju månader, annars tar Bolagsverket ut förseningsavgift (7 500 kr för privata AB).' });
      out.push({ key: `ink2:${f.end}`, kind: 'ink2', title: `Inkomstdeklaration 2 för ${year}`, due: ink2Due(f.end), periodStart: f.start, periodEnd: f.end,
        help: 'Lämnas elektroniskt (filöverföring av SRU-filen eller e-tjänst). Underlaget finns under Bokslut & deklaration.' });
    } else {
      out.push({ key: `bokslut:${f.end}`, kind: 'bokslut', title: `Årsbokslut ${year} klart`, due: plus(6), periodStart: f.start, periodEnd: f.end,
        help: 'Årsbokslutet (förenklat om omsättningen normalt är högst 3 Mkr) ska vara upprättat inom sex månader (BFL 6:7).' });
      out.push({ key: `ink1:${f.end}`, kind: 'ink1', title: `Inkomstdeklaration 1 med NE-bilaga för ${year}`, due: nextWorkingDay(iso(y + 1, 5, 2)), periodStart: f.start, periodEnd: f.end,
        help: 'Deklarera näringsverksamheten på NE-bilagan i din privata deklaration. Med redovisningskonsult kan byråanstånd ge mer tid.' });
    }
  }

  return out.filter((d) => d.due >= o.from && d.due <= o.to).sort((a, b) => a.due.localeCompare(b.due));
}
