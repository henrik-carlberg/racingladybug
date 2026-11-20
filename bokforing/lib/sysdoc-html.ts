// Systemdokumentation som HTML-sträng (ren logik). Allt som kommer från användare escapas.
import type { SysDoc } from './services/sysdoc';
import { COMPANY_TYPE_LABEL } from './partnership';

const e = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const ROLE: Record<string, string> = { owner: 'Ägare', accountant: 'Redovisningskonsult', auditor: 'Revisor', employee: 'Anställd' };
const kr = (o: number) => (o / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 }) + ' kr';
const table = (head: string[], rows: unknown[][]) => `<table>${head.length ? `<thead><tr>${head.map((h) => `<th>${e(h)}</th>`).join('')}</tr></thead>` : ''}<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${e(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

export function sysdocHtml(d: SysDoc): string {
  const c = d.company, i = d.integrations;
  const vat = c.vat_period === 'month' ? 'månadsvis' : c.vat_period === 'quarter' ? 'kvartalsvis' : 'årsvis';
  return `<div class="sysdoc">
<h1>Systemdokumentation och behandlingshistorik</h1>
<p>${e(c.name)}, ${e(c.orgnr)}. Upprättad automatiskt ${e(d.generated)} (systemversion ${e(d.version)}). Dokumentet beskriver hur bokföringen är organiserad enligt bokföringslagen 5 kap. 11 § och BFNAR 2013:2.</p>
<h2>1. Företaget och räkenskapsåren</h2>
${table([], [
  ['Bolagsform', c.company_type === 'EF' ? 'Enskild näringsverksamhet' : COMPANY_TYPE_LABEL[c.company_type as 'AB'] ?? c.company_type],
  ['Adress', [c.address, `${c.postal_code} ${c.city}`.trim()].filter(Boolean).join(', ') || '–'],
  ['Redovisningsmetod', c.accounting_method === 'cash' ? 'Kontantmetoden (bokslutsmetoden)' : 'Faktureringsmetoden'],
  ['Momsredovisning', c.vat_period === 'month' ? 'Varje månad' : c.vat_period === 'quarter' ? 'Varje kvartal' : 'En gång per år'],
  ['Låst till och med', c.locked_until ?? 'Ingen period är låst'],
  ['I tjänsten sedan', c.created_at],
])}
${table(['Räkenskapsår', 'Status', 'Verifikationer'], d.years.map((y) => [`${y.start} – ${y.end}`, y.closed ? 'Avslutat' : 'Öppet', y.vouchers]))}
<h2>2. Bokföringssystemet</h2>
<p>Bokföringen förs i en molntjänst. Data lagras i en PostgreSQL-databas med dagliga säkerhetskopior och en veckovis kontroll av att kopian går att återställa. Varje natt kontrolleras att alla verifikationer går jämnt ut, att verifikationsnumren saknar luckor och att inget har bokförts i låsta perioder.</p>
<p>En bokförd verifikation kan inte ändras eller tas bort. Fel rättas med en rättelseverifikation som hänvisar till den ursprungliga. Underlag (kvitton, fakturor) sparas tillsammans med verifikationen. Varje år kan ett arkivpaket med alla verifikationer, underlag, SIE-fil och denna dokumentation laddas ner och sparas i sju år.</p>
<p>Inloggning sker med e-post och lösenord, passkey eller BankID, med möjlighet till tvåstegsverifiering. Alla ändringar loggas med användare och tidpunkt (behandlingshistorik, avsnitt 7).</p>
<h2>3. Verifikationsserier</h2>
${table(['Serie', 'Innehåll', 'Antal', 'Period'], d.series.map((s) => [s.series, s.description, s.n, `${s.first} – ${s.last}`]))}
<p>Numreringen är löpande per serie och räkenskapsår och tilldelas automatiskt när verifikationen bokförs.</p>
<h2>4. Rutiner</h2>
<ul>
<li>Leverantörsfakturor attesteras innan de betalas${c.attest_threshold ? `; fakturor över ${e(kr(Number(c.attest_threshold)))} kräver två attester` : ''}${c.attest_not_registrant ? '; den som registrerat fakturan får inte attestera den' : ''}.</li>
<li>Banken stäms av mot bokföringen${i.bank ? ' med transaktioner som hämtas automatiskt från banken' : ' med kontoutdrag som importeras'}${i.rules ? ` och ${e(i.rules)} konteringsregler` : ''}.</li>
<li>Moms redovisas ${vat} och avräknas mot konto 2650.</li>
<li>Perioder låses när de är avstämda och redovisade.</li>
</ul>
<h2>5. Integrationer</h2>
<ul>
<li>Bankkoppling: ${i.bank ? `${e(i.bank)} aktiv(a)` : 'ingen (filimport)'}</li>
<li>Inkorg för leverantörsfakturor via e-post: ${i.inbox ? 'ja' : 'nej'}</li>
<li>Autogiro: ${i.autogiro ? 'ja' : 'nej'} · Kortbetalning av fakturor: ${i.stripe ? 'ja' : 'nej'}</li>
<li>API-nycklar: ${e(i.api_keys)} · Webhooks: ${e(i.webhooks)}</li>
</ul>
<h2>6. Användare och behörigheter</h2>
${table(['Namn', 'Roll', 'Behörighet', 'Sedan'], [
  ...d.users.map((u) => [u.name, ROLE[u.role] ?? u.role, u.permissions ? u.permissions.map((p) => d.permissionNames[p] ?? p).join(', ') : 'Allt', u.since]),
  ...d.firms.map((f) => [f.name, 'Redovisningsbyrå', 'Allt', f.since]),
])}
<h2>7. Behandlingshistorik</h2>
<p>Händelser senaste tolv månaderna:</p>
${table(['Händelse', 'Antal'], d.audit.map((a) => [`${a.entity}: ${a.action}`, a.n]))}
<p>Senaste ändringar av inställningar, kontoplan, användare och räkenskapsår:</p>
${table(['Tid', 'Vem', 'Ändring'], d.changes.map((x) => [x.at, x.who ?? '–', `${x.entity}: ${x.action}`]))}
<h2>8. Kontoplan</h2>
${table(['Konto', 'Namn'], d.accounts.filter((a) => a.active).map((a) => [a.number, a.name]))}
</div>`;
}
