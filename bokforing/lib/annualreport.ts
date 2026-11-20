// Utkast till årsredovisning (K2, BFNAR 2016:10) för mindre aktiebolag, årsstämmoprotokoll
// och förenklat årsbokslut (K1) för enskild firma. Ren logik – tar kontosaldon och ger HTML.
// Delar enligt ÅRL 2:1: förvaltningsberättelse, resultaträkning, balansräkning och noter.
import { formatAmount } from './money';
import type { Sums } from './taxforms';
import type { CashFlow } from './cashflow';

export type Range = [number, number];
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const sum = (m: Sums, ranges: Range[]) => { let t = 0; for (const [n, v] of m) if (ranges.some(([a, b]) => n >= a && n <= b)) t += v; return t; };
const kr = (ore: number) => formatAmount(Math.round(ore / 100) * 100, { decimals: false });

export interface YearFigures { label: string; start: string; end: string; result: Sums; closing: Sums; opening: Sums }

const RR: { label: string; ranges: Range[]; sign: 1 | -1 }[] = [
  { label: 'Nettoomsättning', ranges: [[3000, 3799]], sign: -1 },
  { label: 'Övriga rörelseintäkter', ranges: [[3800, 3999]], sign: -1 },
  { label: 'Råvaror, förnödenheter och handelsvaror', ranges: [[4000, 4999]], sign: -1 },
  { label: 'Övriga externa kostnader', ranges: [[5000, 6999]], sign: -1 },
  { label: 'Personalkostnader', ranges: [[7000, 7699]], sign: -1 },
  { label: 'Av- och nedskrivningar av anläggningstillgångar', ranges: [[7700, 7899]], sign: -1 },
  { label: 'Övriga rörelsekostnader', ranges: [[7900, 7999]], sign: -1 },
];
const FIN: { label: string; ranges: Range[] }[] = [
  { label: 'Övriga ränteintäkter och liknande resultatposter', ranges: [[8000, 8399]] },
  { label: 'Räntekostnader och liknande resultatposter', ranges: [[8400, 8499]] },
];

export interface KeyFigures { netSales: number; operating: number; afterFinancial: number; beforeTax: number; tax: number; result: number; totalAssets: number; equity: number; untaxedReserves: number; solidity: number }

/** Årets nyckeltal. Resultat beräknas från resultatkontona (8999 ingår inte). */
export function keyFigures(y: YearFigures): KeyFigures {
  const pl = (r: Range[]) => -sum(y.result, r);
  const netSales = pl([[3000, 3799]]);
  const operating = pl([[3000, 7999]]);
  const afterFinancial = operating + pl([[8000, 8499]]);
  const beforeTax = afterFinancial + pl([[8800, 8899]]);
  const tax = -pl([[8900, 8989]]);
  const result = beforeTax - tax;
  const totalAssets = sum(y.closing, [[1000, 1999]]);
  const equity = -sum(y.closing, [[2000, 2099]]);
  const untaxedReserves = -sum(y.closing, [[2100, 2199]]);
  const adjusted = equity + untaxedReserves * (1 - 0.206); // justerat eget kapital
  return { netSales, operating, afterFinancial, beforeTax, tax, result, totalAssets, equity, untaxedReserves, solidity: totalAssets ? Math.round((adjusted / totalAssets) * 1000) / 10 : 0 };
}

export interface AnnualReportInput {
  company: { name: string; orgnr: string; city: string };
  years: YearFigures[]; // [innevarande, föregående, ...] – upp till 4 för flerårsöversikt
  activity: string; // verksamhetsbeskrivning inkl. säte
  events: string; // väsentliga händelser
  dividend: number; // öre, föreslagen utdelning
  board: { name: string; role: string }[];
  employees: number; // medelantal anställda
  place: string;
  /** Pågående fastprisuppdrag (successiv vinstavräkning) */
  poc?: { earned: number; invoiced: number; asset: number; liability: number; loss: number };
  /** Framtida leasingavgifter för operationella avtal per förfallotid */
  leasing?: { within1: number; oneTo5: number; over5: number; total: number; yearCost: number };
  /** Bostadsrättsförening: nyckeltal enligt BFNAR 2023:1 och fond för yttre underhåll */
  brf?: { rows: { label: string; value: number }[]; fund: { opening: number; closing: number } };
  /** K3 (BFNAR 2012:1): kassaflödesanalys och utökade noter */
  k3?: { cashflow: CashFlow; opening: number; closing: number; deferred: { rows: { label: string; amount: number; tax: number }[]; liability: number; asset: number }; components: { name: string; cost: number; life_months: number; booked: number }[]; untaxed: number };
}

