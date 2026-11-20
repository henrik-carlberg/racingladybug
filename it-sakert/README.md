# IT-Säkert – itsakert.se

Hemsidan för IT-Säkert: en statisk sida utan byggsteg.

## Publicering

Vercel-projektet `it-sakert` är kopplat till det här repot med Root Directory `it-sakert`.

- Push eller merge till `main` publiceras automatiskt på https://itsakert.se.
- Push till andra grenar ger en förhandsversion, skyddad med Vercel-inloggning.

## Filer

| Fil/mapp | Innehåll |
|---|---|
| `index.html` | Hela sidan: innehåll, CSS och JavaScript (kalkylator, nivåguide, flikar, kontaktformulär) |
| `img/` | Foton från Unsplash i WebP |
| `logo/` | Logga och ikoner, samt tidigare förslag i `logo/forslag/` |
| `llms.txt`, `robots.txt`, `sitemap.xml` | För sökmotorer och AI-tjänster |

## Kontaktformuläret

Formuläret öppnar besökarens e-postprogram med ett ifyllt mejl till `hello@itsakert.se` (konstanten `CONTACT_EMAIL` i `index.html`). Ingen server tar emot data.
