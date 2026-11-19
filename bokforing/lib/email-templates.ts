// E-postmallar för faktura, påminnelse och tack för betalningen (ren logik)

export type TemplateKind = 'invoice' | 'reminder' | 'thanks';
export interface Template { subject: string; body: string }

export const TEMPLATE_LABEL: Record<TemplateKind, string> = { invoice: 'Faktura', reminder: 'Påminnelse', thanks: 'Tack för betalningen' };
export const PLACEHOLDERS: Record<string, string> = {
  kund: 'Kundens namn', företag: 'Ditt företags namn', fakturanummer: 'Fakturanummer', belopp: 'Fakturans belopp', förfallodatum: 'Förfallodatum',
  ocr: 'OCR-nummer', bankgiro: 'Ditt bankgiro', länk: 'Länk till fakturan', meddelande: 'Meddelande du skriver när du skickar', att_betala: 'Att betala (påminnelse, inkl. avgift och ränta)',
};

export const DEFAULT_TEMPLATES: Record<TemplateKind, Template> = {
  invoice: {
    subject: 'Faktura {fakturanummer} från {företag}',
    body: 'Hej {kund},\n\n{meddelande}\n\nFaktura {fakturanummer}: {belopp}\nFörfallodatum: {förfallodatum}\nBetala till bankgiro {bankgiro} med OCR {ocr}.\n\nVisa, skriv ut eller spara fakturan som PDF: {länk}\n\nMed vänliga hälsningar\n{företag}',
  },
  reminder: {
    subject: 'Påminnelse: faktura {fakturanummer} från {företag}',
    body: 'Hej {kund},\n\nVi har inte fått betalt för faktura {fakturanummer} som förföll {förfallodatum}. Har du redan betalat kan du bortse från påminnelsen.\n\nAtt betala: {att_betala}\nBankgiro {bankgiro}, OCR {ocr}.\n\nMed vänliga hälsningar\n{företag}',
  },
  thanks: {
    subject: 'Tack för betalningen – faktura {fakturanummer}',
    body: 'Hej {kund},\n\nTack! Vi har fått din betalning för faktura {fakturanummer} ({belopp}).\n\nMed vänliga hälsningar\n{företag}',
  },
};

/** Ersätter {fält} med värden. Okända fält lämnas som de är; rader som bara innehöll tomma fält tas bort. */
export function renderTemplate(t: Template, vars: Record<string, string>): Template {
  const r = (s: string) => s.replace(/\{([a-zåäö_]+)\}/gi, (m, k: string) => (k.toLowerCase() in vars ? vars[k.toLowerCase()] : m));
  const body = r(t.body).split('\n').filter((line, i, a) => !(line.trim() === '' && (a[i - 1] ?? '').trim() === '')).join('\n').trim();
  return { subject: r(t.subject).replace(/\s+/g, ' ').trim(), body };
}

export function unknownPlaceholders(t: Template): string[] {
  return [...new Set([...`${t.subject} ${t.body}`.matchAll(/\{([^}]+)\}/g)].map((m) => m[1].toLowerCase()).filter((k) => !(k in PLACEHOLDERS)))];
}
