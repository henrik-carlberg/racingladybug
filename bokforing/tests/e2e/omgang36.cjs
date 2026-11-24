// E2E omgång 36: försäkringsöversikt, leverantörsabonnemang, IT-utrustning, sanktionsavgifter, immateriella rättigheter
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

  // ================= Del 1: försäkringsöversikt =================
  const FO = await newCompany('Försäkrat AB', 559610000);
  const now = new Date();
  const pStart = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)));
  const pEnd = iso(new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth() - 2, 0)));
  if (Number(pStart.slice(0, 4)) < YEAR) await addFy(FO, YEAR - 1);
  await voucher(FO, 'Företagsförsäkring Trygg', [[6310, 12000], [1930, -12000]], pStart);
  const addPolicy = async (kind, insurer, premium, start, end, reclass) => {
    await owner.goto(FO + '/forsakringar');
    const f = owner.locator('form.ins-add');
    await f.locator('input[name=kind]').fill(kind); await f.locator('input[name=insurer]').fill(insurer); await f.locator('input[name=premium]').fill(premium);
    await f.locator('input[name=start_date]').fill(start); await f.locator('input[name=end_date]').fill(end); await f.locator('input[name=deductible]').fill('5000');
    if (reclass) await f.locator('input[name=reclass]').check();
    await f.locator('button').click(); await owner.locator('text=Försäkringen är registrerad').waitFor();
  };
  await addPolicy('Företagsförsäkring', 'Trygg Försäkring', '12000', pStart, pEnd, true);
  await addPolicy('Ansvarsförsäkring', 'Säker AB', '3000', day(330), day(-30), false);
  await owner.goto(FO + '/forsakringsskador');
  await owner.fill('input[name=description]', 'Vattenskada i lagret'); await owner.fill('input[name=insurer]', 'Trygg Försäkring');
  await owner.selectOption('select[name=kind]', 'other'); await owner.click('button:has-text("Anmäl skada")'); await owner.locator('text=Skadan är registrerad').waitFor();
  await owner.goto(FO + '/forsakringar');
  t = nb(await owner.locator('.ins-renewal').innerText()); assert(t.includes('AnsvarsförsäkringhosSäkerAB') && t.includes('om30dagar'), 'förnyelsepåminnelse: ' + t);
  assert(nb(await owner.locator('.ins-pending').innerText()) === '3000,00', 'att periodisera 3 av 12 månader');
  assert(nb(await owner.locator('.ins-row[data-kind="Företagsförsäkring"] .ins-claims').innerText()).includes('Vattenskadailagret'), 'skadeärendet kopplat');
  await owner.click('button:has-text("Periodisera premierna")'); await owner.locator('text=av premierna är kostnadsförda').waitFor();
  assert(nb(await owner.locator('.ins-row[data-kind="Företagsförsäkring"] .ins-recognized').innerText()) === '3000,00', 'kostnadsfört');
  await owner.goto(FO + '/verifikationer');
  await owner.locator('tr:has-text("Periodisering av försäkringspremier") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('6310') && t.includes('1790') && t.includes('3000,00'), 'periodisering 6310/1790: ' + t.slice(0, 600));
  await owner.goto(FO + '/forsakringar');
  const rf = owner.locator('.ins-row[data-kind="Ansvarsförsäkring"] form');
  await rf.locator('input[name=premium]').fill('3600'); await rf.locator('input[name=end_date]').fill(day(-395)); await rf.locator('button').click();
  await owner.locator('text=Försäkringen är förnyad').waitFor();
  assert(await owner.locator('.ins-renewal').count() === 0, 'påminnelsen försvinner efter förnyelse');
  assert(await owner.locator('.ins-row[data-kind="Ansvarsförsäkring"]').count() === 2, 'ny period');
  log('försäkringsöversikt: premie förs om till 1790 och periodiseras per månad, förnyelsepåminnelse, förnyelse med ny period, kopplade skadeärenden');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 36: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