function row(label: string, cur: number, prev: number | null, opts: { bold?: boolean; note?: string } = {}) {
  const tag = opts.bold ? 'b' : 'span';
  return `<tr><td><${tag}>${esc(label)}</${tag}>${opts.note ? ` <small>(Not ${opts.note})</small>` : ''}</td><td style="text-align:right"><${tag}>${kr(cur)}</${tag}></td>${prev === null ? '' : `<td style="text-align:right">${kr(prev)}</td>`}</tr>`;
}

export function annualReportHtml(i: AnnualReportInput): string {
  const [cur, prev] = i.years;
  const k = keyFigures(cur);
  const kp = prev ? keyFigures(prev) : null;
  const P = (fn: (y: YearFigures) => number) => [fn(cur), prev ? fn(prev) : null] as const;
  const head = (a: string) => `<tr><th></th><th style="text-align:right">${esc(cur.label)}</th>${prev ? `<th style="text-align:right">${esc(prev.label)}</th>` : ''}</tr><tr><td colspan="3"><b>${esc(a)}</b></td></tr>`;
  const plRows = RR.map((r) => { const [c, p] = P((y) => r.sign * sum(y.result, r.ranges)); return row(r.label, c, p); }).join('');
  const finRows = FIN.map((r) => { const [c, p] = P((y) => -sum(y.result, r.ranges)); return row(r.label, c, p); }).join('');
  const bal = (label: string, ranges: Range[], liab = false, note?: string) => {
    const [c, p] = P((y) => (liab ? -1 : 1) * sum(y.closing, ranges));
    return c === 0 && !p ? '' : row(label, c, p, { note });
  };
  // Eget kapital
  // Förutsätter att closing innehåller årets resultat på 2099 (tjänsten lägger till det om året inte är stängt).
  // Balanserat resultat = allt fritt eget kapital minus årets resultat, så att ej disponerade tidigare resultat kommer med.
  const equityParts = (y: YearFigures) => {
    const shareCap = -sum(y.closing, [[2080, 2089]]);
    const yr = keyFigures(y).result;
    const retained = -sum(y.closing, [[2000, 2079], [2090, 2099]]) - yr;
    return { shareCap, retained, thisYear: yr };
  };
  const e = equityParts(cur);
  const ibShare = -sum(cur.opening, [[2080, 2089]]);
  const ibRetained = -sum(cur.opening, [[2000, 2079], [2090, 2098]]);
  const ibYear = -sum(cur.opening, [[2099, 2099]]);
  const freeEquity = e.retained + e.thisYear;
  const toCarry = freeEquity - i.dividend;
  const years = i.years.slice(0, 4);

  return `
<h1>Årsredovisning</h1>
<p>för<br><b>${esc(i.company.name)}</b><br>${esc(i.company.orgnr)}</p>
<p>Räkenskapsåret ${esc(cur.start)} – ${esc(cur.end)}</p>
<p>Styrelsen avger följande årsredovisning. Alla belopp redovisas i kronor om inte annat anges.</p>

<h2>Förvaltningsberättelse</h2>
<h3>Verksamheten</h3>
<p>${esc(i.activity || `Bolaget bedriver verksamhet med säte i ${i.company.city}.`).replace(/\n/g, '<br>')}</p>
<h3>Väsentliga händelser under räkenskapsåret</h3>
<p>${esc(i.events || 'Inga väsentliga händelser har inträffat under räkenskapsåret.').replace(/\n/g, '<br>')}</p>
<h3>Flerårsöversikt</h3>
<table><thead><tr><th></th>${years.map((y) => `<th style="text-align:right">${esc(y.label)}</th>`).join('')}</tr></thead><tbody>
<tr><td>Nettoomsättning</td>${years.map((y) => `<td style="text-align:right">${kr(keyFigures(y).netSales)}</td>`).join('')}</tr>
<tr><td>Resultat efter finansiella poster</td>${years.map((y) => `<td style="text-align:right">${kr(keyFigures(y).afterFinancial)}</td>`).join('')}</tr>
<tr><td>Soliditet (%)</td>${years.map((y) => `<td style="text-align:right">${keyFigures(y).solidity.toString().replace('.', ',')}</td>`).join('')}</tr>
</tbody></table>
<p><small>Soliditet: justerat eget kapital (eget kapital + 79,4 % av obeskattade reserver) i procent av balansomslutningen.</small></p>
${i.brf ? `<h3>Nyckeltal för bostadsrättsföreningen</h3><table><tbody>${i.brf.rows.map((r) => `<tr><td>${esc(r.label)}</td><td style="text-align:right">${r.value.toLocaleString('sv-SE')}</td></tr>`).join('')}</tbody></table>
<h3>Fond för yttre underhåll</h3><p>Vid årets början ${kr(i.brf.fund.opening)} kr, vid årets slut ${kr(i.brf.fund.closing)} kr.</p>` : ''}
<h3>Förändringar i eget kapital</h3>
<table><thead><tr><th></th><th style="text-align:right">Aktiekapital</th><th style="text-align:right">Balanserat resultat</th><th style="text-align:right">Årets resultat</th><th style="text-align:right">Totalt</th></tr></thead><tbody>
<tr><td>Belopp vid årets ingång</td><td style="text-align:right">${kr(ibShare)}</td><td style="text-align:right">${kr(ibRetained)}</td><td style="text-align:right">${kr(ibYear)}</td><td style="text-align:right">${kr(ibShare + ibRetained + ibYear)}</td></tr>
<tr><td>Disposition enligt årsstämma, utdelning m.m.</td><td style="text-align:right">${kr(e.shareCap - ibShare)}</td><td style="text-align:right">${kr(e.retained - ibRetained)}</td><td style="text-align:right">${kr(-ibYear)}</td><td style="text-align:right">${kr(e.shareCap - ibShare + e.retained - ibRetained - ibYear)}</td></tr>
<tr><td>Årets resultat</td><td></td><td></td><td style="text-align:right">${kr(e.thisYear)}</td><td style="text-align:right">${kr(e.thisYear)}</td></tr>
<tr><td><b>Belopp vid årets utgång</b></td><td style="text-align:right"><b>${kr(e.shareCap)}</b></td><td style="text-align:right"><b>${kr(e.retained)}</b></td><td style="text-align:right"><b>${kr(e.thisYear)}</b></td><td style="text-align:right"><b>${kr(e.shareCap + e.retained + e.thisYear)}</b></td></tr>
</tbody></table>
<h3>Resultatdisposition</h3>
<p>Till årsstämmans förfogande står följande medel (kronor):</p>
<table><tbody>
<tr><td>Balanserat resultat</td><td style="text-align:right">${kr(e.retained)}</td></tr>
<tr><td>Årets resultat</td><td style="text-align:right">${kr(e.thisYear)}</td></tr>
<tr><td><b>Summa</b></td><td style="text-align:right"><b>${kr(freeEquity)}</b></td></tr>
</tbody></table>
<p>Styrelsen föreslår att medlen disponeras enligt följande:</p>
<table><tbody>
${i.dividend ? `<tr><td>Utdelas till aktieägarna</td><td style="text-align:right">${kr(i.dividend)}</td></tr>` : ''}
<tr><td>Balanseras i ny räkning</td><td style="text-align:right">${kr(toCarry)}</td></tr>
<tr><td><b>Summa</b></td><td style="text-align:right"><b>${kr(freeEquity)}</b></td></tr>
</tbody></table>
<p>Bolagets resultat och ställning i övrigt framgår av efterföljande resultat- och balansräkning med noter.</p>

<h2>Resultaträkning</h2>
<table><tbody>
${head('Rörelseintäkter')}
${plRows}
${row('Rörelseresultat', k.operating, kp?.operating ?? null, { bold: true })}
<tr><td colspan="3"><b>Finansiella poster</b></td></tr>
${finRows}
${row('Resultat efter finansiella poster', k.afterFinancial, kp?.afterFinancial ?? null, { bold: true })}
${k.beforeTax !== k.afterFinancial || (kp && kp.beforeTax !== kp.afterFinancial) ? row('Bokslutsdispositioner', k.beforeTax - k.afterFinancial, kp ? kp.beforeTax - kp.afterFinancial : null) : ''}
${row('Resultat före skatt', k.beforeTax, kp?.beforeTax ?? null, { bold: true })}
${row('Skatt på årets resultat', -k.tax, kp ? -kp.tax : null)}
${row('Årets resultat', k.result, kp?.result ?? null, { bold: true })}
</tbody></table>
<p><small>Kostnader redovisas med minustecken.</small></p>

<h2>Balansräkning</h2>
<table><tbody>
${head('Tillgångar')}
${bal('Immateriella anläggningstillgångar', [[1000, 1099]])}
${bal('Byggnader och mark', [[1100, 1199]])}
${bal('Maskiner och inventarier', [[1200, 1299]])}
${bal('Finansiella anläggningstillgångar', [[1300, 1399]])}
${bal('Varulager', [[1400, 1499]])}
${bal('Kundfordringar', [[1500, 1599]])}
${bal('Övriga fordringar', [[1600, 1699]])}
${bal('Förutbetalda kostnader och upplupna intäkter', [[1700, 1799]])}
${bal('Kortfristiga placeringar', [[1800, 1899]])}
${bal('Kassa och bank', [[1900, 1999]])}
${row('Summa tillgångar', k.totalAssets, kp?.totalAssets ?? null, { bold: true })}
<tr><td colspan="3"><b>Eget kapital och skulder</b></td></tr>
${row(i.brf ? 'Insatser, upplåtelseavgifter och fond för yttre underhåll' : 'Aktiekapital', e.shareCap, prev ? equityParts(prev).shareCap : null)}
${row('Balanserat resultat', e.retained, prev ? equityParts(prev).retained : null)}
${row('Årets resultat', e.thisYear, kp?.result ?? null)}
${row('Summa eget kapital', e.shareCap + e.retained + e.thisYear, prev ? equityParts(prev).shareCap + equityParts(prev).retained + (kp?.result ?? 0) : null, { bold: true })}
${bal('Obeskattade reserver', [[2100, 2199]], true)}
${bal('Avsättningar', [[2200, 2299]], true)}
${bal('Långfristiga skulder', [[2300, 2399]], true)}
${bal('Leverantörsskulder', [[2440, 2449]], true)}
${bal('Skatteskulder', [[2500, 2599]], true)}
${bal('Övriga kortfristiga skulder', [[2400, 2439], [2450, 2499], [2600, 2899]], true)}
${bal('Upplupna kostnader och förutbetalda intäkter', [[2900, 2999]], true)}
${row('Summa eget kapital och skulder', k.totalAssets, kp?.totalAssets ?? null, { bold: true })}
</tbody></table>

${i.k3 ? k3CashFlowHtml(i.k3) : ''}
<h2>Noter</h2>
<h3>Not 1 Redovisningsprinciper</h3>
${i.k3 ? `<p>Årsredovisningen har upprättats i enlighet med årsredovisningslagen och Bokföringsnämndens allmänna råd BFNAR 2012:1 Årsredovisning och koncernredovisning (K3).</p>
<p>Materiella anläggningstillgångar redovisas till anskaffningsvärde minskat med ackumulerade avskrivningar. Tillgångar med väsentliga komponenter med olika nyttjandeperiod delas upp och skrivs av var för sig (komponentavskrivning). Mark skrivs inte av.</p>
<p>Inkomstskatt består av aktuell och uppskjuten skatt. Uppskjuten skatt beräknas på temporära skillnader mellan redovisade och skattemässiga värden med ${'20,6'} % skattesats.</p>
<p>Kassaflödesanalysen är upprättad enligt indirekt metod. Likvida medel utgörs av kassa och banktillgodohavanden.</p>` : '<p>Årsredovisningen har upprättats i enlighet med årsredovisningslagen och Bokföringsnämndens allmänna råd (BFNAR 2016:10) om årsredovisning i mindre företag (K2).</p>'}
${i.k3 ? `<h3>Not 2 Viktiga uppskattningar och bedömningar</h3><p>Nyttjandeperioder för materiella anläggningstillgångar och deras komponenter, samt värdering av uppskjuten skattefordran, bygger på styrelsens bedömningar. Bedömningarna ses över varje år.</p>` : ''}
<h3>Not ${i.k3 ? 3 : 2} Medelantalet anställda</h3>
<p>Medelantalet anställda under räkenskapsåret har uppgått till ${esc(i.employees)}.</p>
${i.k3 ? k3NotesHtml(i.k3, i.leasing, i.poc) : extraNotes(3, i.leasing, i.poc).html}

<h2>Underskrifter</h2>
<p>${esc(i.place || i.company.city)} den ______________</p>
${i.board.map((b) => `<p><br>______________________________<br>${esc(b.name)}<br><small>${esc(b.role)}</small></p>`).join('')}

<h2>Fastställelseintyg</h2>
<p>Jag intygar att resultaträkningen och balansräkningen har fastställts på årsstämma den ______________.
Årsstämman beslutade att godkänna styrelsens förslag till disposition av resultatet.
Jag intygar att innehållet i dessa dokument överensstämmer med originalen.</p>
<p><br>______________________________<br>${esc(i.board[0]?.name ?? '')}<br><small>${esc(i.board[0]?.role ?? 'Styrelseledamot')}</small></p>`.trim();
}

