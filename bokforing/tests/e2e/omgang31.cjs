// End-to-end, omgång 31: returer och reklamationer, punktskatter, försäkringsskador, körjournal, koncernkonto.
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

  // ================= Del 1: returer och reklamationer =================
  const RT = await newCompany('Returbutiken AB', 559600000);
  await owner.goto(RT + '/moduler');
  await owner.locator('.card:has(h2:text-is("Inköp, lager och logistik")) button:has-text("Aktivera")').click(); await owner.waitForURL(/ok=/);
  await owner.goto(RT + '/m/lager/artiklar');
  await owner.fill('input[name=sku]', 'A-1'); await owner.fill('input[name=name]', 'Kaffebryggare');
  await owner.fill('input[name=purchase_price]', '200'); await owner.fill('input[name=sales_price]', '500'); await owner.fill('input[name=opening_qty]', '10');
  await owner.click('button:has-text("Lägg upp artikel")'); await owner.locator('text=Artikeln är upplagd').waitFor();
  await owner.goto(RT + '/kunder');
  await owner.fill('input[name=name]', 'Reklamerande Kund AB');
  await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await owner.goto(RT + '/fakturor/ny');
  await owner.selectOption('select[name=customer_id]', { label: 'Reklamerande Kund AB' });
  await owner.fill('input[name=invoice_date]', day(5));
  let r0 = owner.locator('tbody tr').first();
  await r0.locator('td:nth-child(1) input').fill('A-1 Kaffebryggare'); await r0.locator('td:nth-child(2) input').fill('4');
  await r0.locator('td:nth-child(3) input').fill('st'); await r0.locator('td:nth-child(4) input').fill('500');
  await owner.click('button:has-text("Spara utkast")'); await owner.waitForURL(/fakturor\/\d+\?ok/);
  await owner.click('button:has-text("Bokför faktura")'); await owner.locator('text=Fakturan är bokförd').waitFor();
  const stock = async () => { await owner.goto(RT + '/m/lager/artiklar'); return nb(await owner.locator('tr:has-text("Kaffebryggare") td:nth-child(3)').innerText()); };
  const newReturn = async (qty, reason) => {
    await owner.goto(RT + '/fakturor/returer');
    await owner.selectOption('select[name=invoice]', { index: 1 }); await owner.click('button:has-text("Visa rader")');
    await owner.locator('.rt-line input').fill(qty); await owner.selectOption('select[name=reason]', reason);
    await owner.click('button:has-text("Registrera retur")'); await owner.locator('text=Returärendet är registrerat').waitFor();
  };
  await newReturn('5', 'defect').catch(() => {});
  await owner.locator('text=Högst 4 st').waitFor();
  await newReturn('2', 'defect');
  let rrow = owner.locator('.rt-row[data-status="received"]');
  assert(nb(await rrow.locator('.rt-value').innerText()) === '1000,00', 'returvärde exkl. moms');
  await rrow.locator('form:has(button:has-text("Kreditera")) button').click();
  await owner.waitForURL(/fakturor\/\d+\?ok/); await owner.locator('text=2 tillbaka i lager').waitFor();
  t = nb(await text(owner));
  assert(t.includes('Retur:A-1Kaffebryggare') && t.includes('-1250,00'), 'kreditfakturautkast med moms: ' + t.slice(0, 900));
  await owner.click('button:has-text("Bokför faktura")'); await owner.locator('text=Fakturan är bokförd').waitFor();
  assert(await stock() === '12st', 'två tillbaka i lager');
  await newReturn('1', 'damaged');
  rrow = owner.locator('.rt-row[data-status="received"]');
  await rrow.locator('form:has(button:has-text("Skicka ersättningsvara")) select').selectOption('scrap');
  await rrow.locator('button:has-text("Skicka ersättningsvara")').click(); await owner.locator('text=Ersättningsvara skickad utan ny faktura').waitFor();
  t = nb(await owner.locator('.flash').first().innerText()); assert(t.includes('1levereradeurlagret') && t.includes('1kasserade'), 'ersättning: ' + t);
  assert(await stock() === '11st', 'ersättningsvaran har lämnat lagret, den trasiga är kasserad');
  await newReturn('1', 'regret');
  rrow = owner.locator('.rt-row[data-status="received"]');
  await rrow.locator('input[name=note]').fill('Ångerfristen har gått ut'); await rrow.locator('button:has-text("Avslå")').click(); await owner.locator('text=Reklamationen är avslagen').waitFor();
  assert(await owner.locator('.rt-row[data-status="rejected"]').count() === 1 && await owner.locator('.rt-row[data-status="credited"]').count() === 1 && await owner.locator('.rt-row[data-status="replaced"]').count() === 1, 'tre avgjorda ärenden');
  t = nb(await owner.locator('.rt-stats').innerText());
  assert(t.includes('Felpåvaran11000,00') && t.includes('Transportskada1500,00') && t.includes('Ångerrätt10,00500,00'), 'orsaksstatistik: ' + t);
  assert(nb(await owner.locator('.rt-products').innerText()).includes('A-1Kaffebryggare33'), 'per artikel: ' + await owner.locator('.rt-products').innerText());
  // Den avslagna returen frigör antalet igen
  await owner.selectOption('select[name=invoice]', { index: 1 }); await owner.click('button:has-text("Visa rader")');
  assert(nb(await owner.locator('.rt-line td:nth-child(3)').innerText()) === '1', 'kvar att returnera efter avslag');
  log('returer: kreditering av returnerade rader med moms och återtag i lager, ersättningsvara ur lagret med kassation, avslag, orsaksstatistik per artikel');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 31: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
