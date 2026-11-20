// Bokslutspärm (ren logik): specifikation per balanskonto med avstämning mot huvudboken, avbockning och PDF. Belopp i öre.
import type { PdfLine } from './simple-pdf';

export const SECTIONS: { key: string; title: string; from: number; to: number }[] = [
  { key: 'anlaggning', title: 'Anläggningstillgångar', from: 1000, to: 1399 },
  { key: 'lager', title: 'Varulager och pågående arbeten', from: 1400, to: 1499 },
  { key: 'kundfordringar', title: 'Kundfordringar', from: 1500, to: 1599 },
  { key: 'ovriga_fordringar', title: 'Övriga fordringar', from: 1600, to: 1699 },
  { key: 'periodiseringar', title: 'Förutbetalda kostnader och upplupna intäkter', from: 1700, to: 1799 },
  { key: 'placeringar', title: 'Kortfristiga placeringar', from: 1800, to: 1899 },
  { key: 'kassa_bank', title: 'Kassa och bank', from: 1900, to: 1999 },
  { key: 'eget_kapital', title: 'Eget kapital', from: 2000, to: 2099 },
  { key: 'obeskattade', title: 'Obeskattade reserver och avsättningar', from: 2100, to: 2299 },
  { key: 'langfristiga', title: 'Långfristiga skulder', from: 2300, to: 2399 },
  { key: 'leverantorer', title: 'Leverantörsskulder och andra kortfristiga skulder', from: 2400, to: 2499 },
  { key: 'skatter', title: 'Skatter och avgifter', from: 2500, to: 2899 },
  { key: 'upplupna', title: 'Upplupna kostnader och förutbetalda intäkter', from: 2900, to: 2999 },
];

export interface Spec { amount: number; source: string }
export interface Item { amount: number | null; note: string; reference: string; done: boolean; signed_by: string | null; signed_at: string | null }
export type RowStatus = 'ok' | 'diff' | 'open';

/** En rad per balanskonto med saldo: saldo i huvudboken, specificerat belopp (automatiskt eller manuellt) och differens */
export function binderRows(balances: Map<number, number>, names: Map<number, string>, specs: Map<number, Spec>, items: Map<number, Item>) {
  const accounts = [...new Set([...balances.keys(), ...items.keys()])].filter((n) => n >= 1000 && n <= 2999 && ((balances.get(n) ?? 0) !== 0 || items.has(n))).sort((a, b) => a - b);
  return accounts.map((account) => {
    const ledger = balances.get(account) ?? 0;
    const item = items.get(account) ?? null;
    const spec = specs.get(account) ?? null;
    const specified = item?.amount ?? spec?.amount ?? null;
    const diff = specified == null ? null : ledger - specified;
    const status: RowStatus = diff == null ? 'open' : diff !== 0 ? 'diff' : item?.done ? 'ok' : 'open';
    return { account, name: names.get(account) ?? '', ledger, specified, source: item?.amount != null ? 'Manuell specifikation' : spec?.source ?? null, diff, status, item };
  });
}
export type BinderRow = ReturnType<typeof binderRows>[number];

export function sections(rows: BinderRow[]) {
  return SECTIONS.map((s) => {
    const r = rows.filter((x) => x.account >= s.from && x.account <= s.to);
    return { ...s, rows: r, total: r.reduce((a, x) => a + x.ledger, 0), done: r.length > 0 && r.every((x) => x.status === 'ok'), open: r.filter((x) => x.status !== 'ok').length };
  }).filter((s) => s.rows.length);
}

const kr = (o: number | null) => (o == null ? '–' : (o / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, ' '));
/** Pärmen som PDF: försättsblad, sammanställning per balanspost och en specifikation per konto */
export function binderPdf(o: { company: string; orgnr: string; start: string; end: string; created: string; secs: ReturnType<typeof sections>; result: number }): PdfLine[] {
  const L: PdfLine[] = [
    { text: 'Bokslutspärm', size: 22, bold: true, gap: 40 }, { text: o.company, size: 14, gap: 26 }, { text: `Org.nr ${o.orgnr}`, gap: 18 },
    { text: `Räkenskapsår ${o.start} – ${o.end}`, gap: 18 }, { text: `Upprättad ${o.created}`, gap: 18 }, { text: `Årets resultat ${kr(o.result)} kr`, gap: 18 },
    { text: 'Innehåll', size: 13, bold: true, gap: 34 },
  ];
  o.secs.forEach((s, i) => L.push({ text: `${i + 1}. ${s.title}${s.done ? ' (klar)' : ` (${s.open} att stämma av)`}`, gap: 15 }, { text: `${kr(s.total)} kr`, right: 545, gap: 0 }));
  o.secs.forEach((s, i) => {
    L.push({ text: `${i + 1}. ${s.title}`, size: 13, bold: true, gap: 34 });
    L.push({ text: 'Konto', bold: true, gap: 16 }, { text: 'Huvudbok', bold: true, right: 360, gap: 0 }, { text: 'Specificerat', bold: true, right: 450, gap: 0 }, { text: 'Differens', bold: true, right: 545, gap: 0 });
    for (const r of s.rows) {
      L.push({ text: `${r.account} ${r.name}`.slice(0, 44), gap: 15 }, { text: kr(r.ledger), right: 360, gap: 0 }, { text: kr(r.specified), right: 450, gap: 0 }, { text: r.diff == null ? 'ej specificerat' : kr(r.diff), right: 545, gap: 0 });
      const meta = [r.source, r.item?.reference && `Underlag: ${r.item.reference}`, r.item?.note, r.item?.signed_by && `Avstämt av ${r.item.signed_by} ${r.item.signed_at}`].filter(Boolean).join(' · ');
      if (meta) L.push({ text: meta.slice(0, 110), size: 8, x: 62, gap: 11 });
    }
    L.push({ text: `Summa ${s.title.toLowerCase()}`, bold: true, gap: 16 }, { text: kr(s.total), right: 360, bold: true, gap: 0 });
  });
  // Helvetica med WinAnsi saknar tankstreck – ersätt med bindestreck
  return L.map((l) => ({ ...l, text: l.text.replace(/[\u2013\u2014]/g, '-') }));
}