export function agmMinutesHtml(o: { company: { name: string; orgnr: string }; fyStart: string; fyEnd: string; date: string; place: string; chair: string;
  attendees: string[]; result: number; retained: number; dividend: number; board: string[]; auditorWaived: boolean }): string {
  const free = o.retained + o.result;
  return `
<h1>Protokoll fört vid årsstämma</h1>
<p><b>${esc(o.company.name)}</b>, ${esc(o.company.orgnr)}<br>Datum: ${esc(o.date)}<br>Plats: ${esc(o.place)}</p>
<h3>§ 1 Stämmans öppnande och val av ordförande</h3>
<p>Stämman öppnades och ${esc(o.chair)} valdes till ordförande, tillika protokollförare.</p>
<h3>§ 2 Röstlängd</h3>
<p>Närvarande aktieägare: ${o.attendees.map(esc).join(', ')}. Förteckningen godkändes som röstlängd.</p>
<h3>§ 3 Kallelse och dagordning</h3>
<p>Stämman konstaterades vara behörigen sammankallad och dagordningen godkändes.</p>
<h3>§ 4 Framläggande av årsredovisning</h3>
<p>Årsredovisningen för räkenskapsåret ${esc(o.fyStart)} – ${esc(o.fyEnd)} framlades${o.auditorWaived ? '' : ' tillsammans med revisionsberättelsen'}.</p>
<h3>§ 5 Fastställande av resultat- och balansräkning</h3>
<p>Stämman beslutade att fastställa resultaträkningen och balansräkningen.</p>
<h3>§ 6 Disposition av resultatet</h3>
<p>Till stämmans förfogande stod ${kr(free)} kr (balanserat resultat ${kr(o.retained)} kr och årets resultat ${kr(o.result)} kr).
Stämman beslutade ${o.dividend ? `att dela ut ${kr(o.dividend)} kr till aktieägarna och ` : ''}att ${kr(free - o.dividend)} kr balanseras i ny räkning.</p>
<h3>§ 7 Ansvarsfrihet</h3>
<p>Stämman beslutade att bevilja styrelseledamöterna ansvarsfrihet för räkenskapsåret.</p>
<h3>§ 8 Styrelse${o.auditorWaived ? ' och revisor' : ''}</h3>
<p>Till styrelse för tiden intill nästa årsstämma omvaldes ${o.board.map(esc).join(', ')}.${o.auditorWaived ? ' Bolaget uppfyller villkoren för att avstå från revisor och ingen revisor väljs.' : ''}</p>
<h3>§ 9 Stämmans avslutande</h3>
<p>Ordföranden förklarade stämman avslutad.</p>
<p>Protokollet justeras genom elektronisk signering.</p>`.trim();
}

