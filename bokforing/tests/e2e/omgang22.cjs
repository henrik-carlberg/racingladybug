// End-to-end, omgång 22: låneförbudet, fastighetsförsäljning, ersättningsfond, styrelsearvoden, internprissättning.
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
    await owner.waitForURL(/verifikationer\/\d+/);
  };

  const addFy = async (B, y) => {
    await owner.goto(B + '/installningar');
    await owner.fill('form:has(button:has-text("Lägg till")) input[name=start]', `${y}-01-01`);
    await owner.fill('form:has(button:has-text("Lägg till")) input[name=end]', `${y}-12-31`);
    await owner.click('form:has(input[name=end]) button:has-text("Lägg till")');
    await owner.locator('text=Räkenskapsåret är tillagt').waitFor();
  };

  // ================= Del 1: låneförbudet =================
  const LF = await newCompany('Ägarlån AB', 559110000);
  await voucher(LF, 'Uttag till ägaren', [[1685, 80000], [1930, -80000]], `${YEAR}-02-01`);
  await owner.goto(LF + '/lan-till-agare');
  assert(nb(await owner.locator('.ol-unregistered').innerText()) === '80000,00', 'saldo utan registrerat lån');
  const addL = async (borrower, relation, purpose, amount) => {
    await owner.goto(LF + '/lan-till-agare');
    await owner.fill('input[name=borrower]', borrower); await owner.selectOption('select[name=relation]', relation);
    await owner.selectOption('form:has(input[name=borrower]) select[name=purpose]', purpose); await owner.fill('form:has(input[name=borrower]) input[name=amount]', amount);
    await owner.fill('form:has(input[name=borrower]) input[name=loan_date]', `${YEAR}-02-01`);
    await owner.click('button:has-text("Registrera lån")');
    await owner.locator('text=Lånet är registrerat').waitFor();
  };
  await addL('Olle Ägare', 'owner', 'private', '80000');
  await addL('Ägarens Konsult AB', 'related_company', 'business', '50000');
  assert(await owner.locator('.ol-row[data-borrower="Olle Ägare"] .badge.danger').count() === 1 && (await owner.locator('.ol-row[data-borrower="Olle Ägare"]').innerText()).includes('beskattas lånet som inkomst av tjänst'), 'förbjudet lån till ägaren');
  assert(await owner.locator('.ol-row[data-borrower="Ägarens Konsult AB"] .badge.ok').count() === 1, 'näringslån tillåtet');
  assert(nb(await owner.locator('.ol-prohibited').innerText()) === '80000,00' && nb(await owner.locator('.ol-unregistered').innerText()) === '0,00', 'summor');
  await owner.goto(LF + '/bokslut');
  await owner.locator(`tr:has-text("${YEAR}-01-01") a:has-text("Öppna")`).first().click();
  await owner.waitForURL(/bokslut\/\d+/);
  await owner.goto(owner.url().split('?')[0] + '/kontroller');
  assert((await owner.$$eval('.qc-finding', (els) => els.map((e) => e.getAttribute('data-key')))).includes('loan:prohibited'), 'förbjudet lån bland kontrollerna före bokslut');
  await owner.goto(LF + '/lan-till-agare');
  const olle = owner.locator('.ol-row[data-borrower="Olle Ägare"]');
  await olle.locator('select[name=kind]').selectOption('dividend');
  await olle.locator('button:has-text("Reglera")').click();
  await owner.locator('text=Det finns inte så mycket beslutad').waitFor();
  await owner.locator('.ol-row[data-borrower="Olle Ägare"] button:has-text("Reglera")').click();
  await owner.locator('text=80 000,00 kr av lånet är reglerat').waitFor();
  assert(nb(await owner.locator('.ol-prohibited').innerText()) === '0,00', 'återbetalt');
  log('låneförbudet: lån till ägaren är förbjudet och beskattas som lön i fåmansföretag, näringslån till bolag tillåtet, återbetalning och kontroll före bokslut');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 22: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
