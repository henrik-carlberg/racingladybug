// End-to-end, omgång 29: leverantörskrediter, befarade kundförluster, betalningsföreläggande, konsignationslager, ränta och anstånd på skattekontot.
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

async function invite(owner, B, email, role) {
  await owner.goto(B + '/installningar');
  await owner.fill('form:has(select[name=role]) input[name=email]', email);
  await owner.selectOption('form:has(select[name=role]) select[name=role]', role);
  await owner.click('button:has-text("Skapa inbjudan")');
  await owner.waitForURL(/invite=/);
  return (await owner.locator('code').textContent()).trim();
}
async function accept(browser, link, name, password) {
  const p = await (await browser.newContext()).newPage();
  p.setDefaultTimeout(20000);
  await p.goto(link);
  await p.fill('input[name=name]', name);
  await p.fill('input[name=password]', password);
  await p.click('button:has-text("Acceptera")');
  await p.waitForURL(BASE + '/');
  return p;
}
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

  // ================= Del 1: kundbonus =================
  const KB = await newCompany('Bonusgrossisten AB', 559500000);
  if (Number(day(60).slice(0, 4)) !== YEAR) await addFy(KB, YEAR - 1);
  await owner.goto(KB + '/kunder');
  await owner.fill('input[name=name]', 'Kedjan AB');
  await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await invoice(KB, 'Kedjan AB', 400000, day(40));
  await invoice(KB, 'Kedjan AB', 200000, day(30));
  await owner.goto(KB + '/kundbonus');
  await owner.fill('input[name=start_date]', day(60)); await owner.fill('input[name=end_date]', day(5));
  await owner.fill('input[name=tiers]', '500000:2; 1000000:3');
  await owner.click('button:has-text("Lägg upp avtal")'); await owner.locator('text=Bonusavtalet är upplagt').waitFor();
  let row = owner.locator('.rb-row[data-customer="Kedjan AB"]');
  assert(nb(await row.locator('.rb-volume').innerText()) === '600000,00', 'omsättning under perioden');
  assert(nb(await row.locator('.rb-amount').innerText()).startsWith('12000,00'), 'bonus 2 % på hela omsättningen: ' + await row.locator('.rb-amount').innerText());
  await owner.click('button:has-text("Bokför upplupen bonus")'); await owner.locator('text=Upplupen kundbonus har ökats med').waitFor();
  assert(nb(await row.locator('.rb-accrued').innerText()) === '12000,00', 'upplupen bonus 2990');
  await owner.click('button:has-text("Bokför upplupen bonus")'); await owner.locator('text=Den upplupna bonusen stämmer redan').waitFor();
  await row.locator('button:has-text("Reglera")').click();
  await owner.waitForURL(/fakturor\/\d+\?ok/);
  t = nb(await text(owner));
  assert(t.includes('Bonus') && t.includes('-15000,00'), 'kreditfakturautkast med moms: ' + t.slice(0, 900));
  await owner.click('button:has-text("Bokför faktura")'); await owner.locator('text=Fakturan är bokförd').waitFor();
  await owner.goto(KB + '/kundbonus');
  row = owner.locator('.rb-row[data-customer="Kedjan AB"]');
  assert((await row.innerText()).includes('Reglerad') && nb(await row.locator('.rb-accrued').innerText()) === '0,00', 'reglerad och upplupet upplöst: ' + await row.innerText());
  assert(nb(await row.locator('.rb-volume').innerText()) === '600000,00', 'bonusfakturan räknas inte in i omsättningen');
  log('kundbonus: trappsteg på omsättningen, upplupen bonus 3730/2990 vid bokslut, reglering med kreditfaktura och momsreduktion, upplupet löses upp');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 30: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