/** Förenklat årsbokslut (K1) för enskild firma: resultat- och balansräkning (BFL 6:6) */
export function simplifiedClosingHtml(o: { owner: string; company: { name: string; orgnr: string; city: string }; fyStart: string; fyEnd: string;
  income: { box: string; label: string; amount: number; sign: string }[]; balance: { box: string; label: string; amount: number }[] }): string {
  const rows = (list: { box: string; label: string; amount: number; sign?: string }[]) => list.filter((f) => f.amount !== 0 || /R11|B10/.test(f.box))
    .map((f) => `<tr><td>${esc(f.label)}</td><td style="text-align:right">${f.sign === '-' ? '−' : ''}${kr(f.amount)}</td></tr>`).join('');
  return `
<h1>Förenklat årsbokslut</h1>
<p><b>${esc(o.company.name)}</b><br>Enskild näringsidkare: ${esc(o.owner)}<br>Räkenskapsår ${esc(o.fyStart)} – ${esc(o.fyEnd)}</p>
<p>Årsbokslutet har upprättats enligt Bokföringsnämndens allmänna råd (BFNAR 2006:1) om förenklat årsbokslut.</p>
<h2>Resultaträkning</h2><table><tbody>${rows(o.income)}</tbody></table>
<h2>Balansräkning per ${esc(o.fyEnd)}</h2><table><tbody>${rows(o.balance)}</tbody></table>
<p>${esc(o.company.city)} den ______________</p>
<p><br>______________________________<br>${esc(o.owner)}</p>`.trim();
}


