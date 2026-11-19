// Årsredovisning (K2) som Inline XBRL (iXBRL) för digital inlämning till Bolagsverket.
// Siffrorna märks med begrepp ur Bolagsverkets svenska taxonomi (se-gen-base/se-cd-base).
// Filen bör kontrolleras i Bolagsverkets testtjänst innan den lämnas in.
import { keyFigures, sum, type AnnualReportInput, type Range, type YearFigures } from './annualreport';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NS = {
  'se-gen-base': 'http://www.taxonomier.se/se/fr/gen-base/2021-10-31',
  'se-cd-base': 'http://www.taxonomier.se/se/fr/cd-base/2021-10-31',
};
/** Ingångspunkt för K2-taxonomin (aktiebolag, resultaträkning med kostnadsslagsindelning) */
export const K2_SCHEMA = 'http://xbrl.taxonomier.se/se/fr/gaap/k2/2021-10-31/se-k2-ab-ri-2021-10-31.xsd';

interface Fact { concept: string; label: string; value: number; ctx: 'period' | 'balans'; costLike?: boolean; bold?: boolean }

const kr = (ore: number) => Math.round(ore / 100);
const fmt = (n: number) => Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Rader i resultat- och balansräkningen med begrepp, för innevarande och föregående år */
export function ixbrlFacts(y: YearFigures): Fact[] {
  const k = keyFigures(y);
  const cost = (r: Range[]) => sum(y.result, r); // kostnader har debetsaldo (positivt)
  const inc = (r: Range[]) => -sum(y.result, r);
  const bal = (r: Range[], liab = false) => (liab ? -1 : 1) * sum(y.closing, r);
  const shareCap = -sum(y.closing, [[2080, 2089]]);
  const retained = -sum(y.closing, [[2000, 2079], [2090, 2099]]) - k.result;
  const f = (concept: string, label: string, ore: number, ctx: Fact['ctx'], o: Partial<Fact> = {}): Fact => ({ concept, label, value: kr(ore), ctx, ...o });
  return [
    f('Nettoomsattning', 'Nettoomsättning', inc([[3000, 3799]]), 'period'),
    f('OvrigaRorelseintakter', 'Övriga rörelseintäkter', inc([[3800, 3999]]), 'period'),
    f('RavarorFornodenheterKostnader', 'Råvaror, förnödenheter och handelsvaror', cost([[4000, 4999]]), 'period', { costLike: true }),
    f('OvrigaExternaKostnader', 'Övriga externa kostnader', cost([[5000, 6999]]), 'period', { costLike: true }),
    f('Personalkostnader', 'Personalkostnader', cost([[7000, 7699]]), 'period', { costLike: true }),
    f('AvskrivningarNedskrivningarMateriellaImmateriellaAnlaggningstillgangar', 'Av- och nedskrivningar av anläggningstillgångar', cost([[7700, 7899]]), 'period', { costLike: true }),
    f('OvrigaRorelsekostnader', 'Övriga rörelsekostnader', cost([[7900, 7999]]), 'period', { costLike: true }),
    f('Rorelseresultat', 'Rörelseresultat', k.operating, 'period', { bold: true }),
    f('OvrigaRanteintakterLiknandeResultatposter', 'Övriga ränteintäkter och liknande resultatposter', inc([[8000, 8399]]), 'period'),
    f('RantekostnaderLiknandeResultatposter', 'Räntekostnader och liknande resultatposter', cost([[8400, 8499]]), 'period', { costLike: true }),
    f('ResultatEfterFinansiellaPoster', 'Resultat efter finansiella poster', k.afterFinancial, 'period', { bold: true }),
    f('Bokslutsdispositioner', 'Bokslutsdispositioner', k.beforeTax - k.afterFinancial, 'period'),
    f('ResultatForeSkatt', 'Resultat före skatt', k.beforeTax, 'period', { bold: true }),
    f('SkattAretsResultat', 'Skatt på årets resultat', k.tax, 'period', { costLike: true }),
    f('AretsResultat', 'Årets resultat', k.result, 'period', { bold: true }),
    f('ImmateriellaAnlaggningstillgangar', 'Immateriella anläggningstillgångar', bal([[1000, 1099]]), 'balans'),
    f('ByggnaderMark', 'Byggnader och mark', bal([[1100, 1199]]), 'balans'),
    f('MaskinerAndraTekniskaAnlaggningar', 'Maskiner och inventarier', bal([[1200, 1299]]), 'balans'),
    f('FinansiellaAnlaggningstillgangar', 'Finansiella anläggningstillgångar', bal([[1300, 1399]]), 'balans'),
    f('VarulagerMm', 'Varulager', bal([[1400, 1499]]), 'balans'),
    f('Kundfordringar', 'Kundfordringar', bal([[1500, 1599]]), 'balans'),
    f('OvrigaFordringar', 'Övriga fordringar', bal([[1600, 1699]]), 'balans'),
    f('ForutbetaldaKostnaderUpplupnaIntakter', 'Förutbetalda kostnader och upplupna intäkter', bal([[1700, 1799]]), 'balans'),
    f('KortfristigaPlaceringar', 'Kortfristiga placeringar', bal([[1800, 1899]]), 'balans'),
    f('KassaBank', 'Kassa och bank', bal([[1900, 1999]]), 'balans'),
    f('Tillgangar', 'Summa tillgångar', k.totalAssets, 'balans', { bold: true }),
    f('Aktiekapital', 'Aktiekapital', shareCap, 'balans'),
    f('BalanseratResultat', 'Balanserat resultat', retained, 'balans'),
    f('AretsResultatEgetKapital', 'Årets resultat', k.result, 'balans'),
    f('EgetKapital', 'Summa eget kapital', shareCap + retained + k.result, 'balans', { bold: true }),
    f('ObeskattadeReserver', 'Obeskattade reserver', bal([[2100, 2199]], true), 'balans'),
    f('Avsattningar', 'Avsättningar', bal([[2200, 2299]], true), 'balans'),
    f('LangfristigaSkulder', 'Långfristiga skulder', bal([[2300, 2399]], true), 'balans'),
    f('Leverantorsskulder', 'Leverantörsskulder', bal([[2440, 2449]], true), 'balans'),
    f('Skatteskulder', 'Skatteskulder', bal([[2500, 2599]], true), 'balans'),
    f('OvrigaKortfristigaSkulder', 'Övriga kortfristiga skulder', bal([[2400, 2439], [2450, 2499], [2600, 2899]], true), 'balans'),
    f('UpplupnaKostnaderForutbetaldaIntakter', 'Upplupna kostnader och förutbetalda intäkter', bal([[2900, 2999]], true), 'balans'),
    f('EgetKapitalSkulder', 'Summa eget kapital och skulder', k.totalAssets, 'balans', { bold: true }),
  ];
}

