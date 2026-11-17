import { headers } from 'next/headers';
import { buildOpenApi } from '@/lib/api/openapi';
import { allScopes } from '@/lib/api/scopes';
import { allEventTypes } from '@/lib/server/integrations';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'API-dokumentation – Bokföring' };

type Op = { summary: string; description: string; tags: string[]; parameters?: { name: string; in: string; description?: string }[]; requestBody?: { content: { 'application/json': { schema: unknown } } } };

export default async function ApiDocs() {
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`;
  const spec = buildOpenApi(origin);
  const byTag = new Map<string, { method: string; path: string; op: Op }[]>();
  for (const [path, ops] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(ops as Record<string, Op>)) {
      const tag = op.tags[0];
      (byTag.get(tag) ?? byTag.set(tag, []).get(tag)!).push({ method: method.toUpperCase(), path, op });
    }
  }
  const base = `${origin}/api/v1`;
  return (
    <main style={{ maxWidth: 980, margin: '0 auto' }}>
      <h1>Bokföring API v1</h1>
      <p>REST-API för bokföring, fakturering, leverantörsbetalningar och lön. Maskinläsbar specifikation: <a href="/api/v1/openapi.json">openapi.json</a> (OpenAPI 3.1 – kan importeras i Postman, Insomnia, Zapier/Make m.fl.).</p>

      <h2>Kom igång</h2>
      <ol>
        <li>Bolagets ägare skapar en API-nyckel under <b>Inställningar → Integrationer</b> och väljer behörigheter.</li>
        <li>Skicka nyckeln i varje anrop: <code className="mono">Authorization: Bearer bok_…</code>. Nyckeln är knuten till ett bolag.</li>
      </ol>
      <pre className="card mono small" style={{ overflowX: 'auto' }}>{`curl ${base}/invoices?status=booked \\
  -H "Authorization: Bearer $BOK_API_KEY"

curl -X POST ${base}/invoices \\
  -H "Authorization: Bearer $BOK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-10023" \\
  -d '{"customer_id": 1, "invoice_date": "2026-05-10", "book": true,
       "lines": [{"description": "Konsulttimmar", "quantity": 10, "unit": "h", "unit_price": 95000, "vat_rate": 25}]}'`}</pre>

      <h2>Konventioner</h2>
      <ul>
        <li><b>Belopp</b> är heltal i öre: <code className="mono">95000</code> = 950,00 kr.</li>
        <li><b>Datum</b> anges som <code className="mono">ÅÅÅÅ-MM-DD</code>.</li>
        <li><b>Listor</b> returnerar <code className="mono">{'{ object: "list", data: [...], has_more }'}</code>. Nästa sida: <code className="mono">?starting_after=&lt;sista id&gt;</code>.</li>
        <li><b>Fel</b>: <code className="mono">{'{ error: { code, message } }'}</code> med status 400 (validering), 401, 403 (behörighet), 404, 409 (konflikt, t.ex. redan bokförd), 422 (bokföringsregel, t.ex. obalans eller låst period).</li>
        <li><b>Idempotens</b>: skicka <code className="mono">Idempotency-Key</code> på POST. Ett omförsök med samma nyckel bokför inte igen utan ger samma svar.</li>
        <li><b>Bokföringsregler gäller</b>: bokförda verifikationer kan inte ändras eller tas bort; rätta med <code className="mono">POST /vouchers/{'{id}'}/reverse</code>.</li>
      </ul>

      <h2>Behörigheter</h2>
      <table><tbody>{allScopes().map((s) => <tr key={s.scope}><td className="mono">{s.scope}</td><td>{s.description}{s.module && <span className="badge" style={{ marginLeft: 6 }}>{s.module}</span>}</td></tr>)}</tbody></table>
      <p className="small muted"><span className="mono">:write</span> innefattar <span className="mono">:read</span>.</p>

      <h2>Endpoints</h2>
      {[...byTag].map(([tag, ops]) => (
        <section key={tag}>
          <h3>{tag}</h3>
          <table>
            <tbody>
              {ops.map(({ method, path, op }) => (
                <tr key={method + path}>
                  <td style={{ width: 70 }}><span className="badge mono">{method}</span></td>
                  <td>
                    <code className="mono">{path}</code> – {op.summary}
                    <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{op.description}</div>
                    {op.parameters?.filter((p) => p.in === 'query').length ? (
                      <div className="small">Parametrar: {op.parameters.filter((p) => p.in === 'query').map((p) => <span key={p.name}><code className="mono">{p.name}</code> ({p.description}) </span>)}</div>
                    ) : null}
                    {op.requestBody && (
                      <details className="small"><summary>Body (JSON Schema)</summary>
                        <pre className="mono" style={{ overflowX: 'auto' }}>{JSON.stringify(op.requestBody.content['application/json'].schema, null, 2)}</pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <h2 id="webhooks">Webhooks</h2>
      <p>Ägaren registrerar webhook-URL:er under <b>Integrationer</b> och väljer händelser. Vid varje händelse skickas en POST:</p>
      <pre className="card mono small" style={{ overflowX: 'auto' }}>{`POST https://din-tjanst.se/webhook
Content-Type: application/json
X-Bokforing-Event: invoice.paid
X-Bokforing-Event-Id: evt_3f2a…
X-Bokforing-Signature: t=1767225600,v1=5d41402abc4b2a76b9719d911017c592…

{ "id": "evt_3f2a…", "type": "invoice.paid", "created_at": "2026-05-30T08:12:00Z",
  "company_id": 1, "data": { "id": 12, "object": "invoice", "number": 1001, "status": "paid", … } }`}</pre>
      <p>Svara med HTTP 2xx inom 10 sekunder. Annars görs nya försök efter 1 min, 5 min, 30 min, 2 h, 6 h, 12 h och 24 h.
        Samma händelse kan levereras mer än en gång – använd <code className="mono">id</code> för att ignorera dubbletter. Saknade händelser kan hämtas med <code className="mono">GET /events?after=&lt;seq&gt;</code>.</p>
      <p><b>Verifiera signaturen</b> (Node.js):</p>
      <pre className="card mono small" style={{ overflowX: 'auto' }}>{`import crypto from 'node:crypto';

function verify(secret, rawBody, header) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // max 5 min gammal
  const expected = crypto.createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'));
}`}</pre>
      <h3>Händelsetyper</h3>
      <table><tbody>{allEventTypes().map((e) => <tr key={e.type}><td className="mono">{e.type}</td><td>{e.description}</td></tr>)}</tbody></table>
      <p className="small muted"><code className="mono">data</code> innehåller objektet i samma form som motsvarande GET-endpoint returnerar.</p>

      <h2>Moduler</h2>
      <p>Tilläggsmoduler (t.ex. CRM) har sina endpoints under <code className="mono">/api/v1/m/&lt;modul&gt;/…</code>, egna behörigheter och händelser. De fungerar bara för bolag där modulen är aktiverad.</p>
    </main>
  );
}
