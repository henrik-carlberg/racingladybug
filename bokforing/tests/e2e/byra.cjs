// End-to-end: kortbetalning av kundfakturor via (fejkad) Stripe Connect, och byråvy för redovisningskonsulter.
const { chromium } = require('playwright');
const http = require('node:http');
const crypto = require('node:crypto');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const waitMsg = (page, text) => page.waitForURL((u) => decodeURIComponent(u.toString()).includes(text), { timeout: 20000 });
const text = async (page) => { await page.waitForLoadState('networkidle'); await page.waitForSelector('main h1, h1'); return (await page.locator('body').textContent()).replace(/\s+/g, ' '); };

// ---- Fejkad Stripe (Connect) ----
const calls = [];
let session = 0;
const stripe = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const p = Object.fromEntries(new URLSearchParams(body));
    calls.push({ method: req.method, url: req.url, p, account: req.headers['stripe-account'] });
    const send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/v1/accounts' && req.method === 'POST') return send({ id: 'acct_test1' });
    if (req.url === '/v1/account_links') return send({ url: p.return_url });
    if (req.url === '/v1/accounts/acct_test1') return send({ id: 'acct_test1', charges_enabled: true, details_submitted: true });
    if (req.url === '/v1/checkout/sessions') { session++; return send({ id: `cs_inv_${session}`, url: p.success_url }); }
    res.writeHead(404); res.end('{}');
  });
}).listen(3302);
async function connectHook(event, secret = 'whsec_connect') {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const r = await fetch(`${BASE}/api/stripe/connect`, { method: 'POST', headers: { 'Stripe-Signature': `t=${t},v1=${sig}`, 'Content-Type': 'application/json' }, body: payload });
  return { status: r.status, json: r.status === 200 ? await r.json() : null };
}
const paid = (id, amount) => ({ type: 'checkout.session.completed', account: 'acct_test1', created: Math.floor(Date.now() / 1000), data: { object: { id, payment_status: 'paid', amount_total: amount } } });

async function login(browser, email, pw) {
  const p = await (await browser.newContext()).newPage();
  p.setDefaultTimeout(20000);
  await p.goto(BASE + '/login');
  await p.fill('input[name=email]', email);
  await p.fill('input[name=password]', pw);
  await p.click('form button:has-text("Logga in")');
  await p.waitForURL(BASE + '/');
  return p;
}
async function register(browser, name, email, pw) {
  const p = await (await browser.newContext()).newPage();
  p.setDefaultTimeout(20000);
  await p.goto(BASE + '/register');
  await p.fill('input[name=name]', name);
  await p.fill('input[name=email]', email);
  await p.fill('input[name=password]', pw);
  await p.check('input[name=terms]');
  await p.click('form button');
  await p.waitForURL((x) => !x.pathname.startsWith('/register'));
  return p;
}