function k3CashFlowHtml(k: NonNullable<AnnualReportInput['k3']>) {
  const r = (l: { label: string; amount: number }) => l.amount ? `<tr><td>${esc(l.label)}</td><td style="text-align:right">${kr(l.amount)}</td></tr>` : '';
  const t = (label: string, v: number) => `<tr><td><b>${esc(label)}</b></td><td style="text-align:right"><b>${kr(v)}</b></td></tr>`;
  const c = k.cashflow;
  return `<h2>Kassaflödesanalys</h2><table><tbody>
<tr><td colspan="2"><b>Den löpande verksamheten</b></td></tr>${c.operating.map(r).join('')}${t('Kassaflöde före förändring av rörelsekapital', c.beforeWorkingCapital)}
${c.workingCapital.map(r).join('')}${t('Kassaflöde från den löpande verksamheten', c.operatingTotal)}
<tr><td colspan="2"><b>Investeringsverksamheten</b></td></tr>${c.investing.map(r).join('')}${t('Kassaflöde från investeringsverksamheten', c.investingTotal)}
<tr><td colspan="2"><b>Finansieringsverksamheten</b></td></tr>${c.financing.map(r).join('')}${t('Kassaflöde från finansieringsverksamheten', c.financingTotal)}
${t('Årets kassaflöde', c.change)}<tr><td>Likvida medel vid årets början</td><td style="text-align:right">${kr(k.opening)}</td></tr>${t('Likvida medel vid årets slut', k.closing)}
</tbody></table>`;
}

