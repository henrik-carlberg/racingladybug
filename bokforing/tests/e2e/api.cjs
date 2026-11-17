// End-to-end-test av REST-API, webhooks och moduler. Körs EFTER flow.cjs mot samma databas.
// Servern måste startas med WEBHOOK_ALLOW_INSECURE=1 (för webhook till localhost) och CRON_SECRET=testcron.
const { chromium } = require('playwright');
const http = require('http');
const crypto = require('crypto');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };

// Webhook-mottagare
const received = [];
let secret = '';
const receiver = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const { t, v1 } = Object.fromEntries(req.headers['x-bokforing-signature'].split(',').map((p) => p.split('=')));
    const ok = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex') === v1;
    received.push({ type: req.headers['x-bokforing-event'], ok, body: JSON.parse(body) });
    res.writeHead(ok ? 200 : 401).end();
  });
}).listen(3201);

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/login');
  await page.fill('input[name=email]', 'agare@example.com');
  await page.fill('input[name=password]', 'hemligtlosen1');
  await page.click('button:has-text("Logga in")');
  await page.waitForURL(BASE + '/');
  const B = `${BASE}/c/1`;

  // Aktivera CRM-modulen
  await page.goto(B + '/moduler');
  await page.click('button:has-text("Aktivera")');
  await page.waitForURL(/ok=/);
  log('CRM-modul aktiverad');

  // API-nyckel
  await page.goto(B + '/integrationer');
  await page.fill('input[name=name]', 'Testintegration');
  for (const s of ['accounting:write', 'sales:write', 'events:read', 'crm:write']) await page.check(`input[name=scopes][value="${s}"]`);
  await page.click('button:has-text("Skapa API-nyckel")');
  const token = (await page.locator('.flash.ok code').textContent({ timeout: 10000 })).trim();
  assert(token.startsWith('bok_'), 'ingen nyckel');
  assert(!page.url().includes(token), 'nyckeln får inte hamna i URL:en');
  log('API-nyckel skapad', token.slice(0, 12) + '…');

  // Webhook
  await page.fill('input[name=url]', 'http://localhost:3201/hook');
  for (const e of ['customer.created', 'invoice.booked', 'invoice.paid', 'crm.activity.created']) await page.check(`input[name=events][value="${e}"]`);
  await page.click('button:has-text("Skapa webhook")');
  await page.waitForURL(/webhooks\/\d+/);
  const hookUrl = page.url().split('?')[0];
  await page.click('summary:has-text("Visa signeringshemlighet")');
  secret = (await page.locator('details code').textContent()).trim();
  log('webhook skapad');

  const api = async (method, path, body, headers = {}) => {
    const res = await fetch(`${BASE}/api/v1${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json, headers: res.headers };
  };

  // Autentisering och behörighet
  assert((await fetch(`${BASE}/api/v1/company`)).status === 401, 'utan nyckel ska ge 401');
  assert((await fetch(`${BASE}/api/v1/company`, { headers: { Authorization: 'Bearer bok_fel' } })).status === 401, 'fel nyckel ska ge 401');
  assert((await api('GET', '/company')).json.orgnr === '556026-9986', 'company');
  const emp = await api('GET', '/employees');
  assert(emp.status === 403 && emp.json.error.code === 'insufficient_scope', 'payroll ska nekas: ' + JSON.stringify(emp.json));
  assert((await api('GET', '/finns-inte')).status === 404, '404');
  assert((await api('DELETE', '/customers')).status === 405, '405');
  log('autentisering, scopes, 404/405');

  // Kund med idempotens
  const c1 = await api('POST', '/customers', { name: 'API-kund AB', email: 'api@example.com' }, { 'Idempotency-Key': 'kund-1' });
  assert(c1.status === 201 && c1.json.object === 'customer', 'skapa kund: ' + JSON.stringify(c1.json));
  const c2 = await api('POST', '/customers', { name: 'API-kund AB', email: 'api@example.com' }, { 'Idempotency-Key': 'kund-1' });
  assert(c2.json.id === c1.json.id && c2.headers.get('idempotent-replayed') === 'true', 'idempotent omspelning');
  const c3 = await api('POST', '/customers', { name: 'Annan' }, { 'Idempotency-Key': 'kund-1' });
  assert(c3.status === 422, 'samma nyckel, annan body ska ge 422');
  const custs = await api('GET', '/customers?q=API-kund');
  assert(custs.json.data.length === 1, 'endast en kund skapad');
  const bad = await api('POST', '/customers', { email: 'x' });
  assert(bad.status === 400 && bad.json.error.code === 'validation_error', 'validering');
  log('kund + idempotens + validering');

  // Faktura: skapa och bokför direkt, betala
  const inv = await api('POST', '/invoices', { customer_id: c1.json.id, invoice_date: '2026-06-10', book: true,
    lines: [{ description: 'Licens', quantity: 2, unit_price: 50000, vat_rate: 25 }, { description: 'Bok', unit_price: 19900, vat_rate: 6 }] });
  assert(inv.status === 201 && inv.json.status === 'booked' && inv.json.number && inv.json.ocr, 'faktura: ' + JSON.stringify(inv.json));
  assert(inv.json.total === 146100, 'total ' + inv.json.total); // 1000 + 250 + 199 + 11,94 = 1460,94 → 1461
  const again = await api('POST', `/invoices/${inv.json.id}/book`);
  assert(again.status === 409, 'dubbel bokföring ska ge 409');
  const paid = await api('POST', `/invoices/${inv.json.id}/payments`, { date: '2026-06-20' });
  assert(paid.json.status === 'paid', 'betald');
  log('faktura', inv.json.number, 'bokförd och betald via API, total', inv.json.total);

  // Verifikationer
  const unbal = await api('POST', '/vouchers', { date: '2026-06-11', description: 'Obalans', lines: [{ account: 6110, debit: 100 }, { account: 1930, credit: 99 }] });
  assert(unbal.status === 422 && unbal.json.error.code === 'bookkeeping_error', 'obalans ska ge 422');
  const locked = await api('POST', '/vouchers', { date: '2025-06-11', description: 'Utanför år', lines: [{ account: 6110, debit: 100 }, { account: 1930, credit: 100 }] });
  assert(locked.status === 422, 'datum utanför räkenskapsår ska ge 422');
  const v = await api('POST', '/vouchers', { date: '2026-06-11', description: 'Pennor', lines: [{ account: 6110, debit: 8000 }, { account: 2641, debit: 2000 }, { account: 1930, credit: 10000 }] });
  assert(v.status === 201 && v.json.series === 'A', 'verifikation');
  const rev = await api('POST', `/vouchers/${v.json.id}/reverse`, { date: '2026-06-12', reason: 'Test' });
  assert(rev.status === 201 && rev.json.corrects_id === v.json.id, 'rättelse');
  const bser = await api('GET', '/vouchers?series=B&limit=2');
  assert(bser.json.data.length === 2 && bser.json.has_more === true, 'sidindelning');
  const next = await api('GET', `/vouchers?series=B&limit=2&starting_after=${bser.json.data[1].id}`);
  assert(next.json.data[0].id > bser.json.data[1].id, 'nästa sida');
  const vat = await api('GET', '/reports/vat?from=2026-06-01&to=2026-06-30');
  assert(vat.json.boxes.find((b) => b.box === '10').amount === 25000, 'moms 25 % ' + JSON.stringify(vat.json.boxes));
  log('verifikationer, rättelse, sidindelning, momsrapport');

  // Händelselogg
  const ev = await api('GET', '/events?type=invoice.paid');
  assert(ev.json.data.some((e) => e.data.id === inv.json.id), 'invoice.paid i händelseloggen');
  log('händelselogg');

  // CRM-modulen: automatiska aktiviteter från fakturahändelser + API
  const acts = await api('GET', `/m/crm/activities?customer_id=${c1.json.id}`);
  const subjects = acts.json.data.map((a) => a.subject);
  assert(subjects.some((s) => s.includes('bokförd')) && subjects.some((s) => s.includes('betald')) && subjects.some((s) => s.includes('skapades')), 'CRM-tidslinje: ' + subjects);
  const na = await api('POST', '/m/crm/activities', { customer_id: c1.json.id, kind: 'task', subject: 'Följ upp förnyelse', due_date: '2026-07-01' });
  assert(na.status === 201, 'crm-aktivitet');
  await page.goto(`${B}/m/crm/kund/${c1.json.id}`);
  assert(await page.locator('text=Följ upp förnyelse').count(), 'CRM-sida visar aktiviteten');
  log('CRM: automatisk tidslinje', subjects.length, 'poster + uppgift via API + modulsida');

  // Webhooks levererade med giltig signatur
  for (let i = 0; i < 40 && received.length < 4; i++) await new Promise((r) => setTimeout(r, 250));
  const types = received.map((r) => r.type).sort();
  assert(received.every((r) => r.ok), 'alla signaturer giltiga');
  for (const t of ['customer.created', 'invoice.booked', 'invoice.paid', 'crm.activity.created']) assert(types.includes(t), `webhook ${t} saknas: ${types}`);
  assert(received.find((r) => r.type === 'invoice.paid').body.data.status === 'paid', 'payload');
  await page.goto(hookUrl);
  assert(await page.locator('text=Levererad').count() >= 4, 'leveranslogg');
  log('webhooks levererade och signaturer verifierade:', types.join(', '));

  // Misslyckad leverans → omförsök schemaläggs; cron kräver hemlighet
  await page.goto(B + '/integrationer');
  await page.fill('input[name=url]', 'http://localhost:3202/nere');
  await page.check('input[name=events][value="*"]');
  await page.click('button:has-text("Skapa webhook")');
  await page.waitForURL(/webhooks\/\d+/);
  await page.click('button:has-text("Skicka testhändelse")');
  await page.waitForURL(/ok=/);
  await new Promise((r) => setTimeout(r, 1500));
  await page.reload();
  assert(await page.locator('text=Väntar (nästa').count(), 'misslyckad leverans ska vänta på nytt försök');
  assert((await fetch(`${BASE}/api/cron/webhooks`)).status === 401, 'cron utan hemlighet');
  assert((await fetch(`${BASE}/api/cron/webhooks`, { headers: { Authorization: 'Bearer testcron' } })).status === 200, 'cron med hemlighet');
  log('misslyckad leverans schemaläggs om, cron skyddad');

  // Modul avaktiverad → API nekas
  await page.goto(B + '/moduler');
  await page.click('button:has-text("Avaktivera")');
  await page.waitForURL(/ok=/);
  const dis = await api('GET', '/m/crm/activities');
  assert(dis.status === 403 && dis.json.error.code === 'module_disabled', 'avaktiverad modul');
  log('avaktiverad modul nekas i API');

  // OpenAPI
  const spec = await (await fetch(`${BASE}/api/v1/openapi.json`)).json();
  assert(spec.openapi === '3.1.0' && spec.paths['/invoices/{id}/book'] && spec.paths['/m/crm/activities'], 'openapi');
  log('OpenAPI', Object.keys(spec.paths).length, 'sökvägar');
  const docs = await fetch(`${BASE}/api-docs`);
  assert(docs.status === 200, 'api-docs');

  // Behandlingshistorik visar API-nyckeln
  await page.goto(B + '/historik');
  assert(await page.locator('text=(API: Testintegration)').count(), 'historik visar API-nyckel');

  // Konsulten kan inte hantera integrationer
  const p2 = await (await browser.newContext()).newPage();
  await p2.goto(BASE + '/login');
  await p2.fill('input[name=email]', 'konsult@example.com');
  await p2.fill('input[name=password]', 'konsultlosen1');
  await p2.click('button:has-text("Logga in")');
  await p2.waitForURL(BASE + '/');
  await p2.goto(B + '/integrationer');
  assert(await p2.locator('text=Endast bolagets ägare').count() && !(await p2.locator('input[name=scopes]').count()), 'konsult ska inte se nyckelhantering');
  log('historik visar API-nyckel, konsult nekas integrationer');

  // Återkalla nyckel
  await page.goto(B + '/integrationer');
  await page.click('button:has-text("Återkalla")');
  await page.waitForURL(/ok=/);
  assert((await api('GET', '/company')).status === 401, 'återkallad nyckel');
  log('återkallad nyckel nekas');

  await browser.close();
  receiver.close();
})().catch((e) => { console.error('FEL:', e.message); receiver.close(); process.exit(1); });