(async () => {
  const browser = await chromium.launch();
  const owner = await login(browser, 'agare@example.com', 'hemligtlosen1');
  const B = `${BASE}/c/1`;
  await owner.goto(B + '/integrationer');
  await owner.fill('input[name=name]', 'Byrå');
  for (const s of ['sales:write', 'accounting:read']) await owner.check(`input[name=scopes][value="${s}"]`);
  await owner.click('button:has-text("Skapa API-nyckel")');
  const token = (await owner.locator('.flash.ok code').textContent({ timeout: 10000 })).trim();
  const api = async (method, path, body) => {
    const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };

  // ================= Kortbetalning =================
  await owner.goto(B + '/installningar/betalningar');
  await owner.click('button:has-text("Koppla Stripe-konto")');
  await owner.waitForURL(/stripe=return/);
  let t = await text(owner);
  assert(t.includes('Aktivt') && t.includes('acct_test1'), 'kopplat konto: ' + t.slice(0, 1200));
  assert(calls.some((c) => c.url === '/v1/accounts' && c.p.type === 'standard' && c.p.country === 'SE') && calls.some((c) => c.url === '/v1/account_links' && c.p.type === 'account_onboarding'), 'Connect-anrop');
  log('Stripe-konto kopplat via Connect (standard, SE) och aktivt');

  const cust = await api('POST', '/customers', { name: 'Kortkund AB', email: 'kort@kund.example' });
  const inv = await api('POST', '/invoices', { customer_id: cust.json.id, invoice_date: '2026-11-15', book: true, lines: [{ description: 'Konsult', quantity: 1, unit_price: 100000, vat_rate: 25 }] });
  await owner.goto(`${B}/fakturor/${inv.json.id}`);
  await owner.fill('form:has(button:has-text("Skicka faktura")) input[name=to]', 'kort@kund.example');
  await owner.click('button:has-text("Skicka faktura")');
  await owner.waitForURL(/ok=/);
  const pub = decodeURIComponent(owner.url()).match(/(https?:\/\/[^\s&]+\/f\/[A-Za-z0-9_-]+)/)[1];
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(pub);
  await guest.click('button:has-text("Betala nu 1 250,00 kr")');
  await guest.waitForURL(/betalning=klar/);
  t = (await guest.locator('body').textContent()).replace(/\s+/g, ' ');
  assert(t.includes('Tack! Betalningen är mottagen'), 'tack-sida: ' + t.slice(0, 400));
  const co = calls.find((c) => c.url === '/v1/checkout/sessions');
  assert(co.account === 'acct_test1' && co.p.mode === 'payment' && co.p['line_items[0][price_data][unit_amount]'] === '125000' && co.p['line_items[0][price_data][currency]'] === 'sek'
    && co.p.customer_email === 'kort@kund.example' && co.p['metadata[invoice_id]'] === String(inv.json.id), 'checkout: ' + JSON.stringify(co));
  log('kunden klickar "Betala nu" på fakturalänken → Stripe Checkout på bolagets konto, 1 250 kr');

  assert((await connectHook(paid('cs_inv_1', 125000), 'whsec_fel')).status === 400, 'fel signatur nekas');
  let r = await connectHook(paid('cs_inv_1', 125000));
  assert(r.json.result === 'paid', 'webhook: ' + JSON.stringify(r));
  assert((await connectHook(paid('cs_inv_1', 125000))).json.result === 'duplicate', 'dubblett');
  const after = await api('GET', `/invoices/${inv.json.id}`);
  assert(after.json.status === 'paid', 'betald: ' + after.json.status);
  const bal = await api('GET', '/reports/balances?from=2026-01-01&to=2026-12-31');
  const row1580 = (bal.json.data ?? bal.json.accounts ?? bal.json).find((x) => x.account === 1580);
  assert(row1580 && row1580.change >= 125000, '1580: ' + JSON.stringify(row1580));
  await guest.goto(pub);
  t = (await guest.locator('body').textContent()).replace(/\s+/g, ' ');
  assert(t.includes('Betald') && !t.includes('Betala nu'), 'betald faktura utan knapp');
  log('webhook (signerad) bokför inbetalningen mot 1580, samma händelse två gånger ignoreras');

  // Betalning av redan betald faktura → kontrollera
  const inv2 = await api('POST', '/invoices', { customer_id: cust.json.id, invoice_date: '2026-11-15', book: true, lines: [{ description: 'Konsult', quantity: 1, unit_price: 40000, vat_rate: 25 }] });
  await owner.goto(`${B}/fakturor/${inv2.json.id}`);
  await owner.fill('form:has(button:has-text("Skicka faktura")) input[name=to]', 'kort@kund.example');
  await owner.click('button:has-text("Skicka faktura")');
  await owner.waitForURL(/ok=/);
  const pub2 = decodeURIComponent(owner.url()).match(/(https?:\/\/[^\s&]+\/f\/[A-Za-z0-9_-]+)/)[1];
  await guest.goto(pub2);
  await guest.click('button:has-text("Betala nu")');
  await guest.waitForURL(/betalning=klar/);
  await api('POST', `/invoices/${inv2.json.id}/payments`, { date: '2026-11-16' });
  assert((await connectHook(paid('cs_inv_2', 50000))).json.result === 'mismatch', 'mismatch');
  await owner.goto(B);
  assert((await text(owner)).includes('Kortbetalningar att kontrollera'), 'att göra');
  await owner.goto(B + '/installningar/betalningar');
  t = await text(owner);
  assert(t.includes('Att kontrollera') && t.includes(`Faktura ${inv2.json.number}`), 'kontrollista: ' + t.slice(-800));
  log('kortbetalning av redan betald faktura bokförs inte – visas för kontroll');

  // ================= Byrå =================
  const konsult = await register(browser, 'Kim Konsult', 'kim.byra@example.com', 'konsultlosen12');
  await konsult.goto(BASE + '/byra');
  await konsult.fill('input[name=name]', 'Siffror & Co Redovisning');
  await konsult.fill('input[name=orgnr]', '559000-0001');
  await konsult.click('button:has-text("Skapa byrå")');
  await waitMsg(konsult, 'Byrån är skapad');
  const code = (await konsult.locator('code.firm-code').textContent()).trim();
  assert(/^[A-Z0-9]{8}$/.test(code), 'byråkod: ' + code);
  assert((await konsult.goto(B)).status() === 404, 'ingen åtkomst innan klienten gett den');
  log('byrå skapad med kod', code);

  await owner.goto(B + '/installningar/byra');
  await owner.fill('input[name=code]', 'FELKOD00');
  await owner.click('button:has-text("Ge åtkomst")');
  await waitMsg(owner, 'Hittar ingen byrå');
  await owner.fill('input[name=code]', code.toLowerCase());
  await owner.click('button:has-text("Ge åtkomst")');
  await waitMsg(owner, 'Siffror & Co Redovisning har fått åtkomst');
  log('klienten ger byrån åtkomst med koden (fel kod nekas)');

  await konsult.goto(BASE + '/byra');
  t = await text(konsult);
  assert(t.includes('Testbolaget AB') && t.includes('Klienter (1)'), 'klientlista: ' + t.slice(0, 1500));
  await konsult.click('a:has-text("Testbolaget AB")');
  await konsult.waitForURL(/\/c\/1$/);
  t = await text(konsult);
  assert(t.includes('Testbolaget AB') && t.includes('Redovisningskonsult') && t.includes('← Byråvy'), 'konsult i bolaget: ' + t.slice(0, 800));
  await konsult.goto(B + '/installningar/byra');
  assert(await konsult.locator('button:has-text("Ge åtkomst")').count() === 0, 'konsulten kan inte ge åtkomst');
  log('byråvyn listar klienten; konsulten arbetar i bolaget som redovisningskonsult');

  // Fråga om en banktransaktion
  await konsult.goto(B + '/bank/avstamning');
  await konsult.locator('.card:has-text("ICA SUPERMARKET") a:has-text("Fråga kunden")').click();
  await konsult.waitForURL(/fragor\?entity=bank_transaction/);
  await konsult.fill('textarea[name=question]', 'Vad gäller köpet på ICA för 200 kr? Finns kvitto?');
  await konsult.click('button:has-text("Skicka fråga")');
  await waitMsg(konsult, 'Frågan är skickad');
  await owner.goto(B);
  t = await text(owner);
  assert(t.includes('Frågor att svara på'), 'att göra för kunden: ' + t.slice(0, 1500));
  await owner.goto(B + '/fragor');
  t = await text(owner);
  assert(t.includes('Vad gäller köpet på ICA') && t.includes('Kim Konsult (Siffror & Co Redovisning)') && t.includes('ICA SUPERMARKET'), 'fråga hos kunden: ' + t.slice(0, 1500));
  await owner.fill('textarea[name=answer]', 'Fika till kundmötet med Kortkund AB. Kvittot ligger i inkorgen.');
  await owner.click('button:has-text("Svara")');
  await waitMsg(owner, 'svaret är skickat');
  await konsult.goto(BASE + '/byra');
  t = await text(konsult);
  assert(t.includes('0 obesvarade, 1 nya svar'), 'nya svar i byråvyn: ' + t.slice(0, 1500));
  await konsult.goto(B + '/fragor');
  t = await text(konsult);
  assert(t.includes('Fika till kundmötet') && t.includes('Svar av Ägare'), 'svaret: ' + t.slice(0, 1500));
  await konsult.click('button:has-text("Klar – avsluta")');
  await waitMsg(konsult, 'Frågan är avslutad');
  log('konsulten frågar om en banktransaktion, kunden svarar, svaret syns i byråvyn');

  // Kollega och ansvarig
  await konsult.goto(BASE + '/byra');
  await konsult.fill('input[name=email]', 'kalle.byra@example.com');
  await konsult.click('button:has-text("Skapa inbjudan")');
  await konsult.waitForURL(/ok=/);
  const link = decodeURIComponent(konsult.url()).match(/(https?:\/\/[^\s&]+\/byra\/inbjudan\/[A-Za-z0-9_-]+)/)[1];
  const kollega = await register(browser, 'Kalle Kollega', 'kalle.byra@example.com', 'kollegalosen12');
  await kollega.goto(link);
  await kollega.click('button:has-text("Gå med i byrån")');
  await waitMsg(kollega, 'Välkommen till byrån');
  assert((await text(kollega)).includes('Testbolaget AB'), 'kollegan ser klienten');
  await konsult.goto(BASE + '/byra');
  await konsult.selectOption('select[name=responsible]', { label: 'Kim Konsult' });
  await konsult.click('form:has(select[name=responsible]) button');
  await konsult.waitForURL(/byra\?f=\d+$/);
  await konsult.goto(BASE + '/byra?mina=1');
  assert((await text(konsult)).includes('Testbolaget AB'), 'mina klienter');
  await kollega.goto(BASE + '/byra?mina=1');
  assert((await text(kollega)).includes('Inga klienter ännu'), 'kollegans egna klienter');
  log('kollega inbjuden via länk; ansvarig konsult och filtret "Mina"');

  await owner.goto(B + '/installningar/byra');
  await owner.click('button:has-text("Ta bort åtkomst")');
  await waitMsg(owner, 'åtkomst är borttagen');
  assert((await konsult.goto(B)).status() === 404, 'åtkomsten borta');
  log('klienten tar bort byråns åtkomst');

  await browser.close();
  stripe.close();
  console.log('Alla tester för kortbetalning och byråvy gick igenom');
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
