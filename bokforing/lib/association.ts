// Föreningar (ren logik): medlemsavgifter, gåvor och bidrag samt årsmöteshandlingar. Belopp i öre.
export const FEE_ACCOUNT = 3890;      // Medlemsavgifter (momsfria – ingen omsättning)
export const GIFT_ACCOUNT = 3985;     // Erhållna gåvor
export const GRANT_ACCOUNT = 3980;    // Erhållna bidrag
export const RESTRICTED_ACCOUNT = 2066; // Ändamålsbestämda medel (eget kapital)
export const ASSOC_EQUITY_RESULT = 2069; // Årets resultat i ideell förening
export const ASSOC_EQUITY_BALANCED = 2068; // Balanserat resultat

export interface Member { id: number; name: string; category: string; joined: string; left_on: string | null }
export interface FeeRate { category: string; amount: number }

/** Medlemmar som ska aviseras för året: medlem under året och inte utträdd vid aviseringen, med avgift för kategorin och inte redan aviserade */
export function membersToInvoice(members: Member[], rates: FeeRate[], year: number, invoiced: Set<number>, asOf = `${year}-01-01`): { member: Member; amount: number }[] {
  const r = new Map(rates.map((x) => [x.category, x.amount]));
  const cutoff = asOf > `${year}-01-01` ? asOf : `${year}-01-01`;
  return members.filter((m) => m.joined <= `${year}-12-31` && (!m.left_on || m.left_on > cutoff) && !invoiced.has(m.id))
    .map((m) => ({ member: m, amount: r.get(m.category) ?? 0 })).filter((x) => x.amount > 0);
}

/** Gåva eller bidrag: bank mot intäkt. Ändamålsbestämda medel förs dessutom till eget kapital (fritt → bundet ändamål). */
export function giftLines(o: { kind: 'gift' | 'grant'; amount: number; bank: number; restricted: boolean }): { account: number; amount: number }[] {
  const income = o.kind === 'gift' ? GIFT_ACCOUNT : GRANT_ACCOUNT;
  return [{ account: o.bank, amount: o.amount }, { account: income, amount: -o.amount }];
}

/** Medlemsstatistik för verksamhetsberättelsen */
export function memberStats(members: Member[], year: number) {
  const end = `${year}-12-31`, start = `${year}-01-01`;
  const active = members.filter((m) => m.joined <= end && (!m.left_on || m.left_on > end));
  const joined = members.filter((m) => m.joined >= start && m.joined <= end).length;
  const left = members.filter((m) => m.left_on && m.left_on >= start && m.left_on <= end).length;
  const byCategory = new Map<string, number>();
  for (const m of active) byCategory.set(m.category, (byCategory.get(m.category) ?? 0) + 1);
  return { total: active.length, joined, left, byCategory: [...byCategory].sort((a, b) => a[0].localeCompare(b[0])) };
}

export const DEFAULT_AGENDA = [
  'Mötets öppnande', 'Val av mötesordförande och mötessekreterare', 'Val av två justerare tillika rösträknare',
  'Fråga om mötet blivit stadgeenligt utlyst', 'Fastställande av röstlängd och dagordning',
  'Styrelsens verksamhetsberättelse', 'Resultat- och balansräkning', 'Revisorernas berättelse',
  'Fastställande av resultat- och balansräkning samt disposition av resultatet', 'Fråga om ansvarsfrihet för styrelsen',
  'Fastställande av medlemsavgift för kommande år', 'Behandling av motioner och propositioner',
  'Val av ordförande, styrelseledamöter och suppleanter', 'Val av revisorer', 'Val av valberedning', 'Mötets avslutande',
];

