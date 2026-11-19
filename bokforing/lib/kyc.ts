// Kundkännedom enligt penningtvättslagen (2017:630) för redovisningsbyråer. Ren logik.

export const KYC_FACTORS = {
  cash: { label: 'Kontanthantering i verksamheten (t.ex. restaurang, frisör, butik)', points: 2 },
  industry: { label: 'Bransch med förhöjd risk (bygg, städ, transport, spel, fordon, konst, krypto)', points: 2 },
  foreign: { label: 'Ägare, huvudmän eller betalningar utanför EU/EES', points: 2 },
  complex: { label: 'Komplex ägarstruktur (ägs via bolag eller stiftelse, oklar kontroll)', points: 2 },
  newClient: { label: 'Ny kund eller nystartat bolag', points: 1 },
  remote: { label: 'Kunden har inte identifierats på plats eller med BankID', points: 1 },
  unusual: { label: 'Ovanliga eller stora transaktioner utan tydligt syfte', points: 3 },
} as const;
export type KycFactor = keyof typeof KYC_FACTORS;
export type Risk = 'low' | 'normal' | 'high';
export const RISK_LABEL: Record<Risk, string> = { low: 'Låg', normal: 'Normal', high: 'Hög' };

export interface Owner { name: string; birthYear: number | null; share: string; basis: string }

/** Riskpoäng: faktorer + PEP (alltid hög risk enligt 4 kap. 9 §) → risknivå och när bedömningen ska göras om */
export function assessRisk(factors: KycFactor[], pep: boolean, assessedOn: string) {
  const score = factors.reduce((s, f) => s + (KYC_FACTORS[f]?.points ?? 0), 0) + (pep ? 5 : 0);
  const risk: Risk = pep || score >= 5 ? 'high' : score >= 2 ? 'normal' : 'low';
  const months = risk === 'high' ? 6 : risk === 'normal' ? 12 : 24;
  return { score, risk, months, nextReview: addMonths(assessedOn, months), enhanced: risk === 'high' };
}

export function addMonths(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export type KycStatus = 'missing' | 'expired' | 'due' | 'ok';
export function kycStatus(nextReview: string | null, today: string): KycStatus {
  if (!nextReview) return 'missing';
  if (nextReview < today) return 'expired';
  const soon = addMonths(today, 1);
  return nextReview <= soon ? 'due' : 'ok';
}

/** Verkliga huvudmän från Bolagsverket (registret över verkliga huvudmän). Tål olika fältnamn. */
export function parseOwners(j: unknown): Owner[] {
  const list = (j && typeof j === 'object' && Array.isArray((j as Record<string, unknown>).huvudman) ? (j as { huvudman: unknown[] }).huvudman
    : Array.isArray(j) ? j : []) as Record<string, unknown>[];
  return list.slice(0, 50).map((h) => ({
    name: String(h.namn ?? h.name ?? '').slice(0, 200),
    birthYear: Number.isInteger(Number(h.fodelsear ?? h.birthYear)) ? Number(h.fodelsear ?? h.birthYear) : null,
    share: String(h.omfattning ?? h.andel ?? h.share ?? '').slice(0, 100),
    basis: String(h.grund ?? h.basis ?? '').slice(0, 200),
  })).filter((o) => o.name);
}

export const ENGAGEMENT_SERVICES = {
  bookkeeping: 'Löpande bokföring och avstämningar',
  vat: 'Momsdeklarationer',
  payroll: 'Lön och arbetsgivardeklarationer',
  closing: 'Bokslut och årsredovisning',
  tax: 'Inkomstdeklaration',
  advice: 'Rådgivning',
} as const;
export type EngagementService = keyof typeof ENGAGEMENT_SERVICES;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Uppdragsbrev (enligt god redovisningssed, t.ex. REKO): parter, uppdrag, arvode, ansvar, penningtvättslagen och personuppgifter */
export function engagementLetter(o: { firm: string; firmOrgnr: string; client: string; clientOrgnr: string; services: EngagementService[]; fee: string; start: string; date: string }) {
  const li = o.services.map((s) => `<li>${esc(ENGAGEMENT_SERVICES[s])}</li>`).join('');
  return `<h1>Uppdragsbrev</h1>
<p><b>Uppdragsgivare:</b> ${esc(o.client)} (${esc(o.clientOrgnr)})<br><b>Uppdragstagare:</b> ${esc(o.firm)}${o.firmOrgnr ? ` (${esc(o.firmOrgnr)})` : ''}<br><b>Från och med:</b> ${esc(o.start)}</p>
<h2>Uppdraget</h2><ul>${li}</ul>
<p>Uppdraget utförs enligt god redovisningssed. Uppdragsgivaren ansvarar för att bokföringen är fullständig och för att lämna riktiga och fullständiga underlag i tid. Uppdragsgivaren ansvarar också för de beslut som fattas utifrån uppdragets resultat och för att deklarationer och årsredovisning lämnas in.</p>
<h2>Arvode</h2><p>${esc(o.fee)}</p>
<h2>Penningtvättslagen</h2><p>Uppdragstagaren är skyldig att ha kundkännedom, bland annat om verkliga huvudmän och om någon är person i politiskt utsatt ställning, och att granska och rapportera misstänkta transaktioner till Finanspolisen. Uppdragsgivaren åtar sig att lämna de uppgifter som behövs. Saknas kundkännedom får uppdraget inte utföras.</p>
<h2>Personuppgifter</h2><p>Uppdragstagaren behandlar personuppgifter för uppdragsgivarens räkning enligt det biträdesavtal som gäller för tjänsten.</p>
<h2>Uppsägning</h2><p>Uppdraget gäller tills vidare med en ömsesidig uppsägningstid om tre månader.</p>
<p>${esc(o.date)}</p>`;
}
