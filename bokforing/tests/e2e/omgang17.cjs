// End-to-end, omgång 17: koncernredovisning, fåmansföretag och 3:12, hotell och restaurang, tid till lön och faktura, bokslutspärm.
const { chromium } = require('playwright');
const http = require('node:http');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const text = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); const sel = (await page.locator('main').count()) ? 'main' : 'body'; return (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').replace(/ /g, ' '); };
const iso = (d) => d.toISOString().slice(0, 10);
const day = (n) => iso(new Date(Date.now() - n * 864e5));
const YEAR = new Date().getFullYear();
const MONTH = new Date().getMonth() + 1;

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

const mailServer = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"m1"}'); }); }).listen(3303);

const luhn = (s) => { let sum = 0; for (let i = 0; i < s.length; i++) { let v = Number(s[s.length - 1 - i]); if (i % 2 === 1) { v *= 2; if (v > 9) v -= 9; } sum += v; } return sum % 10 === 0; };
const orgnrFor = (prefix) => { for (let i = 0; i < 10; i++) { const s = prefix + String(i); if (luhn(s)) return `${s.slice(0, 6)}-${s.slice(6)}`; } };

(async () => {
  const browser = await chromium.launch();
  const owner = await login(browser, 'agare@example.com', 'hemligtlosen1');
  let t;
  const nb = (s) => s.replace(/[\s  ]/g, '');

  const newCompany = async (name, prefix) => {
    await owner.goto(BASE + '/');
    await owner.fill('input[name=name]', name);
    await owner.selectOption('select[name=company_type]', 'AB');
    await owner.fill('input[name=orgnr]', orgnrFor(String(prefix + (Date.now() % 900000)).slice(0, 9)));
    await owner.fill('input[name=fy_start]', `${YEAR}-01-01`); await owner.fill('input[name=fy_end]', `${YEAR}-12-31`);
    await owner.click('button:has-text("Skapa bolag")');
    await owner.waitForURL(/kom-igang/);
    return owner.url().replace(/\/kom-igang.*/, '');
  };
  const invoice = async (B, customer, amount, dateStr = day(1)) => {
    await owner.goto(B + '/fakturor/ny');
    await owner.selectOption('select[name=customer_id]', { label: customer });
    await owner.fill('input[name=invoice_date]', dateStr);
    const r0 = owner.locator('tbody tr').first();
    await r0.locator('td:nth-child(1) input').fill('Varor'); await r0.locator('td:nth-child(2) input').fill('1');
    await r0.locator('td:nth-child(3) input').fill('st'); await r0.locator('td:nth-child(4) input').fill(String(amount));
    await owner.click('button:has-text("Spara utkast")');
    await owner.waitForURL(/fakturor\/\d+\?ok/);
    await owner.click('button:has-text("Bokför faktura")');
    await owner.locator('text=Fakturan är bokförd').waitFor();
  };

  // ================= Del 1: koncernredovisning =================
  const MO = await newCompany('Koncerntest Moder AB', 559500000);
  const DO = await newCompany('Koncerntest Dotter AB', 559600000);
  const idOf = (u) => u.split('/c/')[1];
  const KQ = `/koncern?c=${idOf(MO)}&c=${idOf(DO)}&moder=${idOf(MO)}&from=${YEAR}-01-01&to=${YEAR}-12-31`;
  await owner.goto(BASE + KQ);
  const gl = owner.locator('form.group-link');
  await gl.locator('input[name=ownership]').fill('80');
  await gl.locator('input[name=acquisition_cost]').fill('1000000');
  await gl.locator('input[name=acquired_equity]').fill('500000');
  await gl.locator('input[name=acquired_on]').fill(`${YEAR - 1}-01-01`);
  await gl.locator('input[name=surplus]').fill('200000'); await gl.locator('input[name=surplus_years]').fill('20');
  await gl.locator('input[name=goodwill_years]').fill('5');
  await gl.locator('input[name=intra_inventory]').fill('100000'); await gl.locator('input[name=intra_inventory_opening]').fill('40000'); await gl.locator('input[name=intra_margin]').fill('25');
  await gl.locator('button:has-text("Koppla som dotterbolag")').click();
  await owner.locator('text=Koncernuppgifterna är sparade').waitFor();
  const acq = owner.locator('tr.acq-row');
  assert(nb(await acq.locator('.acq-gw').innerText()) === '472960,00', 'goodwill: ' + await acq.innerText());
  const dep = Number(nb(await acq.locator('.acq-dep').innerText()).replace(',', '.'));
  assert(dep > 100000 && dep < 106000, 'periodens avskrivning ≈ 472 960/5 + 200 000/20: ' + dep);
  t = await owner.locator('.elims').innerText();
  assert(t.includes('Övervärde Koncerntest Dotter AB') && t.includes('Internvinst i lager Koncerntest Dotter AB') && nb(t).includes('25000,00') && t.includes('Avskrivning goodwill och övervärden'), 'elimineringar: ' + t);
  log('förvärvsanalys: övervärde med uppskjuten skatt, goodwill 472 960 kr som skrivs av från förvärvsdagen, minoritet 20 % och internvinst i lager');

  //@@NEXT@@
  await browser.close(); mailServer.close();
  console.log('Omgång 17: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
