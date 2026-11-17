// End-to-end: SaaS-grunden – fri registrering, provperiod, abonnemang via (fejkad) Stripe med webhooks, modulpris,
// spärr när abonnemanget gått ut, anställd med självservice och faktura som skickas med länk.
// Servern startas med STRIPE_SECRET_KEY, STRIPE_API_URL=http://localhost:3302, STRIPE_WEBHOOK_SECRET=whsec_test och BILLING_ENFORCED=true.
const { chromium } = require('playwright');
const http = require('http');
const crypto = require('crypto');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const waitMsg = (page, text) => page.waitForURL((u) => decodeURIComponent(u.toString()).includes(text), { timeout: 20000 });
const text = async (page) => { await page.waitForLoadState('networkidle'); await page.waitForSelector('main h1'); return (await page.locator('main').textContent()).replace(/\s+/g, ' '); };

// ---- Fejkad Stripe ----
const calls = [];
const parse = (body) => Object.fromEntries(new URLSearchParams(body));
let subAmount = 0;
const stripe = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const p = parse(body);
    calls.push({ method: req.method, url: req.url, p });
    const send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/v1/checkout/sessions') { subAmount = Number(p['line_items[0][price_data][unit_amount]']); return send({ id: 'cs_1', url: p.success_url }); }
    if (req.url === '/v1/billing_portal/sessions') return send({ url: p.return_url + '?portal=1' });
    if (req.url === '/v1/subscriptions/sub_1' && req.method === 'GET') return send({ id: 'sub_1', items: { data: [{ id: 'si_1', price: { product: 'prod_1', unit_amount: subAmount } }] } });
    if (req.url === '/v1/subscriptions/sub_1' && req.method === 'POST') { subAmount = Number(p['items[0][price_data][unit_amount]']); return send({ id: 'sub_1' }); }
    res.writeHead(404); res.end('{"error":{"message":"okänd"}}');
  });
}).listen(3302);

