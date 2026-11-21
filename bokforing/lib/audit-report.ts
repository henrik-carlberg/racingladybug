// Revisionsberättelse (ren logik): text enligt standardutformningen, och förslag på anmärkningar.
export type Opinion = 'clean' | 'qualified' | 'adverse' | 'disclaimer';
export const OPINIONS: Record<Opinion, string> = {
  clean: 'Utan modifiering (ren revisionsberättelse)',
  qualified: 'Med reservation',
  adverse: 'Med avvikande mening',
  disclaimer: 'Utan uttalande',
};

/** Förslag på anmärkningar enligt aktiebolagslagen 9 kap. 33 § utifrån bolagets uppgifter */
export function suggestedRemarks(o: { forbiddenLoans: number; deficit: boolean; taxDeficit: number }) {
  const r: string[] = [];
  if (o.forbiddenLoans) r.push(`Bolaget har lämnat lån som strider mot låneförbudet i 21 kap. aktiebolagslagen (${(o.forbiddenLoans / 100).toLocaleString('sv-SE')} kr).`);
  if (o.deficit) r.push('Det finns skäl att anta att bolagets eget kapital understiger hälften av aktiekapitalet. Styrelsen har en skyldighet att upprätta kontrollbalansräkning (25 kap. 13 § ABL).');
  if (o.taxDeficit) r.push(`Skatter och avgifter har inte betalats i rätt tid; skattekontot visar ett underskott på ${(o.taxDeficit / 100).toLocaleString('sv-SE')} kr.`);
  return r;
}

export interface ReportInput {
  company: string; orgnr: string; start: string; end: string; opinion: Opinion; basis: string; remarks: string[];
  adopt: boolean; discharge: boolean; auditor: string; place: string; date: string;
}

/** Revisionsberättelsens stycken */
export function reportText(o: ReportInput): { heading: string; paragraphs: string[] }[] {
  const year = `räkenskapsåret ${o.start} – ${o.end}`;
  const op: Record<Opinion, string> = {
    clean: `Enligt min uppfattning har årsredovisningen upprättats i enlighet med årsredovisningslagen och ger en i alla väsentliga avseenden rättvisande bild av bolagets finansiella ställning per den ${o.end} och av dess finansiella resultat för året.`,
    qualified: `Enligt min uppfattning, med undantag för effekterna av det förhållande som beskrivs i avsnittet Grund för uttalanden med reservation, har årsredovisningen upprättats i enlighet med årsredovisningslagen och ger en i alla väsentliga avseenden rättvisande bild av bolagets finansiella ställning per den ${o.end}.`,
    adverse: `Enligt min uppfattning, på grund av betydelsen av det förhållande som beskrivs i avsnittet Grund för uttalanden med avvikande mening, har årsredovisningen inte upprättats i enlighet med årsredovisningslagen och ger inte en rättvisande bild av bolagets finansiella ställning per den ${o.end}.`,
    disclaimer: 'Jag uttalar mig inte om årsredovisningen. På grund av betydelsen av det förhållande som beskrivs i avsnittet Grund för att avstå från uttalanden har jag inte kunnat inhämta tillräckliga och ändamålsenliga revisionsbevis som grund för ett uttalande.',
  };
  const sections = [
    { heading: 'Rapport om årsredovisningen – Uttalanden', paragraphs: [`Jag har utfört en revision av årsredovisningen för ${o.company}, org.nr ${o.orgnr}, för ${year}.`, op[o.opinion]] },
    { heading: o.opinion === 'clean' ? 'Grund för uttalanden' : 'Grund för modifierade uttalanden', paragraphs: [
      ...(o.opinion !== 'clean' && o.basis ? [o.basis] : []),
      'Jag har utfört revisionen enligt International Standards on Auditing (ISA) och god revisionssed i Sverige. Jag är oberoende i förhållande till bolaget enligt god revisorssed i Sverige.',
    ] },
    { heading: 'Rapport om andra krav enligt lagar och andra författningar – Uttalanden', paragraphs: [
      `Utöver min revision av årsredovisningen har jag även utfört en revision av styrelsens och verkställande direktörens förvaltning av ${o.company} för ${year} samt av förslaget till dispositioner beträffande bolagets vinst eller förlust.`,
      o.adopt ? 'Jag tillstyrker att årsstämman fastställer resultaträkningen och balansräkningen och disponerar vinsten enligt förslaget i förvaltningsberättelsen.' : 'Jag avstyrker att årsstämman fastställer resultaträkningen och balansräkningen.',
      o.discharge ? 'Jag tillstyrker att styrelsens ledamöter och verkställande direktören beviljas ansvarsfrihet för räkenskapsåret.' : 'Jag avstyrker att styrelsens ledamöter och verkställande direktören beviljas ansvarsfrihet för räkenskapsåret.',
    ] },
    ...(o.remarks.length ? [{ heading: 'Anmärkningar', paragraphs: o.remarks }] : []),
    { heading: '', paragraphs: [`${o.place} den ${o.date}`, o.auditor] },
  ];
  return sections;
}
