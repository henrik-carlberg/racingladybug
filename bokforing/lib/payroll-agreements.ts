// Lön enligt kollektivavtal: tjänstepension (ITP1, ITP2, SAF-LO), OB, övertid, beredskap, semesterlön och löneväxling.
// Ren logik (testbar). Belopp i öre. Kontrollera procentsatser och basbelopp mot avtalen och Pensionsmyndigheten varje år.

/** Inkomstbasbelopp per år (öre) */
export const IBB: Record<number, number> = { 2025: 8_060_000, 2026: 8_340_000, 2027: 8_340_000 };
export const ibb = (year: number) => IBB[year] ?? IBB[Math.max(...Object.keys(IBB).map(Number))];

export type PensionPlan = 'custom' | 'itp1' | 'itp2' | 'saf_lo';
export const PLAN_LABEL: Record<PensionPlan, string> = { custom: 'Egen procentsats', itp1: 'ITP 1 (premiebestämd)', itp2: 'ITP 2 (förmånsbestämd)', saf_lo: 'Avtalspension SAF-LO (Fora)' };

/**
 * Månatlig pensionspremie:
 *  ITP 1 och SAF-LO: 4,5 % av lönen upp till 7,5 inkomstbasbelopp/12, 30 % på lönen över.
 *  ITP 2: ITPK 2 % (den förmånsbestämda delen faktureras av Collectum/PRI utifrån anmäld årslön).
 *  Egen: angiven procent av lönen.
 */
export function pensionPremium(plan: PensionPlan, pensionable: number, year: number, customPercent = 0) {
  const s = Math.max(0, pensionable);
  if (plan === 'custom') return Math.round((s * customPercent) / 100);
  if (plan === 'itp2') return Math.round(s * 0.02);
  const cap = Math.round((7.5 * ibb(year)) / 12);
  return Math.round(Math.min(s, cap) * 0.045 + Math.max(0, s - cap) * 0.3);
}

export interface AgreementRules {
  ob_evening: number; ob_night: number; ob_weekend: number; ob_holiday: number; // öre per timme
  overtime_simple_divisor: number; overtime_qualified_divisor: number;           // månadslön / delare = timersättning
  oncall_weekday: number; oncall_weekend: number;                                 // öre per timme
  vacation_supplement: number;                                                    // semestertillägg % av månadslönen per dag (lag 0,43, ofta 0,8)
  travel_divisor?: number;                                                        // restidsersättning: månadslön / delare per timme (0 = ingen)
}
export const HOUR_FIELDS = [
  ['ob_evening', 'OB kväll'], ['ob_night', 'OB natt'], ['ob_weekend', 'OB helg'], ['ob_holiday', 'OB storhelg'],
  ['ot_simple', 'Enkel övertid'], ['ot_qualified', 'Kvalificerad övertid'], ['oncall_weekday', 'Beredskap vardag'], ['oncall_weekend', 'Beredskap helg'], ['travel', 'Restid'],
] as const;
export type HourKey = (typeof HOUR_FIELDS)[number][0];
export type Hours = Partial<Record<HourKey, number>>;

export interface AgreementItem { type: 'salary'; description: string; amount: number; code: 'agreement' }
const h = (n: number) => String(n).replace('.', ',');

/** Lönerader för OB, övertid och beredskap utifrån timmar och avtalets regler */
export function agreementItems(r: AgreementRules, hours: Hours, monthly: number): AgreementItem[] {
  const out: AgreementItem[] = [];
  const add = (label: string, n: number | undefined, perHour: number) => {
    if (!n || n <= 0 || perHour <= 0) return;
    out.push({ type: 'salary', code: 'agreement', description: `${label} ${h(n)} h à ${(perHour / 100).toFixed(2).replace('.', ',')} kr`, amount: Math.round(n * perHour) });
  };
  add('OB kväll', hours.ob_evening, r.ob_evening);
  add('OB natt', hours.ob_night, r.ob_night);
  add('OB helg', hours.ob_weekend, r.ob_weekend);
  add('OB storhelg', hours.ob_holiday, r.ob_holiday);
  if (monthly > 0) {
    add('Enkel övertid', hours.ot_simple, r.overtime_simple_divisor > 0 ? Math.round(monthly / r.overtime_simple_divisor) : 0);
    add('Kvalificerad övertid', hours.ot_qualified, r.overtime_qualified_divisor > 0 ? Math.round(monthly / r.overtime_qualified_divisor) : 0);
  }
  add('Beredskap vardag', hours.oncall_weekday, r.oncall_weekday);
  add('Beredskap helg', hours.oncall_weekend, r.oncall_weekend);
  if (monthly > 0 && (r.travel_divisor ?? 0) > 0) add('Restid', hours.travel, Math.round(monthly / r.travel_divisor!));
  return out;
}

