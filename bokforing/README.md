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
| **REST-API** | `/api/v1` med API-nycklar per bolag och behörigheter (scopes), idempotens via `Idempotency-Key` och en OpenAPI 3.1-specifikation. Dokumentationen finns på `/api-docs`. |
| **Webhooks** | Signerade (HMAC-SHA256) och skickas om automatiskt vid fel. Appen har en leveranslogg, testhändelser och SSRF-skydd. Händelserna kan även hämtas via `GET /api/v1/events`. |
| **Moduler** | Ett pluggbart system för t.ex. CRM, ERP och lager. En modul kan ha egna sidor, menyval, API-endpoints, scopes, händelser, databastabeller och lyssnare. En CRM-modul följer med som exempel. |

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
3. Lägg till miljövariabeln `CRON_SECRET` (en lång slumpsträng), som används för att skicka om webhooks.
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
npm run build && WEBHOOK_ALLOW_INSECURE=1 CRON_SECRET=testcron npm start &
BASE_URL=http://localhost:3000 npm run test:e2e
```

`tests/e2e/flow.cjs` går igenom hela flödet: registrering, bolag, kundfaktura med inbetalning, leverantörsfaktura med attest och betalning, hämtning av skattetabell från Skatteverket, lönekörning, AGI-fil (validerad mot XSD), momsavräkning, rättelse, rapporter, SIE och inbjudan av konsult med behörighetskontroll.

`tests/e2e/passkey.cjs` testar passkeys med Chromes virtuella autentiserare: registrering, dubblettskydd, inloggning via autofyll och via knapp, signaturräknare och att en borttagen passkey nekas.

`tests/e2e/api.cjs` testar API, webhooks och moduler: behörigheter, idempotens, felkoder, fakturering via API, sidindelning, webhooks med verifierad signatur, omförsök, CRM-modulens automatiska tidslinje, avaktiverade moduler, OpenAPI och återkallade nycklar.

## Miljövariabler

| Variabel | Beskrivning |
|---|---|
| `DATABASE_URL` | Postgres-anslutning (sätts automatiskt av Neon på Vercel) |
| `WEBAUTHN_RP_ID` | Domänen som passkeys knyts till, t.ex. `bokforing.example.se`. Annars används förfrågans host. |
| `APP_ORIGIN` | Appens fullständiga adress, t.ex. `https://bokforing.example.se`. Kontrolleras vid passkey-inloggning. |
| `CRON_SECRET` | Skyddar `/api/cron/webhooks`. Vercel skickar den automatiskt till cron-jobb. |
| `WEBHOOK_ALLOW_INSECURE` | `1` tillåter http och interna adresser för webhooks. **Endast för lokal utveckling och test.** |

## Viktigt att veta

- **Kontrollera mot Skatteverket.** Arbetsgivaravgifterna (`lib/payroll.ts`) och momsrutorna (`lib/vat.ts`) följer reglerna för 2026. Se över dem inför varje nytt år. Prova AGI-filen i Skatteverkets testtjänst innan första skarpa inlämningen.
- **AGI-summor.** Arbetsgivaravgiften räknas per anställd på öre. Skatteverket räknar på hela kronor, så kontrollsumman (ruta 487) kan skilja några kronor. Det är Skatteverkets beräkning som gäller.
- **Faktureringsmetoden.** Kund- och leverantörsfakturor bokförs när de registreras. Kontantmetoden stöds inte.
- **Webhook-hemligheter** lagras i klartext i databasen, eftersom de behövs för att signera. Ägaren kan rotera dem.
- **Ännu inte stöd för:** inloggning med enbart passkey (det går inte att stänga av lösenordet ännu), begränsning av anropsfrekvens i API:t och vid inloggning, delbetalningar, inläsning av bankfil (Bankgirots LB/ISO 20022), utskick av fakturor via e-post, semesterlöneskuld, sjuklön med karensavdrag, årsbokslut och årsredovisning, SIE-import samt valutor.
- **Underlag** sparas i databasen, med högst 8 MB per fil. Bokföringslagen kräver att räkenskapsinformation sparas i 7 år. Se till att databasen säkerhetskopieras (Neon har point-in-time restore).

## Struktur

```
lib/            Ren domänlogik (testbar): money, bas, vat, invoice, supplier, payroll, agi, sie, validate
lib/services/   Tjänstelager (affärslogik) – används av både webbgränssnittet och REST-API:t
lib/server/     Databas, inloggning, bokföringsmotor, händelser (outbox), webhooks, API-nycklar
lib/api/        API-router, endpoints, OpenAPI-generering
lib/modules/    Modulkontrakt (ModuleDefinition)
modules/        Tilläggsmoduler (crm/) och registry.ts
app/            Sidor och server actions (Next.js App Router), app/api/v1 = REST-API
db/migrations/  SQL-schema
tests/          Enhetstester, E2E-test och Skatteverkets XSD för AGI
```
