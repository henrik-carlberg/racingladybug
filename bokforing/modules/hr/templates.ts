// Checklistor och dokumentmallar för HR-processer. Mallarna är utgångspunkter – anpassa till
// kollektivavtal och egna rutiner. Anställningsavtalet innehåller de uppgifter som krävs enligt LAS 6 c §.
import { formatAmount } from '@/lib/money';

export type ProcessType = 'onboarding' | 'move' | 'offboarding';
export const PROCESS_LABEL: Record<ProcessType, string> = { onboarding: 'Onboarding', move: 'Förflyttning', offboarding: 'Offboarding' };

export interface TaskTemplate { title: string; responsible: 'HR' | 'Chef' | 'IT' | 'Lön' | 'Medarbetare'; offsetDays: number; autoKey?: string }

export const CHECKLISTS: Record<ProcessType, TaskTemplate[]> = {
  onboarding: [
    { title: 'Anställningsavtal signerat av båda parter', responsible: 'HR', offsetDays: -14, autoKey: 'document_signed' },
    { title: 'Inhämta skattebesked (skattetabell/kolumn) och bankkonto för lön', responsible: 'Lön', offsetDays: -7 },
    { title: 'Beställ dator, telefon och övrig utrustning', responsible: 'IT', offsetDays: -10 },
    { title: 'Skapa konton: e-post, system och behörigheter', responsible: 'IT', offsetDays: -2 },
    { title: 'Förbered arbetsplats, nycklar/passerkort', responsible: 'Chef', offsetDays: -2 },
    { title: 'Introduktionsplan och fadder/mentor utsedd', responsible: 'Chef', offsetDays: -5 },
    { title: 'Genomgång av arbetsmiljö, säkerhet och policyer', responsible: 'Chef', offsetDays: 5 },
    { title: 'Anmälan till tjänstepension och försäkringar', responsible: 'HR', offsetDays: 30 },
    { title: 'Uppföljningssamtal efter första månaden', responsible: 'Chef', offsetDays: 30 },
    { title: 'Utvärdering inför provanställningens slut (om provanställning)', responsible: 'Chef', offsetDays: 150 },
  ],
  move: [
    { title: 'Ändring av anställningsvillkor signerad', responsible: 'HR', offsetDays: -7, autoKey: 'document_signed' },
    { title: 'Överlämning av tidigare arbetsuppgifter', responsible: 'Chef', offsetDays: -3 },
    { title: 'Uppdatera behörigheter och system (ta bort gamla, lägg till nya)', responsible: 'IT', offsetDays: 0 },
    { title: 'Uppdatera lön, organisation och kostnadsställe', responsible: 'Lön', offsetDays: 0 },
    { title: 'Introduktion i ny roll', responsible: 'Chef', offsetDays: 7 },
  ],
  offboarding: [
    { title: 'Bekräftelse av anställningens upphörande signerad', responsible: 'HR', offsetDays: -30, autoKey: 'document_signed' },
    { title: 'Planera överlämning av arbetsuppgifter och kunder', responsible: 'Chef', offsetDays: -14 },
    { title: 'Slutlön: semesterersättning, innestående flex/övertid, avdrag', responsible: 'Lön', offsetDays: 0 },
    { title: 'Avgångssamtal', responsible: 'HR', offsetDays: -5 },
    { title: 'Återlämning av dator, telefon, nycklar och passerkort', responsible: 'IT', offsetDays: 0 },
    { title: 'Stäng konton och behörigheter, vidarebefordra e-post', responsible: 'IT', offsetDays: 0 },
    { title: 'Arbetsgivarintyg (Arbetsförmedlingen) och tjänstgöringsintyg', responsible: 'HR', offsetDays: 7 },
    { title: 'Avsluta tjänstepension och förmåner hos försäkringsbolag', responsible: 'HR', offsetDays: 14 },
  ],
};

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const kr = (ore: number) => `${formatAmount(ore)} kr`;

export interface Party { name: string; orgnr: string; address: string }
export interface Person { name: string; personal_number: string; address: string }

const EMPLOYMENT_TYPE: Record<string, string> = {
  tillsvidare: 'Tillsvidareanställning',
  provanstallning: 'Provanställning (längst sex månader) som övergår i tillsvidareanställning om den inte avbryts',
  visstid: 'Särskild visstidsanställning',
};

