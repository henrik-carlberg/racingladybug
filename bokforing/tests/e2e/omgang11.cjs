// End-to-end, omgång 11: kundkännedom, bedrägeriskydd, Kivra, inköp med matchning, lön del 2.
const { chromium } = require('playwright');
const http = require('node:http');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const text = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); const sel = (await page.locator('main').count()) ? 'main' : 'body'; return (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').replace(/ /g, ' '); };
const iso = (d) => d.toISOString().slice(0, 10);
const day = (n) => iso(new Date(Date.now() - n * 864e5));

async function login(browser, email, password) {
  const p = await (await browser.newContext()).newPage();
  p.setDefaultTimeout(20000);
  await p.goto(BASE + '/login');
  await p.fill('input[name=email]', email);
  await p.fill('input[name=password]', password);
  await p.click('form button:has-text("Logga in")');
  await p.waitForURL(BASE + '/');
  return p;
}

// Bolagsverket: verkliga huvudmän
const bvServer = http.createServer((req, res) => {
  const send = (c, j) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (req.headers.authorization !== 'Bearer bv-info') return send(401, {});
  if (req.url === '/foretag/5560269986/verkliga-huvudman') return send(200, { huvudman: [{ namn: 'Ägare Testsson', fodelsear: 1980, omfattning: 'Mer än 75 %', grund: 'Ägande' }] });
  send(404, {});
}).listen(3311);

// E-post (Resend)
const mails = [];
const mailServer = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { mails.push(JSON.parse(b)); } catch {} res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"m1"}'); }); }).listen(3303);

(async () => {
  const browser = await chromium.launch();
  const owner = await login(browser, 'agare@example.com', 'hemligtlosen1');
  const byra = await login(browser, 'bo.byra.omg7@example.com', 'byralosen123');
  const B = `${BASE}/c/1`;
  let t;

  // ================= Del 1: byrån och penningtvättslagen =================
  await byra.goto(BASE + '/byra');
  t = await text(byra);
  assert(t.includes('saknar aktuell kundkännedom') && t.includes('Kundkännedom'), 'byrån ser att kundkännedom saknas: ' + t.slice(0, 1200));
  await byra.click('tr:has-text("Testbolaget AB") .kyc-cell a');
  await byra.locator('.kyc-status:has-text("Saknas")').waitFor();
  await byra.click('button:has-text("Spara bedömning")');
  await byra.selectOption('select[name=pep]', 'no');
  await byra.selectOption('select[name=identified]', 'bankid');
  await byra.fill('input[name=purpose]', 'Löpande bokföring och bokslut');
  await byra.click('button:has-text("Spara bedömning")');
  await byra.locator('text=Hämta verkliga huvudmän från Bolagsverket först').waitFor();
  await byra.click('button:has-text("Hämta från Bolagsverket")');
  await byra.locator('text=1 verkliga huvudmän hämtade från Bolagsverket').waitFor();
  assert((await text(byra)).includes('Mer än 75 %'), 'huvudmännen visas');
  log('verkliga huvudmän hämtas från Bolagsverkets register; bedömning kräver dem');

  await byra.check('input[name=factor][value=cash]');
  await byra.selectOption('select[name=pep]', 'no');
  await byra.selectOption('select[name=identified]', 'bankid');
  await byra.fill('input[name=purpose]', 'Löpande bokföring och bokslut');
  await byra.click('button:has-text("Spara bedömning")');
  await byra.locator('text=/normal risk, görs om senast \\d{4}-\\d{2}-\\d{2}/').waitFor();
  t = await text(byra);
  assert(t.includes('Aktuell') && /Risk Normal/.test(t), 'bedömd: ' + t.slice(0, 800));
  await byra.selectOption('select[name=pep]', 'yes');
  await byra.fill('input[name=pep_details]', 'Styrelseledamot är kommunalråd');
  await byra.click('button:has-text("Spara bedömning")');
  await byra.locator('text=/hög risk/').waitFor();
  assert((await byra.locator('.owners').count()) === 1 && (await text(byra)).includes('Historik'), 'historik');
  log('riskbedömning med faktorer och PEP (alltid hög risk) ger datum för ny bedömning; historiken sparas');

  await byra.goto(`${BASE}/byra/kyc?f=2&c=1`);
  await byra.fill('input[name=fee]', '2 500 kr per månad exkl. moms');
  await byra.check('input[name=service][value=payroll]');
  await byra.click('button:has-text("Skicka uppdragsbrev för e-signering")');
  await byra.locator('.flash.error, .flash:has-text("Uppdragsbrevet är skickat")').first().waitFor();
  assert((await text(byra)).includes('Uppdragsbrevet är skickat för signering'), 'uppdragsbrev: ' + (await text(byra)).slice(0, 600));
  assert((await text(byra)).includes('Väntar på signering'), 'uppdragsbrevet väntar');
  await owner.goto(B + '/dokument');
  t = await text(owner);
  assert(t.includes('Uppdragsbrev Byråsson Redovisning – Testbolaget AB'), 'kunden ser uppdragsbrevet: ' + t.slice(0, 1200));
  await byra.goto(BASE + '/byra');
  assert(!(await byra.locator('.kyc-banner').count()) && (await byra.locator('tr:has-text("Testbolaget AB") .kyc-cell .badge:has-text("Aktuell")').count()) === 1, 'översikten aktuell');
  const other = await login(browser, 'kim.byra@example.com', 'konsultlosen12');
  const r = await other.goto(`${BASE}/byra/kyc?f=2&c=1`);
  assert(r.status() === 404, 'annan byrå kommer inte åt kundkännedomen');
  log('uppdragsbrev skickas för e-signering till kundens ägare; översikten visar status; andra byråer kommer inte åt uppgifterna');

  //@@NEXT@@
  await browser.close(); bvServer.close(); mailServer.close();
  console.log('Omgång 11: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
