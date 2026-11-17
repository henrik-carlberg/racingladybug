import 'server-only';
import { CORE_EVENTS } from '@/lib/events-catalog';
import { MODULES } from '@/modules/registry';
import { CORE_ROUTES } from './routes';
import { allScopes } from './scopes';
import type { ApiRoute } from './router';

/** Genererar OpenAPI 3.1 från samma routedefinitioner som API:t använder – kan aldrig glida isär. */
export function buildOpenApi(baseUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  const add = (prefix: string, r: ApiRoute, tag?: string) => {
    const p = prefix + r.path.replace(/:([a-zA-Z_]+)/g, '{$1}');
    const params = [...r.path.matchAll(/:([a-zA-Z_]+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'integer' } }));
    const query = (r.query ?? []).map((x) => ({ name: x.name, in: 'query', required: false, description: x.description, schema: { type: x.type ?? 'string' } }));
    paths[p] ??= {};
    paths[p][r.method.toLowerCase()] = {
      summary: r.summary,
      description: [r.description, `Kräver behörigheten \`${r.scope}\`.`].filter(Boolean).join('\n\n'),
      tags: [tag ?? r.tag ?? 'Övrigt'],
      security: [{ bearer: [r.scope] }],
      parameters: [...params, ...query, ...(r.method === 'POST' ? [{ name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string' },
        description: 'Valfri unik nyckel. Ett omförsök med samma nyckel utförs inte igen utan ger samma svar.' }] : [])],
      ...(r.body ? { requestBody: { required: true, content: { 'application/json': { schema: r.body } } } } : {}),
      responses: {
        [String(r.status ?? 200)]: { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } },
        '400': { $ref: '#/components/responses/Error' }, '401': { $ref: '#/components/responses/Error' },
        '403': { $ref: '#/components/responses/Error' }, '404': { $ref: '#/components/responses/Error' },
        '409': { $ref: '#/components/responses/Error' }, '422': { $ref: '#/components/responses/Error' },
      },
    };
  };
  for (const r of CORE_ROUTES) add('', r);
  for (const m of MODULES) for (const r of m.api ?? []) add(`/m/${m.id}`, r, `Modul: ${m.name}`);

  const events = [...CORE_EVENTS, ...MODULES.flatMap((m) => m.events ?? [])];
  return {
    openapi: '3.1.0',
    info: {
      title: 'Bokföring API', version: '1.0.0',
      description: [
        'REST-API för bokföring, fakturering, leverantörsbetalningar och lön.',
        '',
        '**Autentisering:** `Authorization: Bearer <API-nyckel>`. Nycklar skapas av bolagets ägare under Inställningar → Integrationer och är knutna till ett bolag.',
        '',
        '**Belopp** anges i öre som heltal (`12500` = 125,00 kr). **Datum** som `ÅÅÅÅ-MM-DD`.',
        '',
        '**Listor** returnerar `{ object: "list", data, has_more }`. Hämta nästa sida med `starting_after=<sista id>`.',
        '',
        '**Fel** returneras som `{ error: { code, message } }`.',
        '',
        '**Moduler** (t.ex. CRM) har sina endpoints under `/m/<modul>/…` och kräver att modulen är aktiverad för bolaget.',
        '',
        '**Webhooks:** POST med JSON `{ id, type, created_at, company_id, data }` och headern `X-Bokforing-Signature: t=<unix>,v1=<hex>` där v1 = HMAC-SHA256(secret, "<t>.<body>"). Svara med 2xx inom 10 s; annars görs nya försök i upp till ett dygn.',
        '',
        '**Händelsetyper:**',
        ...events.map((e) => `- \`${e.type}\` – ${e.description}`),
      ].join('\n'),
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: allScopes().map((s) => `${s.scope}: ${s.description}`).join('\n') } },
      responses: { Error: { description: 'Fel', content: { 'application/json': { schema: { type: 'object', properties: {
        error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } } } } } },
    },
    paths,
  };
}
