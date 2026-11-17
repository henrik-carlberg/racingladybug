# Bokföring

En enkel webbapp för bokföring, fakturering, leverantörsbetalningar och lön, för ett eller flera bolag. Ägaren bjuder in en extern redovisningskonsult som sedan sköter det löpande arbetet.

Appen är byggd med Next.js och Postgres och är gjord för att köras på Vercel.

## Funktioner

| Område | Innehåll |
|---|---|
| **Användare och behörighet** | Flera bolag per användare. Rollerna är *Ägare* och *Redovisningskonsult*. Konsulten kan göra allt utom att hantera användare och låsa upp perioder eller räkenskapsår. Inbjudan sker via länk. Bara det allra första kontot kan registreras fritt. |
| **Bokföring** | Dubbel bokföring med BAS-kontoplan. Verifikationsserierna är A (manuell), B (kundfakturor), C (leverantörsfakturor) och L (lön), med löpnummer utan luckor. Verifikationer kan inte ändras eller raderas, utan rättas med en rättelseverifikation (BFL 5 kap). Det går att ladda upp underlag (PDF/bild). Appen har periodlås, räkenskapsår och behandlingshistorik. |
| **Kundfakturor** | Kunder, fakturautkast, bokföring med fakturanummer och OCR (med längd- och kontrollsiffra), öresavrundning, momssatserna 25/12/6/0 % och omvänd skattskyldighet för EU-tjänster. Fakturan kan skrivas ut eller sparas som PDF. Inbetalningar och krediteringar bokförs automatiskt. |
| **Leverantörsfakturor** | Leverantörer, registrering med kontering (faktureringsmetoden), attest som loggas med namn, betalningsförslag med CSV-export och automatisk bokföring av betalningen. |
| **Lön** | Anställda, skattetabeller som hämtas direkt från Skatteverkets öppna data, lönekörningar med lönearter (lön/tillägg/avdrag, förmåner, nettolöneavdrag och skattefria utlägg), arbetsgivaravgifter enligt 2026 års regler (inklusive nedsättningen för 19–23-åringar och 66+), lönespecifikationer och automatisk bokföring. |
| **AGI** | Arbetsgivardeklaration på individnivå som XML-fil, för uppladdning i Skatteverkets e-tjänst. Filen valideras i testerna mot Skatteverkets officiella XSD (version 1.1). |
| **Rapporter** | Resultat- och balansräkning, huvudbok, momsrapport med rutorna i momsdeklarationen och automatisk momsavräkning mot 2650, samt SIE 4-export (PC8/CP437). |

## Kom igång lokalt

```bash
cd bokforing
npm install
cp .env.example .env.local      # ange DATABASE_URL till en lokal Postgres
npm run db:migrate
npm run dev                     # http://localhost:3000
```

Gå till `/register` och skapa ägarkontot. Lägg därefter upp bolaget.

## Driftsätta på Vercel

1. Skapa ett nytt projekt i Vercel från detta repo och sätt **Root Directory** till `bokforing`.
2. Lägg till en Postgres-databas via *Storage → Marketplace → Neon*. Då sätts `DATABASE_URL` och `DATABASE_URL_UNPOOLED` automatiskt.
3. Deploya. Skriptet `vercel-build` kör databasmigreringarna innan bygget.
4. Öppna sajten, gå till `/register` och skapa ägarkontot direkt, eftersom bara det första kontot kan registreras fritt.
5. Bjud in redovisningskonsulten under **Inställningar → Användare**. Kopiera länken och skicka den till konsulten. Länken gäller i 7 dagar.

## Tester

```bash
npm test             # enhetstester: moms, fakturor, lön, arbetsgivaravgifter, AGI mot XSD (kräver xmllint), SIE
npm run typecheck
# End-to-end (kräver Playwright och en tom databas):
npm run build && npm start &
BASE_URL=http://localhost:3000 npm run test:e2e
```

E2E-testet går igenom hela flödet: registrering, bolag, kundfaktura med inbetalning, leverantörsfaktura med attest och betalning, hämtning av skattetabell från Skatteverket, lönekörning, AGI-fil (validerad mot XSD), momsavräkning, rättelse, rapporter, SIE och inbjudan av konsult med behörighetskontroll.

## Viktigt att veta

- **Kontrollera mot Skatteverket.** Arbetsgivaravgifterna (`lib/payroll.ts`) och momsrutorna (`lib/vat.ts`) följer reglerna för 2026. Se över dem inför varje nytt år. Prova AGI-filen i Skatteverkets testtjänst innan första skarpa inlämningen.
- **AGI-summor.** Arbetsgivaravgiften räknas per anställd på öre. Skatteverket räknar på hela kronor, så kontrollsumman (ruta 487) kan skilja några kronor. Det är Skatteverkets beräkning som gäller.
- **Faktureringsmetoden.** Kund- och leverantörsfakturor bokförs när de registreras. Kontantmetoden stöds inte.
- **Ännu inte stöd för:** delbetalningar, inläsning av bankfil (Bankgirots LB/ISO 20022), utskick av fakturor via e-post, semesterlöneskuld, sjuklön med karensavdrag, årsbokslut och årsredovisning, SIE-import samt valutor.
- **Underlag** sparas i databasen, med högst 8 MB per fil. Bokföringslagen kräver att räkenskapsinformation sparas i 7 år. Se till att databasen säkerhetskopieras (Neon har point-in-time restore).

## Struktur

```
lib/            Ren domänlogik (testbar): money, bas, vat, invoice, supplier, payroll, agi, sie, validate
lib/server/     Databas, inloggning, bokföringsmotor (verifikationer, periodlås), skattetabeller
app/            Sidor och server actions (Next.js App Router)
db/migrations/  SQL-schema
tests/          Enhetstester, E2E-test och Skatteverkets XSD för AGI
```