function leasingNoteHtml(n: number, l: NonNullable<AnnualReportInput['leasing']>) {
  return `<h3>Not ${n} Leasingavtal</h3><p>Årets leasingavgifter uppgår till ${kr(l.yearCost)} kr. Framtida minimileaseavgifter för icke uppsägningsbara operationella leasingavtal förfaller enligt följande:</p>
<table><tbody><tr><td>Inom ett år</td><td style="text-align:right">${kr(l.within1)}</td></tr><tr><td>Senare än ett år men inom fem år</td><td style="text-align:right">${kr(l.oneTo5)}</td></tr><tr><td>Senare än fem år</td><td style="text-align:right">${kr(l.over5)}</td></tr><tr><td><b>Summa</b></td><td style="text-align:right"><b>${kr(l.total)}</b></td></tr></tbody></table>`;
}

function pocNoteHtml(n: number, p: NonNullable<AnnualReportInput['poc']>) {
  return `<h3>Not ${n} Pågående uppdrag till fast pris</h3><p>Uppdragen redovisas enligt successiv vinstavräkning efter färdigställandegrad (nedlagda kostnader i förhållande till beräknade totala kostnader).</p>
<table><tbody><tr><td>Upparbetade intäkter</td><td style="text-align:right">${kr(p.earned)}</td></tr><tr><td>Fakturerade belopp</td><td style="text-align:right">${kr(p.invoiced)}</td></tr>
<tr><td>Upparbetad men ej fakturerad intäkt</td><td style="text-align:right">${kr(p.asset)}</td></tr><tr><td>Fakturerad men ej upparbetad intäkt</td><td style="text-align:right">${kr(p.liability)}</td></tr>${p.loss ? `<tr><td>Avsättning för befarade förluster</td><td style="text-align:right">${kr(p.loss)}</td></tr>` : ''}</tbody></table>`;
}

