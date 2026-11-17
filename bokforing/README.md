# Bokföring

En enkel webbapp för bokföring, fakturering, leverantörsbetalningar och lön, för ett eller flera bolag. Ägaren bjuder in en extern redovisningskonsult som sedan sköter det löpande arbetet.

Appen är byggd med Next.js och Postgres och är gjord för att köras på Vercel.

## Funktioner

| Område | Innehåll |
|---|---|
| **Användare och behörighet** | Flera bolag per användare. Rollerna är *Ägare* och *Redovisningskonsult*. Konsulten kan göra allt utom att hantera användare och låsa upp perioder eller räkenskapsår. Inbjudan sker via länk. Bara det allra första kontot kan registreras fritt. |
| **Inloggning med passkey** | Logga in med Face ID, Touch ID, Windows Hello eller en säkerhetsnyckel (WebAuthn), via knappen eller direkt via autofyll i e-postfältet. Passkeys hanteras under **Mitt konto**, där man också kan byta lösenord. |
| **Bokföring** | Dubbel bokföring med BAS-kontoplan. Verifikationsserierna är A (manuell), B (kundfakturor), C (leverantörsfakturor) och L (lön), med löpnummer utan luckor. Verifikationer kan inte ändras eller raderas, utan rättas med en rättelseverifikation (BFL 5 kap). Det går att ladda upp underlag (PDF/bild). Appen har periodlås, räkenskapsår och behandlingshistorik. |
| **Kundfakturor** | Kunder, fakturautkast, bokföring med fakturanummer och OCR (med längd- och kontrollsiffra), öresavrundning, momssatserna 25/12/6/0 % och omvänd skattskyldighet för EU-tjänster. Fakturan kan skrivas ut eller sparas som PDF. Inbetalningar och krediteringar bokförs automatiskt. |
| **Leverantörsfakturor** | Leverantörer, registrering med kontering (faktureringsmetoden), attest som loggas med namn, betalningsförslag med CSV-export och automatisk bokföring av betalningen. |
| **Lön** | Anställda, skattetabeller som hämtas direkt från Skatteverkets öppna data, lönekörningar med lönearter (lön/tillägg/avdrag, förmåner, nettolöneavdrag och skattefria utlägg), arbetsgivaravgifter enligt 2026 års regler (inklusive nedsättningen för 19–23-åringar och 66+), lönespecifikationer och automatisk bokföring. |
| **AGI** | Arbetsgivardeklaration på individnivå som XML-fil, för uppladdning i Skatteverkets e-tjänst. Filen valideras i testerna mot Skatteverkets officiella XSD (version 1.1). |
| **Rapporter** | Resultat- och balansräkning, huvudbok, momsrapport med rutorna i momsdeklarationen och automatisk momsavräkning mot 2650, samt SIE 4-export (PC8/CP437). |
| **Bank** | Bankkoppling via Open Banking (Enable Banking, BankID hos banken) eller import av kontoutdrag (camt.053/CSV). Appen hämtar saldon och transaktioner och stämmer av mot kundfakturor, leverantörsfakturor och verifikationer. Säkra matchningar via OCR kan stämmas av automatiskt. |
| **Dokument och e-signering** | Avtal (text eller PDF) skickas för signering. Interna användare signerar med passkey eller lösenord, externa via personlig länk. Signaturerna binds till dokumentets SHA-256, varje händelse loggas, och det färdiga dokumentet förseglas och får en verifieringsbilaga. |
| **REST-API** | `/api/v1` med API-nycklar per bolag och behörigheter (scopes), idempotens via `Idempotency-Key` och en OpenAPI 3.1-specifikation. Dokumentationen finns på `/api-docs`. |
| **Webhooks** | Signerade (HMAC-SHA256) och skickas om automatiskt vid fel. Appen har en leveranslogg, testhändelser och SSRF-skydd. Händelserna kan även hämtas via `GET /api/v1/events`. |
| **Moduler** | Ett pluggbart system för t.ex. CRM, ERP och lager. En modul kan ha egna sidor, menyval, API-endpoints, scopes, händelser, databastabeller och lyssnare. Två moduler följer med: **CRM** och **HR**. |
| **HR-modul** | Onboarding, förflyttning och offboarding med checklistor (ansvarig och förfallodag), avtalsmallar som e-signeras (anställningsavtal enligt LAS 6 c §, ändring av villkor, bekräftelse av upphörande) och automatisk överföring till lönen när processen slutförs. |
| **Räkenskapsår** | Valfritt startdatum och förlängt första år (högst 18 månader, enskild firma slutar 31 december). Öppna år kan rättas i efterhand om alla verifikationer ryms. Startmånad för debiterad preliminärskatt (t.ex. efter uppskov) styr deadlines. |
| **Tidrapportering och uppdrag** | Uppdrag per kund med aktiviteter och egna timpriser. Faktureringsformen är löpande räkning, timbank, fast pris eller internt. Tid rapporteras i en veckovy (t.ex. "1,5" eller "1:30"). Debiterbar tid blir ett fakturautkast med en rad per aktivitet och en tidsspecifikation. Fakturerad tid låses och frigörs om fakturan krediteras. |
| **Timbank** | Kunden köper timmar på en faktura. Varje månad skapas en avräkning, automatiskt som utkast den 1:a eller manuellt, som visar använda timmar, timmar kvar och tidsspecifikation. Timmar utöver banken faktureras med timpriset. En avräkning på 0 kr bokförs inte. API: `/projects`, `/time-entries` (scope `time:read`/`time:write`). |
| **Kom igång-guide** | Nya bolag får en checklista: bolagsuppgifter, ingående balanser (med mall per bolagsform och knapp för aktiekapital 25 000 kr), bank, bjud in konsult, passkey, lön och första kund. Översikten visar hur långt man kommit, nästa deadlines och de vanligaste uppgifterna. |
| **Kvitton och utlägg** | Fota kvittot med mobilen och välj vad det gäller bland 26 vanliga kategorier. Appen väljer konto och moms (inklusive reglerna för representation) och visar hur det bokförs innan man sparar. Privata utlägg bokförs mot skuld till ägaren (AB) eller eget kapital (EF). |
| **Deadlines** | Alla datum utifrån bolagsform, momsperiod, räkenskapsår och om bolaget har anställda eller F-skatt: moms, arbetsgivardeklaration, preliminärskatt, inkomstdeklaration, årsstämma och årsredovisning. Datumen flyttas enligt helgdagsreglerna. Varje deadline kan bockas av. |
| **Bokslut och deklaration** | Steg-för-steg-bokslut: avstämning, bokslutsposter, bolagsskatt (AB, 20,6 %), stäng året och för över resultatet. Appen tar fram INK2 med INK2R/INK2S (AB) eller NE-bilaga (EF), och SRU-filer som kan laddas upp i Skatteverkets filöverföring. |
| **Årsredovisning** | AB: utkast till årsredovisning enligt K2 med förvaltningsberättelse, flerårsöversikt, förändringar i eget kapital, resultatdisposition, noter och fastställelseintyg. Årsstämmoprotokollet kan skickas för e-signering. EF: förenklat årsbokslut. |
| **Hjälp** | Frågetecken vid svåra begrepp förklarar dem på enkel svenska. |

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
3. Lägg till miljövariablerna `CRON_SECRET` och `ENCRYPTION_KEY` (långa slumpsträngar), samt eventuellt Enable Banking och Resend (se Miljövariabler).
4. Deploya. Skriptet `vercel-build` kör databasmigreringarna, även modulernas, innan bygget.
5. Öppna sajten, gå till `/register` och skapa ägarkontot direkt, eftersom bara det första kontot kan registreras fritt.
6. Bjud in redovisningskonsulten under **Inställningar → Användare**. Kopiera länken och skicka den till konsulten. Länken gäller i 7 dagar.