/**
 * Semesterlön enligt sammalöneregeln: månadslönen löper, plus semestertillägg per dag
 * (avtalets procentsats av månadslönen) och tillägg för rörliga lönedelar: 12 % av förra årets rörliga lön per betald semesterdag.
 */
export function sameRuleVacation(o: { monthly: number; days: number; supplementPercent: number; variableLastYear: number; paidDays: number }) {
  if (o.days <= 0) return { supplement: 0, variable: 0 };
  return {
    supplement: Math.round((o.monthly * o.supplementPercent * o.days) / 100),
    variable: o.paidDays > 0 ? Math.round(((0.12 * o.variableLastYear) / o.paidDays) * o.days) : 0,
  };
}

/** Löneväxling: avstådd bruttolön blir pensionspremie med en uppräkning (skillnaden mellan arbetsgivaravgift och särskild löneskatt) */
export const SACRIFICE_FACTOR = 1.058;
export function salarySacrifice(o: { amount: number; monthlyBefore: number; year: number; factor?: number }) {
  const amount = Math.max(0, Math.min(o.amount, o.monthlyBefore));
  const after = o.monthlyBefore - amount;
  // Under 8,07 inkomstbasbelopp per år sänks den allmänna pensionen
  const floor = Math.round((8.07 * ibb(o.year)) / 12);
  return { amount, premium: Math.round(amount * (o.factor ?? SACRIFICE_FACTOR)), after, floor, warning: amount > 0 && after < floor ? `Lönen efter löneväxling (${Math.round(after / 100)} kr) är under 8,07 inkomstbasbelopp/12 (${Math.round(floor / 100)} kr) – den allmänna pensionen minskar` : '' };
}

/** Årslön som anmäls till Collectum för ITP 2: månadslön × 12,2 */
export const itp2AnnualSalary = (monthly: number) => Math.round(monthly * 12.2);

export interface CollectumRow { pnr: string; name: string; plan: 'itp1' | 'itp2'; event: 'nyanmalan' | 'loneandring' | 'avanmalan'; date: string; annualSalary: number }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Fil med ITP-händelser till Collectum (nyanmälan, löneändring, avanmälan). Anpassa efter Collectums filbeskrivning. */
export function collectumXml(o: { orgnr: string; period: string; rows: CollectumRow[] }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<CollectumRapport version="1.0">
  <Arbetsgivare orgnr="${esc(o.orgnr.replace(/\D/g, ''))}" period="${esc(o.period)}"/>
${o.rows.map((r) => `  <Handelse typ="${r.event}" plan="${r.plan.toUpperCase()}" personnummer="${esc(r.pnr)}" namn="${esc(r.name)}" datum="${esc(r.date)}"${r.plan === 'itp2' && r.event !== 'avanmalan' ? ` arslon="${Math.round(r.annualSalary / 100)}"` : ''}/>`).join('\n')}
</CollectumRapport>
`;
}

/** Månadsrapport till Fora (avtalspension SAF-LO): lönesumma per anställd i hela kronor */
export function foraCsv(o: { orgnr: string; period: string; rows: { pnr: string; name: string; salary: number }[] }) {
  // Text som börjar med = + - @ (eller tab/CR) tolkas som formel i Excel – inleds med apostrof
  const q = (s: string) => `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  return ['Organisationsnummer;Period;Personnummer;Namn;Lönesumma', ...o.rows.map((r) => [o.orgnr.replace(/\D/g, ''), o.period.replace('-', ''), r.pnr, q(r.name), Math.round(r.salary / 100)].join(';'))].join('\r\n') + '\r\n';
}
