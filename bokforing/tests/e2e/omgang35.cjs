// End-to-end, omgång 35: anbud och ramavtal, scenarioplanering, evenemang, avgångsvederlag och uppsägning, leverantörsbedömning.
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

  // ================= Del 1: anbud och ramavtal =================
  const AN = await newCompany('Städtjänst AB', 559950000);
  if (Number(day(5).slice(0, 4)) !== YEAR) await addFy(AN, YEAR - 1);
  await owner.goto(AN + '/kunder');
  await owner.fill('input[name=name]', 'Kommunen'); await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  for (const [title, cost, bid] of [['Skolstädning', '800000', '1000000'], ['Parkskötsel', '400000', '500000']]) {
    await owner.goto(AN + '/anbud');
    const f = owner.locator('form:has(button:has-text("Registrera anbud"))');
    await f.locator('input[name=title]').fill(title); await f.locator('input[name=due_date]').fill(day(-5)); await f.locator('input[name=cost]').fill(cost); await f.locator('input[name=bid]').fill(bid);
    await f.locator('button').click(); await owner.locator('text=Anbudet är registrerat').waitFor();
  }
  for (const [title, st] of [['Skolstädning', 'won'], ['Parkskötsel', 'lost']]) {
    await owner.goto(AN + '/anbud');
    const r = owner.locator(`.tn-row[data-title="${title}"]`);
    await r.locator('select[name=status]').selectOption(st); await r.locator('button:has-text("Spara")').click(); await owner.locator('text=Anbudets status är uppdaterad').waitFor();
  }
  assert(nb(await owner.locator('.tn-winrate').innerText()) === '50%', 'vinstprocent');
  const af = owner.locator('form:has(button:has-text("Lägg upp ramavtal"))');
  await af.locator('select[name=tender_id]').selectOption({ label: 'Skolstädning' }); await af.locator('input[name=cap]').fill('100000');
  await af.locator('input[name=start_date]').fill(day(30)); await af.locator('input[name=end_date]').fill(day(-30));
  await af.locator('button').click(); await owner.locator('text=Ramavtalet är upplagt').waitFor();
  await invoice(AN, 'Kommunen', 85000, day(5));
  await invoice(AN, 'Kommunen', 20000, day(4));
  const fa = () => owner.locator('.fa-row[data-name="Skolstädning"]');
  await owner.goto(AN + '/anbud');
  assert(await fa().locator('.fa-expiring').count() === 1, 'avtalet löper ut snart');
  await fa().locator('select[name=invoice_id]').selectOption({ index: 1 }); await fa().locator('button:has-text("Koppla avrop")').click();
  await owner.locator('text=85 % av taket är avropat. Varningsgränsen är passerad').waitFor();
  await fa().locator('button:has-text("Koppla avrop")').click(); await owner.locator('text=105 % av taket är avropat. Taket är nått').waitFor();
  assert(nb(await fa().locator('.fa-left').innerText()).replace('−', '-') === '-5000,00' && nb(await fa().locator('.fa-level').innerText()) === 'Taketärnått', 'över taket');
  await fa().locator('input[name=end_date]').fill(`${YEAR + 2}-12-31`); await fa().locator('button:has-text("Förläng")').click(); await owner.locator('text=Avtalet är förlängt').waitFor();
  assert(await fa().locator('.fa-expiring').count() === 0, 'förlängt');
  log('anbud och ramavtal: anbud med kalkyl och vinstprocent, vunnet anbud blir ramavtal, avrop mot takbelopp med varning vid 80 % och 100 %, förlängning');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 35: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