## Passkeys

Varje användare lägger till passkeys under **Mitt konto** (`/konto`). Därefter kan man logga in på två sätt:

- via knappen **Logga in med passkey**, eller
- genom att välja passkeyn i webbläsarens autofyll i e-postfältet. Då behövs varken e-post eller lösenord.

Så här skyddas inloggningen:

- Användarverifiering (biometri eller PIN) krävs, och passkeyn är knuten till domänen. Den kan därför inte nätfiskas.
- Challenges sparas på servern, gäller i 5 minuter och kan bara användas en gång.
- Signaturräknaren kontrolleras.
- Alla händelser loggas: tillagd, borttagen och inloggning.

**Viktigt i produktion:** passkeys är knutna till domännamnet.

- Driftsätt på en fast domän och sätt `WEBAUTHN_RP_ID` (t.ex. `bokforing.example.se`) och `APP_ORIGIN` (t.ex. `https://bokforing.example.se`).
- Byter man domän, eller använder Vercels förhandsgransknings-URL:er, fungerar redan registrerade passkeys inte där.
- Lösenordsinloggning finns kvar som reserv.

## Bankkoppling

Under **Bank** kopplar bolagets ägare banken med BankID. Därefter hämtas transaktioner och saldon automatiskt varje natt via cron-jobbet `/api/cron/bank`, eller manuellt med "Hämta transaktioner". Utan Open Banking kan man i stället importera kontoutdrag som **camt.053** (ISO 20022) eller **CSV** från SEB, Swedbank, Handelsbanken, Nordea med flera.