function extraNotes(start: number, leasing?: AnnualReportInput['leasing'], poc?: AnnualReportInput['poc']) {
  let n = start; const parts: string[] = [];
  if (poc) parts.push(pocNoteHtml(n++, poc));
  if (leasing?.total) parts.push(leasingNoteHtml(n++, leasing));
  return { html: parts.join('\n'), next: n };
}

function k3NotesHtml(k: NonNullable<AnnualReportInput['k3']>, leasing?: AnnualReportInput['leasing'], poc?: AnnualReportInput['poc']) {
  let n = 4;
  const parts: string[] = [];
  if (k.components.length) parts.push(`<h3>Not ${n++} Materiella anläggningstillgångar</h3><table><thead><tr><th>Tillgång/komponent</th><th style="text-align:right">Anskaffningsvärde</th><th style="text-align:right">Ack. avskrivningar</th><th style="text-align:right">Redovisat värde</th><th style="text-align:right">Nyttjandeperiod</th></tr></thead><tbody>
${k.components.map((c) => `<tr><td>${esc(c.name)}</td><td style="text-align:right">${kr(c.cost)}</td><td style="text-align:right">${kr(-c.booked)}</td><td style="text-align:right">${kr(c.cost - c.booked)}</td><td style="text-align:right">${Math.round(c.life_months / 12)} år</td></tr>`).join('')}</tbody></table>`);
  parts.push(`<h3>Not ${n++} Uppskjuten skatt</h3>${k.deferred.rows.length ? `<table><thead><tr><th>Temporär skillnad</th><th style="text-align:right">Skillnad</th><th style="text-align:right">Uppskjuten skatt</th></tr></thead><tbody>
${k.deferred.rows.map((d) => `<tr><td>${esc(d.label)}</td><td style="text-align:right">${kr(d.amount)}</td><td style="text-align:right">${kr(d.tax)}</td></tr>`).join('')}</tbody></table>
<p>Uppskjuten skatteskuld ${kr(k.deferred.liability)} kr, uppskjuten skattefordran ${kr(k.deferred.asset)} kr.</p>` : '<p>Det finns inga temporära skillnader.</p>'}
${k.untaxed ? `<p>I obeskattade reserver ingår uppskjuten skatt med ${kr(Math.round(k.untaxed * 0.206))} kr.</p>` : ''}`);
  { const x = extraNotes(n, leasing, poc); if (x.html) parts.push(x.html); n = x.next; }
  parts.push(`<h3>Not ${n++} Ställda säkerheter och eventualförpliktelser</h3><p>Inga, utöver vad som framgår av balansräkningen.</p>`);
  return parts.join('\n');
}


