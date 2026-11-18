// Hjälpcentret: korta artiklar på svenska. Texten är vanlig text med stycken (tom rad) och punktlistor (rader som börjar med "- ").

export interface HelpArticle { slug: string; title: string; group: string; body: string }

export const HELP: HelpArticle[] = [
  { slug: 'kom-igang', group: 'Kom igång', title: 'Kom igång på tio minuter', body: `Skapa ett konto och lägg upp ditt bolag med organisationsnummer, räkenskapsår och hur ofta du redovisar moms. Under Kom igång finns en checklista som guidar dig.

- Fyll i bolagets uppgifter under Inställningar (adress, bankgiro, momsregistreringsnummer, F-skatt).
- Registrera ingående balanser från förra årets balansräkning, eller importera en SIE-fil från ditt gamla program.
- Koppla banken under Bank, eller importera ett kontoutdrag.
- Bjud in din redovisningskonsult eller ge din redovisningsbyrå åtkomst med byråns kod.

Vill du prova först? Skapa ett demobolag från startsidan – det innehåller exempeldata och kostar ingenting.` },
  { slug: 'kvitton', group: 'Vardag', title: 'Bokföra kvitton och utlägg', body: `Fota kvittot under Nytt kvitto, välj vad det gäller och bokför. Kvittot sparas som underlag till verifikationen.

- Betalt med företagskortet: välj bankkontot som betalkonto.
- Betalt privat: välj Utlägg, så skuldförs beloppet till dig och betalas tillbaka via lönen eller banken.
- Moms: välj momssats. Restaurang och hotell har ofta 12 % och livsmedel 12 %.` },
  { slug: 'fakturera', group: 'Vardag', title: 'Fakturera kunder', body: `Skapa en faktura under Kundfakturor. När du bokför den får den nummer och OCR och kan skickas med e-post eller som länk. Kunden kan betala med kort om du har kopplat Stripe.

- Betalningar matchas automatiskt i bankavstämningen med OCR-numret.
- Förfallna fakturor syns i att göra-listan, och med modulen Kundreskontra skapas påminnelser.
- ROT och RUT: välj skattereduktion på fakturan och markera raderna med arbetskostnad.` },
  { slug: 'leverantorsfakturor', group: 'Vardag', title: 'Leverantörsfakturor och betalningar', body: `Låt leverantörerna skicka fakturor till bolagets inkorgsadress, eller ladda upp dem. Fakturorna läses av automatiskt och du granskar innan något bokförs.

- Attestera fakturan och betala via betalfilen till banken (ISO 20022) eller markera som betald.
- Betalningen matchas mot banktransaktionen i avstämningen.` },
  { slug: 'banken', group: 'Vardag', title: 'Bankavstämning och konteringsregler', body: `Under Bankavstämning stämmer du av varje transaktion: mot en kundfaktura, en leverantörsfaktura, en befintlig verifikation eller ett konto.

- Konteringsregler: "telia" → 6212 med 25 % moms. Lägg till vanliga regler med en knapp.
- Appen lär sig: har samma motpart bokförts likadant två gånger föreslås kontot nästa gång.
- Regler kan vara automatiska och bokförs då direkt när banken hämtas.` },
  { slug: 'moms', group: 'Skatter och deklarationer', title: 'Momsdeklarationen', body: `Under Rapporter → Moms räknas rutorna i momsdeklarationen fram per period. Fyll i dem i Skatteverkets e-tjänst Momsdeklaration och bokför sedan momsavräkningen med en knapp.

Deadlines för moms, arbetsgivardeklaration och bokslut syns under Deadlines och i att göra-listan.` },
  { slug: 'lon', group: 'Skatter och deklarationer', title: 'Lön och arbetsgivardeklaration', body: `Lägg upp anställda och hämta årets skattetabeller. En lönekörning räknar skatt och arbetsgivaravgifter och bokförs automatiskt.

- Frånvaro: sjukdom, semester och VAB räknas in med en knapp i lönekörningen.
- AGI: ladda ner filen och lämna den i Skatteverkets e-tjänst Arbetsgivardeklaration.
- De anställda ser sina lönespecifikationer på Min sida.` },
  { slug: 'bokslut', group: 'Skatter och deklarationer', title: 'Bokslut och årsredovisning', body: `Bokslutsguiden under Bokslut & deklaration tar dig igenom stegen inför bokslutet och tar fram underlag för INK2 eller NE och årsredovisningen (K2). Avskrivningar bokförs från Anläggningsregistret.

Granska alltid underlagen innan du lämnar in dem, och ta hjälp av din redovisningskonsult om du är osäker.` },
  { slug: 'byra', group: 'För redovisningsbyråer', title: 'Byråvyn', body: `Skapa en byrå under För byråer på startsidan. Ge klienten byråns kod – klienten anger den under Inställningar → Redovisningsbyrå.

- Översikten visar alla klienter med att göra, obokade banktransaktioner, inkorg, frågor och nästa deadline.
- Fråga kunden om en transaktion direkt från bankavstämningen.` },
  { slug: 'sakerhet', group: 'Konto och säkerhet', title: 'Säkerhet och dataskydd', body: `Logga in med passkey eller slå på tvåstegsverifiering under Mitt konto. All trafik är krypterad och varje ändring loggas i behandlingshistoriken.

- Bolagets ägare godkänner personuppgiftsbiträdesavtalet under Inställningar → Dataskydd.
- Exportera hela bokföringen som SIE eller all data som JSON under Rapporter → Export.
- Bokföringen sparas i sju år enligt bokföringslagen.` },
];

export const helpGroups = () => [...new Set(HELP.map((a) => a.group))];
