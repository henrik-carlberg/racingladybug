# Ligaläget

Webbapp för Allsvenskan och SHL: tabell, resultat, spelschema, live-vy, statistik och
självservice för annonsköp. Statisk front i `public/` och en serverless API-proxy i `api/`,
byggd för Vercel.

## Struktur

```
public/index.html   hela appen (HTML, CSS, JS i en fil)
api/[league].js     GET /api/allsvenskan.json, /api/shl.json – proxy med cache
data/*.json         snapshot som API:et faller tillbaka på
vercel.json         rewrites och säkerhetsheaders
```

## Publicera på Vercel via GitHub

1. Skapa ett tomt repo på GitHub (t.ex. `ligalaget`), privat eller publikt.
2. I den här mappen:
   ```bash
   git init
   git add .
   git commit -m "Ligaläget v0.1"
   git branch -M main
   git remote add origin git@github.com:<ditt-konto>/ligalaget.git
   git push -u origin main
   ```
3. Gå till [vercel.com/new](https://vercel.com/new), välj **Import Git Repository** och peka på repot.
   Framework preset: **Other**. Root directory: `/`. Inga build-kommandon behövs.
4. Klicka **Deploy**. Efter någon minut finns appen på `https://ligalaget.vercel.app`
   (eller det namn Vercel ger). Varje push till `main` deployas automatiskt;
   pull requests får en egen förhandsvisnings-URL.
5. Egen domän: **Settings → Domains** i Vercel, peka domänens DNS dit Vercel säger.

## Koppla riktig data

`api/[league].js` serverar `data/<liga>.json` tills miljövariablerna
`DATA_PROVIDER_URL` och `DATA_PROVIDER_KEY` finns. Sätt dem i Vercel under
**Settings → Environment Variables** och fyll i `mapProvider()` så att leverantörens
svar mappas till appens schema (samma fält som i `data/*.json`). Fronten behöver inte
ändras. Cache sätts automatiskt till 30 s runt matchtid och 5 min annars, så en
leverantör med betalning per anrop belastas lite även med många besökare.

Leverantörer som täcker båda ligorna: API-Football + api-hockey (api-sports.io),
Sportradar, TheSportsDB. SHL har även ett eget API för partners.

## Annonser

Annonsplatserna definieras i `AD_SLOTS` i `public/index.html` (namn, placering, pris).
Bokningsformuläret öppnar just nu ett e-postutkast till adressen i `AD_CONTACT`.
Nästa steg är att posta formuläret till en funktion i `api/` som sparar bokningen och,
om ni vill ha helt självbetjänad betalning, skapar en Stripe Checkout-session.

## Lokal utveckling

```bash
npm i -g vercel
vercel dev        # http://localhost:3000 med fungerande /api
```