/** Årsbokslut för handels- och kommanditbolag: resultat- och balansräkning samt delägarnas kapitalkonton (BFL 6:4) */
export function partnershipClosingHtml(o: { company: { name: string; orgnr: string; city: string }; type: 'HB' | 'KB'; years: YearFigures[];
  partners: { name: string; sharePct: number; limited: boolean; opening: number; withdrawals: number; contributions: number; result: number; closing: number }[] }) {
  const [cur, prev] = o.years;
  const k = keyFigures(cur);
  const kp = prev ? keyFigures(prev) : null;
  const P = (fn: (y: YearFigures) => number) => [fn(cur), prev ? fn(prev) : null] as const;
  const head = `<tr><th></th><th style="text-align:right">${esc(cur.label)}</th>${prev ? `<th style="text-align:right">${esc(prev.label)}</th>` : ''}</tr>`;
  const pl = RR.map((r) => { const [c, p] = P((y) => r.sign * sum(y.result, r.ranges)); return c || p ? row(r.label, c, p) : ''; }).join('');
  const fin = FIN.map((r) => { const [c, p] = P((y) => -sum(y.result, r.ranges)); return c || p ? row(r.label, c, p) : ''; }).join('');
  const bal = (label: string, ranges: Range[], liab = false) => { const [c, p] = P((y) => (liab ? -1 : 1) * sum(y.closing, ranges)); return c === 0 && !p ? '' : row(label, c, p); };
  return `
<h1>Årsbokslut</h1>
<p>för<br><b>${esc(o.company.name)}</b> (${o.type === 'HB' ? 'handelsbolag' : 'kommanditbolag'})<br>${esc(o.company.orgnr)}</p>
<p>Räkenskapsåret ${esc(cur.start)} – ${esc(cur.end)}. Belopp i kronor.</p>
<h2>Resultaträkning</h2>
<table><tbody>${head}${pl}${row('Rörelseresultat', k.operating, kp?.operating ?? null, { bold: true })}${fin}
${row('Årets resultat', k.afterFinancial, kp?.afterFinancial ?? null, { bold: true })}</tbody></table>
<p><small>Bolaget är inte självständigt skattesubjekt – resultatet beskattas hos delägarna.</small></p>
<h2>Balansräkning</h2>
<table><tbody>${head}
${bal('Anläggningstillgångar', [[1000, 1399]])}${bal('Varulager', [[1400, 1499]])}${bal('Kortfristiga fordringar', [[1500, 1899]])}${bal('Kassa och bank', [[1900, 1999]])}
${row('Summa tillgångar', k.totalAssets, kp?.totalAssets ?? null, { bold: true })}
${bal('Eget kapital (delägarnas kapitalkonton)', [[2000, 2099]], true)}${bal('Obeskattade reserver', [[2100, 2199]], true)}${bal('Avsättningar', [[2200, 2299]], true)}
${bal('Långfristiga skulder', [[2300, 2399]], true)}${bal('Kortfristiga skulder', [[2400, 2999]], true)}
${row('Summa eget kapital och skulder', k.totalAssets, kp?.totalAssets ?? null, { bold: true })}</tbody></table>
<h2>Delägarnas kapitalkonton</h2>
<table><thead><tr><th>Delägare</th><th style="text-align:right">Andel</th><th style="text-align:right">Ingående</th><th style="text-align:right">Insättningar</th><th style="text-align:right">Uttag</th><th style="text-align:right">Andel av resultatet</th><th style="text-align:right">Utgående</th></tr></thead><tbody>
${o.partners.map((p) => `<tr><td>${esc(p.name)}${p.limited ? ' (kommanditdelägare)' : ''}</td><td style="text-align:right">${p.sharePct.toLocaleString('sv-SE')} %</td><td style="text-align:right">${kr(p.opening)}</td><td style="text-align:right">${kr(p.contributions)}</td><td style="text-align:right">${kr(-p.withdrawals)}</td><td style="text-align:right">${kr(p.result)}</td><td style="text-align:right">${kr(p.closing)}</td></tr>`).join('')}
</tbody></table>
<h2>Underskrifter</h2>
<p>${esc(o.company.city)} den ______________</p>
${o.partners.filter((p) => !p.limited).map((p) => `<p><br>______________________________<br>${esc(p.name)}</p>`).join('')}`.trim();
}
