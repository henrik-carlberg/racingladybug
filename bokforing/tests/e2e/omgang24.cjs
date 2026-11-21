// End-to-end, omgång 24: likvidation, medarbetarlån och löneväxling, licensintäkter, revisionsberättelse, kontantmetoden.
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

const viesServer = http.createServer((req, res) => {
  const m = /\/ms\/([A-Z]{2})\/vat\/([0-9A-Z]+)/.exec(req.url || '');
  const ok = m && m[1] === 'DE' && m[2] === '123456789';
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ isValid: !!ok, name: ok ? 'EU KUND GMBH' : '---', address: ok ? 'Berlin' : '---', userError: ok ? 'VALID' : 'INVALID' }));
}).listen(3320);
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

  const voucher = async (B, desc, rows, d = day(1)) => {
    await owner.goto(B + '/verifikationer/ny');
    await owner.fill('input[name=date]', d);
    await owner.fill('input[name=description]', desc);
    for (let i = 0; i < rows.length; i++) {
      if (i >= 2) await owner.click('button:has-text("+ Rad")');
      const r = owner.locator('tbody tr').nth(i);
      await r.locator('td:nth-child(1) input').fill(String(rows[i][0]));
      if (rows[i][1] > 0) await r.locator('td:nth-child(3) input').fill(String(rows[i][1]));
      else await r.locator('td:nth-child(4) input').fill(String(-rows[i][1]));
    }
    await owner.click('button:has-text("Bokför")');
    await owner.waitForURL(/verifikationer\/\d+/).catch(async (e) => { throw new Error('verifikation: ' + (await text(owner)).slice(0, 600)); });
  };

  const addFy = async (B, y) => {
    await owner.goto(B + '/installningar');
    await owner.fill('form:has(button:has-text("Lägg till")) input[name=start]', `${y}-01-01`);
    await owner.fill('form:has(button:has-text("Lägg till")) input[name=end]', `${y}-12-31`);
    await owner.click('form:has(input[name=end]) button:has-text("Lägg till")');
    await owner.locator('text=Räkenskapsåret är tillagt').waitFor();
  };

  // ================= Del 1: skifte vid likvidation =================
  const LQ = await newCompany('Avvecklingen AB', 559210000);
  await voucher(LQ, 'Aktiekapital inbetalt', [[1930, 25000], [2081, -25000]], `${YEAR}-01-02`);
  await voucher(LQ, 'Försäljning', [[1930, 10000], [8310, -10000]], `${YEAR}-01-03`);
  await voucher(LQ, 'Inventarier', [[1220, 5000], [1930, -5000]], `${YEAR}-01-03`);
  await owner.goto(LQ + '/agare');
  for (const [n, sh, cb] of [['Anna Ägare', '60', '15000'], ['Bo Ägare', '40', '10000']]) {
    const of = owner.locator('form:has(button:has-text("Lägg till ägare"))');
    await of.locator('input[name=name]').fill(n); await of.locator('input[name=share_pct]').fill(sh); await of.locator('input[name=cost_basis]').fill(cb);
    await of.locator('button:has-text("Lägg till ägare")').click();
    await owner.locator('text=Ägaren är sparad').waitFor();
    await owner.goto(LQ + '/agare');
  }
  await owner.goto(LQ + '/kontrollbalans');
  await owner.click('summary:has-text("Frivillig likvidation")');
  await owner.fill('input[name=decided_on]', `${YEAR}-01-05`);
  await owner.fill('input[name=liquidator]', 'Lisa Likvidator');
  await owner.click('button:has-text("Registrera likvidationsbeslut")');
  await owner.locator('text=Likvidationsbeslutet är registrerat').waitFor();
  await owner.selectOption('.cb-liquidation select[name=step]', 'creditor_notice_on');
  await owner.fill('form:has(select[name=step]) input[name=date]', `${YEAR}-01-10`);
  await owner.click('.cb-liquidation button:has-text("Registrera")');
  await owner.locator('text=Steget är registrerat').waitFor();
  const skifte = async (d) => {
    await owner.goto(LQ + '/kontrollbalans');
    await owner.fill('form:has(button:has-text("Bokför skifte")) input[name=date]', d);
    await owner.click('button:has-text("Bokför skifte till ägarna")');
    await owner.locator('.flash').first().waitFor();
    return owner.locator('.flash').first().innerText();
  };
  assert((await skifte(`${YEAR}-06-01`)).includes('Skifte kan ske tidigast'), 'skifte före borgenärstiden nekas');
  assert((await skifte(`${YEAR}-07-15`)).includes('konto 1220'), 'osålda tillgångar stoppar skiftet');
  await voucher(LQ, 'Inventarier sålda', [[1930, 5000], [1220, -5000]], `${YEAR}-07-01`);
  t = await skifte(`${YEAR}-07-15`); assert(nb(t).includes("Skiftetärbokfört:35000,00kr"), "skiftet bokfört: " + t);
  await owner.goto(LQ + '/kontrollbalans');
  assert(nb(await owner.locator('.lq-row[data-name="Anna Ägare"] .lq-gain').innerText()) === '6000,00' && nb(await owner.locator('.lq-row[data-name="Bo Ägare"] .lq-gain').innerText()) === '4000,00', 'kapitalvinst per ägare');
  assert(await owner.locator('.lq-checklist li').count() === 4 && !(await owner.locator('button:has-text("Bokför skifte")').count()), 'checklista, inget nytt skifte');
  log('likvidation: skifte först efter borgenärstiden och när tillgångarna är sålda, 35 000 kr fördelas 60/40 med kapitalvinst 6 000 och 4 000 kr');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 24: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