async function webhook(event, secret = 'whsec_test') {
  const payload = JSON.stringify(event), t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const r = await fetch(`${BASE}/api/stripe/webhook`, { method: 'POST', headers: { 'Stripe-Signature': `t=${t},v1=${sig}`, 'Content-Type': 'application/json' }, body: payload });
  return r.status;
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(20000);

  // ---- Fri registrering och provperiod ----
  await page.goto(BASE + '/register');
  assert((await page.locator('main, body').first().textContent()).includes('30 dagar'), 'provperiod på registreringssidan');
  await page.fill('input[name=name]', 'Nina Nystart');
  await page.fill('input[name=email]', 'nina@example.com');
  await page.fill('input[name=password]', 'ninaslosen12');
  await page.check('input[name=terms]');
  await page.click('button:has-text("Skapa konto")');
  await page.waitForURL(BASE + '/');
  await page.fill('input[name=name]', 'Nystart AB');
  await page.fill('input[name=orgnr]', '5592074933');
  await page.click('button:has-text("Skapa bolag")');
  await page.waitForURL(/kom-igang/);
  const N = page.url().replace(/\/kom-igang.*/, '');
  await page.goto(N + '/abonnemang');
  let t = await text(page);
  assert(t.includes('Provperiod – 30 dagar kvar') && t.includes('99,00'), 'provperiod: ' + t.slice(0, 600));
  log('fri registrering, nytt bolag med 30 dagars provperiod, 99 kr/mån');

  await page.goto(N + '/moduler');
  await page.locator('.card:has(h2:text-is("Projekt")) button:has-text("Aktivera")').click();
  await page.waitForURL(/ok=/);
  await page.goto(N + '/integrationer');
  await page.fill('input[name=name]', 'Test');
  await page.check('input[name=scopes][value="accounting:write"]');
  await page.click('button:has-text("Skapa API-nyckel")');
  const token = (await page.locator('.flash.ok code').textContent({ timeout: 10000 })).trim();
  await page.goto(N + '/abonnemang');
  assert((await text(page)).includes('138,00'), 'pris med en modul 99 + 39');
  await page.click('button:has-text("Starta abonnemang")');
  await waitMsg(page, 'Abonnemanget är startat');
  const co = calls.find((c) => c.url === '/v1/checkout/sessions');
  assert(co && co.p.mode === 'subscription' && co.p['line_items[0][price_data][unit_amount]'] === '13800' && co.p['line_items[0][price_data][currency]'] === 'sek', 'checkout: ' + JSON.stringify(co));
  const cid = co.p.client_reference_id;
  assert(await webhook({ type: 'checkout.session.completed', data: { object: { client_reference_id: cid, customer: 'cus_1', subscription: 'sub_1', metadata: { company_id: cid } } } }) === 200, 'webhook checkout');
  const future = Math.floor(Date.now() / 1000) + 30 * 86400;
  assert(await webhook({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: future, metadata: { company_id: cid } } } }) === 200, 'webhook updated');
  assert(await webhook({ type: 'customer.subscription.updated', data: { object: {} } }, 'whsec_fel') === 400, 'fel signatur nekas');
  await page.goto(N + '/abonnemang');
  t = await text(page);
  assert(t.includes('Aktivt') && t.includes('Förnyas'), 'aktivt abonnemang: ' + t.slice(0, 600));
  await page.click('button:has-text("Hantera betalning")');
  await page.waitForURL(/portal=1/);
  log('Stripe Checkout 138 kr/mån, webhooks med signatur, kundportal');

  await page.goto(N + '/moduler');
  await page.locator('.card:has(h2:text-is("Resursbokning")) button:has-text("Aktivera")').click();
  await page.waitForURL(/ok=/);
  assert(subAmount === 17700, 'pris uppdaterat i Stripe till 177 kr: ' + subAmount);
  log('ny modul → abonnemangets pris uppdateras till 177 kr');

  const past = Math.floor(Date.now() / 1000) - 3 * 86400;
  await webhook({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', current_period_end: past, metadata: { company_id: cid } } } });
  await page.goto(N + '/verifikationer');
  await page.waitForURL(/abonnemang/);
  t = await text(page);
  assert(t.includes('Starta abonnemanget för att fortsätta'), 'spärrat: ' + t.slice(0, 400));
  await page.goto(N + '/rapporter/export');
  assert(!page.url().includes('abonnemang'), 'export fungerar när spärrat');
  const api = await fetch(`${BASE}/api/v1/company`, { headers: { Authorization: `Bearer ${token}` } });
  assert(api.status === 402, 'API ger 402: ' + api.status);
  log('avslutat abonnemang: bolaget spärras (export öppen), API svarar 402');

  // ---- Anställd med självservice (bolag 1) ----
  const owner = await (await browser.newContext()).newPage();
  await owner.goto(BASE + '/login');
  await owner.fill('input[name=email]', 'agare@example.com');
  await owner.fill('input[name=password]', 'hemligtlosen1');
  await owner.click('form button:has-text("Logga in")');
  await owner.waitForURL(BASE + '/');
  const B = `${BASE}/c/1`;
  await owner.goto(B + '/installningar');
  await owner.fill('form:has(button:has-text("Skapa inbjudan")) input[name=email]', 'anna@example.com');
  await owner.selectOption('select[name=role]', 'employee');
  await owner.selectOption('select[name=employee_id]', { label: 'Anna Andersson' });
  await owner.click('button:has-text("Skapa inbjudan")');
  const link = (await owner.locator('.flash.ok code').textContent({ timeout: 10000 })).trim();
  const anna = await (await browser.newContext()).newPage();
  await anna.goto(link);
  await anna.fill('input[name=name]', 'Anna Andersson');
  await anna.fill('input[name=password]', 'annaslosen12');
  await anna.click('button:has-text("Acceptera")');
  await anna.waitForURL(BASE + '/');
  await anna.goto(B);
  await anna.waitForURL(/\/mitt/);
  t = await text(anna);
  assert(t.includes('Hej Anna') && t.includes('Tidrapport') && t.includes('Lönespecifikationer'), 'min sida: ' + t.slice(0, 500));
  const nav = await anna.locator('aside nav').textContent();
  assert(!nav.includes('Verifikationer') && !nav.includes('Inställningar'), 'begränsad meny');
  await anna.goto(B + '/verifikationer');
  await anna.waitForURL(/\/mitt/);
  await anna.goto(B + '/m/lager');
  await anna.waitForURL(/\/mitt/);
  await anna.goto(B + '/mitt/lon');
  t = await text(anna);
  assert(t.includes('Lönespecifikation 2026-05') && t.includes('Att få utbetalt') && t.includes('XXXX'), 'lönespec: ' + t.slice(0, 600));
  await anna.goto(B + '/m/utlagg');
  t = await text(anna);
  assert(t.includes('Kundbesök Borås') && !t.includes('Attestera'), 'egna utlägg: ' + t.slice(0, 600));
  await anna.goto(B + '/tid?all=1');
  t = await text(anna);
  assert(!t.includes('Visa allas tid') && !t.includes('Ägare Testsson'), 'bara egen tid');
  log('anställd: Min sida, egna lönespecar, egna utlägg och egen tid – inget annat');

  // ---- Faktura med länk ----
  await owner.goto(B + '/fakturor');
  await owner.click('table a:has-text("1001")');
  await owner.waitForURL(/fakturor\/\d+/);
  await owner.fill('form:has(button:has-text("Skicka faktura")) input[name=to]', 'kund@example.com');
  await owner.click('button:has-text("Skicka faktura")');
  await owner.waitForURL(/ok=/);
  const msg = decodeURIComponent(owner.url());
  const pub = msg.match(/(https?:\/\/[^\s&]+\/f\/[A-Za-z0-9_-]+)/)[1];
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(pub);
  t = (await guest.locator('body').textContent()).replace(/\s+/g, ' ');
  assert(t.includes('FAKTURA') && t.includes('Fakturanummer1001') && t.includes('Spara som PDF'), 'publik faktura: ' + t.slice(0, 500));
  assert((await (await fetch(`${BASE}/f/ogiltigtokenxxxxxxxxxxxx`)).status) === 404, 'okänd länk 404');
  log('faktura delad med hemlig länk som kunden kan öppna och spara som PDF');

  await browser.close();
  stripe.close();
})().catch((e) => { console.error('FEL:', e.message); process.exit(1); });