export function employmentContract(o: {
  employer: Party; employee: Person; title: string; department: string; start: string; employmentType: string; end?: string;
  salary: number; hours: string; workplace: string; vacationDays: number; noticeText: string; collectiveAgreement: string; pension: string; other: string;
}): string {
  return `
<h1>Anställningsavtal</h1>
<h3>1. Parter</h3>
<p><b>Arbetsgivare:</b> ${esc(o.employer.name)}, org.nr ${esc(o.employer.orgnr)}, ${esc(o.employer.address)}<br>
<b>Arbetstagare:</b> ${esc(o.employee.name)}, personnr ${esc(o.employee.personal_number.slice(0, 8))}-${esc(o.employee.personal_number.slice(8))}, ${esc(o.employee.address)}</p>
<h3>2. Befattning och arbetsuppgifter</h3>
<p>Arbetstagaren anställs som <b>${esc(o.title)}</b>${o.department ? ` inom ${esc(o.department)}` : ''}. Arbetsuppgifterna framgår av befattningen och kan förändras över tid i takt med verksamhetens behov.</p>
<h3>3. Tillträde och anställningsform</h3>
<p>Anställningen börjar den <b>${esc(o.start)}</b>. Anställningsform: <b>${esc(EMPLOYMENT_TYPE[o.employmentType] ?? o.employmentType)}</b>${o.end ? `, till och med ${esc(o.end)}` : ''}.</p>
<h3>4. Arbetsplats</h3>
<p>${esc(o.workplace || o.employer.address)}</p>
<h3>5. Lön</h3>
<p>Månadslön <b>${kr(o.salary)}</b> före skatt. Lönen betalas ut den 25:e varje månad till anvisat bankkonto. Lönen revideras enligt arbetsgivarens lönerevisionsrutiner${o.collectiveAgreement ? ' och tillämpligt kollektivavtal' : ''}.</p>
<h3>6. Arbetstid</h3>
<p>${esc(o.hours)}</p>
<h3>7. Semester</h3>
<p>Semester utgår med <b>${esc(o.vacationDays)} dagar</b> per semesterår enligt semesterlagen${o.collectiveAgreement ? ' och kollektivavtal' : ''}.</p>
<h3>8. Uppsägning</h3>
<p>${esc(o.noticeText)}</p>
<h3>9. Kollektivavtal, pension och försäkringar</h3>
<p>${o.collectiveAgreement ? `Kollektivavtal: ${esc(o.collectiveAgreement)}.` : 'Arbetsgivaren är inte bunden av kollektivavtal.'} ${esc(o.pension)}<br>
Arbetsgivaren betalar lagstadgade sociala avgifter. Socialförsäkringsskydd lämnas av Försäkringskassan.</p>
<h3>10. Övrigt</h3>
<p>${esc(o.other || 'Arbetstagaren omfattas av arbetsgivarens vid var tid gällande policyer. Sekretess gäller för företagets affärshemligheter även efter anställningens upphörande. Rätt till kompetensutveckling enligt arbetsgivarens rutiner.')}</p>
<p>Detta avtal har upprättats elektroniskt och signeras av båda parter.</p>`.trim();
}

export function termsChange(o: { employer: Party; employee: Person; effective: string; changes: { label: string; from: string; to: string }[]; reason: string }): string {
  return `
<h1>Ändring av anställningsvillkor</h1>
<p><b>Arbetsgivare:</b> ${esc(o.employer.name)}, org.nr ${esc(o.employer.orgnr)}<br><b>Arbetstagare:</b> ${esc(o.employee.name)}</p>
<p>Parterna är överens om att följande villkor ändras från och med <b>${esc(o.effective)}</b>:</p>
<table><thead><tr><th>Villkor</th><th>Tidigare</th><th>Nytt</th></tr></thead><tbody>
${o.changes.map((c) => `<tr><td>${esc(c.label)}</td><td>${esc(c.from)}</td><td><b>${esc(c.to)}</b></td></tr>`).join('\n')}
</tbody></table>
${o.reason ? `<p>Bakgrund: ${esc(o.reason)}</p>` : ''}
<p>Övriga villkor i anställningsavtalet gäller oförändrade.</p>`.trim();
}

export const OFFBOARDING_REASONS: Record<string, string> = {
  egen: 'Arbetstagarens egen uppsägning',
  arbetsbrist: 'Uppsägning från arbetsgivaren på grund av arbetsbrist',
  overenskommelse: 'Överenskommelse mellan parterna',
  visstid: 'Visstidsanställningen löper ut',
  pension: 'Pensionering',
};

export function terminationConfirmation(o: { employer: Party; employee: Person; lastDay: string; noticeDate: string; reason: string; notes: string }): string {
  return `
<h1>Bekräftelse av anställningens upphörande</h1>
<p><b>Arbetsgivare:</b> ${esc(o.employer.name)}, org.nr ${esc(o.employer.orgnr)}<br><b>Arbetstagare:</b> ${esc(o.employee.name)}</p>
<p>Anställningen upphör den <b>${esc(o.lastDay)}</b> (sista anställningsdag).</p>
<p>Orsak: ${esc(OFFBOARDING_REASONS[o.reason] ?? o.reason)}. Besked lämnades den ${esc(o.noticeDate)}.</p>
<p>Slutlön, inklusive semesterersättning för innestående semester, betalas ut vid ordinarie löneutbetalning efter anställningens slut.
Arbetstagaren återlämnar utrustning, nycklar och passerkort senast sista anställningsdagen. Sekretess gäller även efter anställningens upphörande.
Arbetsgivarintyg och tjänstgöringsintyg utfärdas på begäran.</p>
${o.notes ? `<p>${esc(o.notes)}</p>` : ''}
${o.reason === 'arbetsbrist' ? '<p>Arbetstagaren har företrädesrätt till återanställning enligt 25 § LAS under förutsättning att arbetstagaren anmäler anspråk på detta.</p>' : ''}`.trim();
}
