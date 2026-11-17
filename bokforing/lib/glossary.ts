// Förklaringar av begrepp på vanlig svenska (visas via <Help term="..."/>)
export const GLOSSARY: Record<string, { title: string; text: string }> = {
  verifikation: { title: 'Verifikation', text: 'En bokförd händelse, t.ex. ett kvitto eller en faktura, med datum, belopp och konton. Varje verifikation får ett löpnummer och kan inte ändras i efterhand – fel rättas med en rättelseverifikation.' },
  debet_kredit: { title: 'Debet och kredit', text: 'Varje händelse bokförs på minst två konton. Debet (vänster) ökar tillgångar och kostnader; kredit (höger) ökar skulder, eget kapital och intäkter. Summan av debet och kredit är alltid lika.' },
  moms: { title: 'Moms', text: 'Utgående moms tar du ut av kunder, ingående moms betalar du till leverantörer. Skillnaden betalar du till (eller får tillbaka från) Skatteverket i momsdeklarationen.' },
  momsavrakning: { title: 'Momsavräkning', text: 'När perioden är slut flyttas momsen från momskontona till konto 2650. Saldot där är det du ska betala eller få tillbaka.' },
  ingaende_balans: { title: 'Ingående balans', text: 'Saldona på bank, fordringar, skulder och eget kapital vid räkenskapsårets början – samma som förra årets utgående balans.' },
  kontantmetoden: { title: 'Kontantmetoden (bokslutsmetoden)', text: 'Kund- och leverantörsfakturor bokförs först när de betalas, och momsen redovisas då. Fakturor som är obetalda vid räkenskapsårets slut bokförs per bokslutsdagen. Får användas om omsättningen normalt är högst 3 miljoner kr per år.' },
  periodlas: { title: 'Periodlås', text: 'Spärrar bokföring i en avslutad period, t.ex. när momsen är deklarerad, så att inget ändras av misstag.' },
  agi: { title: 'Arbetsgivardeklaration (AGI)', text: 'Månatlig redovisning till Skatteverket av löner, avdragen skatt och arbetsgivaravgifter per anställd. Lämnas och betalas normalt senast den 12:e månaden efter löneutbetalningen.' },
  f_skatt: { title: 'F-skatt', text: 'Företaget betalar själv sin preliminära skatt varje månad till skattekontot. Står på fakturor som "Godkänd för F-skatt".' },
  ocr: { title: 'OCR-nummer', text: 'Referensnummer på fakturan som kunden anger vid betalning. Gör att inbetalningen kan matchas automatiskt mot rätt faktura.' },
  attest: { title: 'Attest', text: 'Godkännande av att en leverantörsfaktura är korrekt och får betalas. Loggas med namn och tid.' },
  representation: { title: 'Representation', text: 'Kostnader för att knyta eller behålla affärskontakter, t.ex. en lunch med en kund. Måltider är inte avdragsgilla i deklarationen, men momsen får dras av på högst 300 kr exkl. moms per person.' },
  egna_uttag: { title: 'Egna uttag (enskild firma)', text: 'Pengar du tar ut från firman till dig själv. Det är inte en kostnad – du beskattas för firmans vinst i din egen deklaration (NE-bilagan).' },
  arets_resultat: { title: 'Årets resultat', text: 'Intäkter minus kostnader för räkenskapsåret. I ett aktiebolag beskattas det med bolagsskatt; i en enskild firma i ägarens inkomstdeklaration.' },
  bokslut: { title: 'Bokslut', text: 'Avslutning av räkenskapsåret: kontrollera saldon, gör avskrivningar och periodiseringar, beräkna skatt och bokför årets resultat. Aktiebolag upprättar även årsredovisning.' },
};