/** Senaste dag för kallelse: stadgarnas antal veckor före årsmötet (standard 2 veckor) */
export function noticeDeadline(meetingDate: string, weeks = 2) {
  const d = new Date(`${meetingDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - weeks * 7);
  return d.toISOString().slice(0, 10);
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kr = (ore: number) => `${(ore / 100).toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} kr`;
const page = (title: string, body: string) => `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Georgia,serif;max-width:720px;margin:32px auto;line-height:1.5}table{width:100%;border-collapse:collapse}td,th{padding:3px 6px;border-bottom:1px solid #ddd}td.n{text-align:right}</style></head><body>${body}</body></html>`;

export function noticeHtml(o: { org: string; year: number; date: string; time: string; place: string; agenda: string[]; extra: string }) {
  return page(`Kallelse till årsmöte ${o.year}`, `<h1>Kallelse till årsmöte</h1><p>Medlemmarna i <b>${esc(o.org)}</b> kallas till årsmöte för verksamhetsåret ${o.year}.</p>
<p><b>Tid:</b> ${esc(o.date)} ${esc(o.time)}<br><b>Plats:</b> ${esc(o.place)}</p><h2>Förslag till dagordning</h2><ol>${o.agenda.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>
${o.extra ? `<p>${esc(o.extra)}</p>` : ''}<p>Verksamhetsberättelse, resultat- och balansräkning och revisionsberättelse finns tillgängliga senast en vecka före mötet.</p><p>Välkomna!<br>Styrelsen</p>`);
}

export interface Statement { label: string; amount: number }
export function reportHtml(o: { org: string; orgnr: string; year: number; text: string; stats: ReturnType<typeof memberStats>; income: Statement[]; result: number; balance: Statement[]; board: string[] }) {
  const rows = (r: Statement[]) => r.map((x) => `<tr><td>${esc(x.label)}</td><td class="n">${kr(x.amount)}</td></tr>`).join('');
  return page(`Verksamhetsberättelse ${o.year}`, `<h1>Verksamhetsberättelse ${o.year}</h1><p>${esc(o.org)}${o.orgnr ? `, ${esc(o.orgnr)}` : ''}</p>
<p>Styrelsen avger härmed berättelse för verksamhetsåret ${o.year}.</p>${o.text.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('')}
<h2>Medlemmar</h2><p>Föreningen hade ${o.stats.total} medlemmar vid årets slut (${o.stats.joined} nya och ${o.stats.left} som lämnat under året).</p>
${o.stats.byCategory.length > 1 ? `<table>${o.stats.byCategory.map(([c, n]) => `<tr><td>${esc(c)}</td><td class="n">${n}</td></tr>`).join('')}</table>` : ''}
<h2>Resultaträkning</h2><table>${rows(o.income)}<tr><th style="text-align:left">Årets resultat</th><th class="n">${kr(o.result)}</th></tr></table>
<h2>Balansräkning</h2><table>${rows(o.balance)}</table>
<h2>Resultatdisposition</h2><p>Styrelsen föreslår att årets ${o.result >= 0 ? 'överskott' : 'underskott'} om ${kr(Math.abs(o.result))} balanseras i ny räkning.</p>
<p style="margin-top:40px">${o.board.map((b) => esc(b)).join(' &nbsp;·&nbsp; ')}</p>`);
}

export function auditReportHtml(o: { org: string; orgnr: string; year: number; auditors: string[]; remarks: string }) {
  return page(`Revisionsberättelse ${o.year}`, `<h1>Revisionsberättelse</h1><p>Till årsmötet i ${esc(o.org)}${o.orgnr ? `, org.nr ${esc(o.orgnr)}` : ''}</p>
<p>Vi har granskat föreningens räkenskaper, årsbokslut och styrelsens förvaltning för verksamhetsåret ${o.year}. Granskningen har utförts enligt god revisionssed i ideella föreningar.</p>
${o.remarks ? `<p><b>Anmärkningar:</b> ${esc(o.remarks)}</p>` : '<p>Vi har inte funnit något att anmärka på.</p>'}
<p>Vi tillstyrker att årsmötet fastställer resultat- och balansräkningen, att resultatet disponeras enligt styrelsens förslag och att styrelsens ledamöter beviljas ansvarsfrihet för verksamhetsåret.</p>
<p style="margin-top:40px">${o.auditors.map((a) => `${esc(a)}, revisor`).join(' &nbsp;·&nbsp; ')}</p>`);
}