**Bankavstämning** föreslår matchningar för varje transaktion:

- **Insättning:** matchas mot obetalda kundfakturor via OCR, fakturanummer, kundnamn eller belopp. Inbetalningen bokförs.
- **Uttag:** matchas mot leverantörsfakturor via OCR eller leverantör och belopp. Betalningen bokförs, och fakturan attesteras om det behövs.
- **Redan bokförd:** kopplas till en befintlig verifikation med samma belopp och närliggande datum, utan ny bokföring.
- **Övrigt:** bokförs mot valfritt konto, med eller utan moms, eller ignoreras.

Banksidan visar saldot i banken bredvid saldot i bokföringen, så att skillnader syns direkt.

### Sätta upp Open Banking (Enable Banking)

1. Registrera ett konto på [enablebanking.com](https://enablebanking.com) och skapa en applikation i deras Control Panel. Generera en nyckel:
   `openssl genrsa -out private.key 4096 && openssl req -new -x509 -key private.key -out public.crt -days 3650 -subj "/CN=bokforing"`
   och ladda upp `public.crt`.
2. Lägg till redirect-URL:en `https://<din-domän>/bank/callback`.
3. Aktivera applikationen genom att länka bolagets egna konton. Det är gratis för egna konton; kontakta Enable Banking för andra upplägg.
4. Sätt `ENABLEBANKING_APP_ID` (applikationens id) och `ENABLEBANKING_PRIVATE_KEY` (innehållet i `private.key`, gärna base64-kodat) i Vercel.

Några saker att känna till:

- Kopplingen ger bara läsbehörighet. Inga betalningar kan göras.
- Samtycket gäller enligt bankens gräns, normalt 90–180 dagar, och förnyas sedan med BankID.
- För företagskonton kan banken kräva fullmakt för öppna bank-tjänster (t.ex. Handelsbanken).
- Sessionen hos leverantören lagras krypterad med AES-256-GCM (`ENCRYPTION_KEY`).

## Dokument och e-signering

Under **Dokument & e-signering** skapar man ett dokument (text eller PDF) och väljer undertecknare. API:t och HR-modulen skapar dokument på samma sätt.

| Undertecknare | Hur | Bevis |
|---|---|---|
| Intern användare | Inloggad, med **passkey** (biometri/PIN) eller lösenord | WebAuthn-signatur över en challenge som innehåller dokumentets hash. Den kan verifieras i efterhand med passkeyns publika nyckel. |
| Extern person | **Personlig länk** (skickas via e-post om `RESEND_API_KEY` är satt, annars kopieras länken). Personen skriver sitt fullständiga namn och bekräftar. | Tid, IP-adress, webbläsare, namn och dokumenthash |

När alla har signerat förseglas beviset med HMAC-SHA256. Dokumentet får då en utskrivbar **verifieringsbilaga** som också kan sparas som PDF. Om dokumentet eller signaturerna ändras i efterhand visas förseglingen som ogiltig.

Varje steg (skapat, skickat, öppnat, signerat, avböjt) loggas. Det skickas också som händelser (`document.*`) till webhooks och moduler.

**Juridiskt:** detta är en *enkel elektronisk underskrift* med stark spårbarhet. Den räcker för de flesta avtal utan formkrav, till exempel anställningsavtal, sekretessavtal och uppdragsavtal. Avtal med formkrav, som fastighetsköp, kräver annat. Behövs avancerad e-signatur med **BankID** kan en leverantör som Scrive eller Criipto kopplas in som ytterligare signeringsmetod.

## HR-modulen

Aktiveras under **Inställningar → Moduler**.

- **Onboarding:** lägger upp medarbetaren i lönen som inaktiv och skickar ett anställningsavtal för signering. Medarbetaren signerar via länk, du signerar för arbetsgivaren. Checklistan omfattar avtal, skattebesked, IT-utrustning, konton, introduktion, arbetsmiljö, pension och uppföljning. Medarbetaren aktiveras i lönen när processen slutförs.
- **Förflyttning:** ny befattning, avdelning, chef och/eller lön. Ändringen av anställningsvillkor e-signeras och förs över till lönen när processen slutförs.
- **Offboarding:** sista anställningsdag och orsak, med en bekräftelse som e-signeras. Checklistan omfattar slutlön, utrustning, konton, arbetsgivarintyg och pension. Sista dag förs över till lönen, och slutlönen körs i ordinarie lönekörning.

Gemensamt för alla processer:

- Uppgiften "avtal signerat" bockas av automatiskt via händelsen `document.completed`.
- Processerna finns också i API:t under `/api/v1/m/hr/…` (scopes `hr:read`/`hr:write`).
- Avtalsmallarna finns i `modules/hr/templates.ts` och bör anpassas till kollektivavtal och egna rutiner.
- Uppsägning från arbetsgivarens sida kräver dessutom ett formellt uppsägningsbesked enligt LAS 8 §.

## Integrationer: REST-API och webhooks

Ägaren skapar API-nycklar och webhooks under **Inställningar → Integrationer**. Redovisningskonsulten kan inte hantera integrationer, eftersom en API-nyckel ger åtkomst som motsvarar en användare.

- **Autentisering:** `Authorization: Bearer bok_…`. Varje nyckel är knuten till ett bolag och har bara de behörigheter som valts. Behörigheterna är `accounting`, `sales`, `purchasing` och `payroll` med `:read` eller `:write`, plus `events:read` och modulernas egna. Nyckeln lagras bara som hash och visas en gång.
- **Samma regler som i appen:** API:t och webbgränssnittet anropar samma tjänstelager (`lib/services/`). Det betyder att balanskontroll, periodlås, löpnummer och regeln att verifikationer inte kan ändras gäller även via API. Allt loggas i behandlingshistoriken med nyckelns namn.
- **Belopp** anges i öre som heltal och **datum** som `ÅÅÅÅ-MM-DD`.
- **Dokumentation:** `/api-docs` (läsbar) och `/api/v1/openapi.json`, som kan importeras i Postman, Zapier, Make m.fl.

```bash
curl -X POST https://din-app.vercel.app/api/v1/invoices \
  -H "Authorization: Bearer $BOK_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-10023" \
  -d '{"customer_id":1,"invoice_date":"2026-05-10","book":true,"lines":[{"description":"Konsult","quantity":10,"unit_price":95000,"vat_rate":25}]}'
```

**Webhooks** skickas som POST med headern `X-Bokforing-Signature: t=<unix>,v1=<hex>`, där v1 = HMAC-SHA256(hemlighet, `"<t>.<body>"`). Händelser sparas i samma databastransaktion som ändringen (outbox) och skickas direkt efter att svaret har lämnats. Misslyckade leveranser försöks igen efter 1 min, 5 min, 30 min, 2 h, 6 h, 12 h och 24 h.

- Omförsöken drivs av nya händelser och av cron-jobbet `/api/cron/webhooks` (se `vercel.json`).
- Sätt miljövariabeln `CRON_SECRET` i Vercel.
- På Vercel Hobby kan cron bara köras en gång per dygn. Med Pro kan schemat sättas till t.ex. `*/5 * * * *`.

## Moduler (CRM, ERP m.m.)

Moduler aktiveras per bolag under **Inställningar → Moduler**. En modul är en mapp i `modules/<id>/` som exporterar en `ModuleDefinition` (se `lib/modules/types.ts`):

| Del | Vad den gör |
|---|---|
| `pages` | Sidor under `/c/<bolag>/m/<id>/…` (serverkomponenter, mönster som `kund/:id`) |
| `nav` | Menyval i sidomenyn |
| `api` | Endpoints under `/api/v1/m/<id>/…`. Får automatiskt autentisering, scopes, idempotens och OpenAPI-dokumentation. |
| `scopes` | Egna behörigheter, t.ex. `crm:read` |
| `events` | Egna händelsetyper, t.ex. `crm.activity.created`, som kan prenumereras på med webhooks |
| `on` | Lyssnare på kärnans händelser (t.ex. `invoice.paid`). De körs i samma transaktion som ändringen, bara för bolag där modulen är aktiv. |
| `migrations/*.sql` | Egna tabeller, som körs av `npm run db:migrate` |

För att lägga till en modul: skapa mappen, lägg till den i `modules/registry.ts` och kör migreringen. **CRM-modulen** (`modules/crm/`) är ett komplett exempel. Den har kontaktpersoner, anteckningar och uppgifter, och en tidslinje per kund som fylls automatiskt när fakturor bokförs, betalas eller krediteras.

Enhetstesterna kontrollerar att modulernas scopes börjar med `<id>:` och att händelserna börjar med `<id>.`.

## Tester

```bash
npm test             # enhetstester: moms, fakturor, lön, arbetsgivaravgifter, AGI mot XSD (kräver xmllint), SIE
npm run typecheck
# End-to-end (kräver Playwright och en tom databas):
npm run build
tests/e2e/run-all.sh   # alla sviter, inklusive fejkad bank
```

`tests/e2e/flow.cjs` går igenom hela flödet: registrering, bolag, kundfaktura med inbetalning, leverantörsfaktura med attest och betalning, hämtning av skattetabell från Skatteverket, lönekörning, AGI-fil (validerad mot XSD), momsavräkning, rättelse, rapporter, SIE och inbjudan av konsult med behörighetskontroll.

`tests/e2e/passkey.cjs` testar passkeys med Chromes virtuella autentiserare: registrering, dubblettskydd, inloggning via autofyll och via knapp, signaturräknare och att en borttagen passkey nekas.

`tests/e2e/bank-hr.cjs` startar en fejkad Enable Banking-server som verifierar JWT-signaturen och testar hela flödet:

- bankkoppling via redirect, sidindelade transaktioner och saldo
- automatisk avstämning via OCR (inklusive automatisk attest), bokföring mot konto, ignorera och ångra
- ny hämtning utan dubbletter, camt.053-import och bortkoppling
- HR-onboarding med e-signering av båda parter, där fel namn nekas
- försegling och verifieringsbilaga
- automatisk avbockning och överföring till lönen, förflyttning och offboarding
- dokument via API och avböjd signering

`tests/e2e/run-all.sh` kör alla fyra sviterna mot en tom databas.

`tests/e2e/api.cjs` testar API, webhooks och moduler: behörigheter, idempotens, felkoder, fakturering via API, sidindelning, webhooks med verifierad signatur, omförsök, CRM-modulens automatiska tidslinje, avaktiverade moduler, OpenAPI och återkallade nycklar.

## Miljövariabler

| Variabel | Beskrivning |
|---|---|
| `DATABASE_URL` | Postgres-anslutning (sätts automatiskt av Neon på Vercel) |
| `WEBAUTHN_RP_ID` | Domänen som passkeys knyts till, t.ex. `bokforing.example.se`. Annars används förfrågans host. |
| `APP_ORIGIN` | Appens fullständiga adress, t.ex. `https://bokforing.example.se`. Kontrolleras vid passkey-inloggning. |
| `ENCRYPTION_KEY` | Minst 32 slumpade tecken. Krypterar banksessioner och förseglar signerade dokument. **Krävs i produktion, och får inte bytas** eftersom gamla förseglingar då blir ogiltiga. |
| `ENABLEBANKING_APP_ID`, `ENABLEBANKING_PRIVATE_KEY` | Open Banking via Enable Banking (se Bankkoppling) |
| `RESEND_API_KEY`, `MAIL_FROM` | Valfritt: e-postutskick av signeringslänkar via Resend |
| `CRON_SECRET` | Skyddar `/api/cron/webhooks`. Vercel skickar den automatiskt till cron-jobb. |
| `WEBHOOK_ALLOW_INSECURE` | `1` tillåter http och interna adresser för webhooks. **Endast för lokal utveckling och test.** |

## Viktigt att veta

- **Kontrollera mot Skatteverket.** Arbetsgivaravgifterna (`lib/payroll.ts`) och momsrutorna (`lib/vat.ts`) följer reglerna för 2026. Se över dem inför varje nytt år. Prova AGI-filen i Skatteverkets testtjänst innan första skarpa inlämningen.
- **AGI-summor.** Arbetsgivaravgiften räknas per anställd på öre. Skatteverket räknar på hela kronor, så kontrollsumman (ruta 487) kan skilja några kronor. Det är Skatteverkets beräkning som gäller.
- **Redovisningsmetod.** Faktureringsmetoden (fakturor bokförs när de registreras) eller kontantmetoden/bokslutsmetoden (fakturor bokförs när de betalas, och obetalda fakturor bokförs per bokslutsdagen i bokslutsguiden). Metoden kan bytas när som helst: varje faktura hanteras utifrån hur den bokfördes, och obokförda fakturor bokförs per bokslutsdagen.
- **Webhook-hemligheter** lagras i klartext i databasen, eftersom de behövs för att signera. Ägaren kan rotera dem.
- **Bankkopplingen** har testats mot en simulerad Enable Banking-server enligt deras dokumentation, men inte mot en riktig bank. Gör en första koppling med Enable Bankings sandbox innan skarp användning.
- **Ännu inte stöd för:** betalningar via Open Banking (PIS), avancerad e-signatur med BankID, inloggning med enbart passkey (det går inte att stänga av lösenordet ännu), begränsning av anropsfrekvens i API:t och vid inloggning, delbetalningar, inläsning av bankfil (Bankgirots LB/ISO 20022), utskick av fakturor via e-post, semesterlöneskuld, sjuklön med karensavdrag, SIE-import samt valutor.
- **Bokslut och deklaration.** INK2-, NE- och SRU-underlaget räknas fram från BAS-kontona och ska granskas innan det lämnas in. Schablonintäkt på periodiseringsfonder, NE-rutorna R12–R48 och andra skattemässiga justeringar måste fyllas i för hand. Reglerna gäller företag med högst 40 Mkr i omsättning och utan EU-handel.
- **Årsredovisningen** kräver avancerad e-signatur vid digital inlämning. Skriv ut och signera den, eller signera via Bolagsverkets e-tjänst. Appens e-signering används bara för stämmoprotokollet.
- **Underlag** sparas i databasen, med högst 8 MB per fil. Bokföringslagen kräver att räkenskapsinformation sparas i 7 år. Se till att databasen säkerhetskopieras (Neon har point-in-time restore).

## Struktur

```
lib/            Ren domänlogik (testbar): money, bas, vat, invoice, supplier, payroll, agi, sie, validate
lib/services/   Tjänstelager (affärslogik) – används av både webbgränssnittet och REST-API:t
lib/server/     Databas, inloggning, bokföringsmotor, händelser (outbox), webhooks, API-nycklar
lib/api/        API-router, endpoints, OpenAPI-generering
lib/bank/       Open Banking-klient (Enable Banking), filtolkning (camt.053/CSV), matchning
lib/modules/    Modulkontrakt (ModuleDefinition)
modules/        Tilläggsmoduler (crm/, hr/) och registry.ts
app/            Sidor och server actions (Next.js App Router), app/api/v1 = REST-API
db/migrations/  SQL-schema
tests/          Enhetstester, E2E-test och Skatteverkets XSD för AGI
```