function cell(fact: Fact, idx: number) {
  const ctx = `${fact.ctx}${idx}`;
  // Kostnader redovisas med minustecken utanför märkningen; negativa värden får sign="-"
  const neg = fact.value < 0;
  const tag = `<ix:nonFraction name="se-gen-base:${fact.concept}" contextRef="${ctx}" unitRef="SEK" decimals="0" scale="0" format="ixt:num-dot-decimal"${neg ? ' sign="-"' : ''}>${fmt(fact.value)}</ix:nonFraction>`;
  const minus = (fact.costLike && fact.value > 0) || neg ? '−' : '';
  return `<td class="n">${minus}${tag}</td>`;
}

export function annualReportIxbrl(i: AnnualReportInput): string {
  const [cur, prev] = i.years;
  const years = prev ? [cur, prev] : [cur];
  const facts = years.map(ixbrlFacts);
  const id = esc(i.company.orgnr);
  const contexts = years.map((y, n) => `
      <xbrli:context id="period${n}"><xbrli:entity><xbrli:identifier scheme="http://www.bolagsverket.se">${id}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>${esc(y.start)}</xbrli:startDate><xbrli:endDate>${esc(y.end)}</xbrli:endDate></xbrli:period></xbrli:context>
      <xbrli:context id="balans${n}"><xbrli:entity><xbrli:identifier scheme="http://www.bolagsverket.se">${id}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${esc(y.end)}</xbrli:instant></xbrli:period></xbrli:context>`).join('');
  const table = (ctx: Fact['ctx'], title: string) => {
    const rows = facts[0].map((f, r) => ({ f, r })).filter(({ f, r }) => f.ctx === ctx && (f.bold || f.value !== 0 || (facts[1]?.[r].value ?? 0) !== 0));
    return `<h2>${title}</h2>
    <table><thead><tr><th>Belopp i kronor</th>${years.map((y) => `<th class="n">${esc(y.start.slice(0, 4) === y.end.slice(0, 4) ? y.end.slice(0, 4) : `${y.start.slice(0, 7)} – ${y.end.slice(0, 7)}`)}</th>`).join('')}</tr></thead><tbody>
${rows.map(({ f, r }) => `      <tr${f.bold ? ' class="b"' : ''}><td>${esc(f.label)}</td>${facts.map((fs, n) => cell(fs[r], n)).join('')}</tr>`).join('\n')}
    </tbody></table>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2020-02-12"
  xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:se-gen-base="${NS['se-gen-base']}" xmlns:se-cd-base="${NS['se-cd-base']}" xml:lang="sv">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <title>Årsredovisning ${esc(i.company.name)} ${esc(cur.start)} – ${esc(cur.end)}</title>
  <style>body{font-family:Arial,Helvetica,sans-serif;max-width:800px;margin:2rem auto;color:#111}table{border-collapse:collapse;width:100%;margin-bottom:1.5rem}td,th{padding:.25rem .4rem;border-bottom:1px solid #ddd;text-align:left}.n{text-align:right;white-space:nowrap}tr.b td{font-weight:bold}</style>
</head>
<body>
  <div style="display:none">
    <ix:header>
      <ix:references><link:schemaRef xlink:type="simple" xlink:href="${K2_SCHEMA}" /></ix:references>
      <ix:resources>${contexts}
        <xbrli:unit id="SEK"><xbrli:measure>iso4217:SEK</xbrli:measure></xbrli:unit>
        <xbrli:unit id="antal-anstallda"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>
      </ix:resources>
    </ix:header>
  </div>
  <h1>Årsredovisning</h1>
  <p>för<br /><b><ix:nonNumeric name="se-cd-base:ForetagetsNamn" contextRef="period0">${esc(i.company.name)}</ix:nonNumeric></b><br />
  <ix:nonNumeric name="se-cd-base:Organisationsnummer" contextRef="period0">${id}</ix:nonNumeric></p>
  <p>Räkenskapsåret <ix:nonNumeric name="se-cd-base:RakenskapsarForstaDag" contextRef="period0">${esc(cur.start)}</ix:nonNumeric> – <ix:nonNumeric name="se-cd-base:RakenskapsarSistaDag" contextRef="period0">${esc(cur.end)}</ix:nonNumeric></p>
  <h2>Förvaltningsberättelse</h2>
  <p><ix:nonNumeric name="se-gen-base:AllmantVerksamheten" contextRef="period0">${esc(i.activity || `Bolaget bedriver verksamhet med säte i ${i.company.city}.`)}</ix:nonNumeric></p>
  ${table('period', 'Resultaträkning')}
  ${table('balans', 'Balansräkning')}
  <h2>Noter</h2>
  <p>Årsredovisningen har upprättats i enlighet med årsredovisningslagen och BFNAR 2016:10 om årsredovisning i mindre företag (K2).</p>
  <p>Medelantalet anställda: <ix:nonFraction name="se-gen-base:MedelantaletAnstallda" contextRef="period0" unitRef="antal-anstallda" decimals="0" scale="0" format="ixt:num-dot-decimal">${Math.max(0, Math.round(i.employees))}</ix:nonFraction></p>
</body>
</html>
`;
}
