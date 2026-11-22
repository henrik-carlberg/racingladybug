// End-to-end, omgång 28: traktamente på djupet, kassabok, återkommande leverantörsfakturor, budget per kostnadsställe, ackord.
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

  // ================= Del 1: traktamente på djupet =================
  const TR = await newCompany('Resebolaget AB', 559400000);
  await owner.goto(TR + '/moduler');
  await owner.locator('.card:has(h2:text-is("Utlägg och reseräkningar")) button:has-text("Aktivera")').click();
  await owner.waitForURL(/ok=/);
  await owner.goto(TR + '/lon/anstallda');
  await owner.fill('input[name=first_name]', 'Rita'); await owner.fill('input[name=last_name]', 'Resande');
  await owner.fill('input[name=personal_number]', '19811218-9876'); await owner.fill('input[name=monthly_salary]', '35000'); await owner.fill('input[name=tax_table]', '32');
  await owner.click('form:has(input[name=first_name]) button:has-text("Spara")'); await owner.waitForURL(/ok=/);
  await owner.goto(TR + '/m/utlagg');
  await owner.selectOption('select[name=employee_id]', { label: 'Rita Resande' });
  await owner.fill('input[name=title]', 'Mässresor');
  await owner.click('button:text-is("Skapa")');
  await owner.locator('text=Utläggsräkningen är skapad').waitFor();
  const TRC = owner.url().split('?')[0];
  const allowance = async (f) => {
    await owner.goto(TRC);
    const a = owner.locator('form:has(button:has-text("Lägg till traktamente"))');
    for (const [k, v] of Object.entries(f)) { if (k === 'long_term') await a.locator('select[name=long_term]').selectOption(v); else await a.locator(`input[name=${k}]`).fill(v); }
    await a.locator('button').click();
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  // Inrikes 3 hela dagar och 2 nätter med 2 frukostar och 1 lunch: 3×300 − (2×20 % + 35 %)×300 + 2×150 = 975 kr
  await allowance({ days_full: '3', nights: '2', breakfasts: '2', lunches: '1', description: 'Malmö, mässa' });
  // Utrikes 2 hela dagar i Norge à 1 000 kr, 1 natt (500 kr), efter tre månader 70 %: 2×700 + 500 = 1 900 kr; utbetalt 2 500 kr → 600 kr som lön
  await allowance({ days_full: '2', nights: '1', country: 'Norge', foreign_rate: '1000', long_term: '3m', paid: '2500', description: 'Oslo, montage' });
  assert((await allowance({ days_full: '1', breakfasts: '3', description: 'Fel' })).includes('Flerbetaldamåltiderän'), 'fler måltider än dagar nekas');
  const mile = async (km, car) => {
    await owner.goto(TRC);
    const m = owner.locator('form:has(button:has-text("Lägg till resa"))');
    await m.locator('input[name=km]').fill(km); await m.locator('input[name=description]').fill('Kontoret – kund'); await m.locator('select[name=car]').selectOption(car);
    await m.locator('button').click();
    await owner.locator('text=Raden är tillagd').waitFor();
  };
  await mile('100', 'el');
  await owner.goto(TRC);
  t = nb(await text(owner));
  assert(t.includes('975,00') && t.includes('1900,00') && t.includes('600,00kröverskattefrittbeloppbetalassomlön') && t.includes('måltidsavdrag225,00kr') && t.includes('(förmånsbil,el)') && t.includes('95,00'), 'traktamentsrader: ' + t.slice(0, 2000));
  log('traktamente: måltidsavdrag (frukost 20 %, lunch 35 %), utrikes normalbelopp, långvarig förrättning 70 %, överskott till lön, förmånsbil el 9,50 kr/mil');

  // ================= Del 2: kassabok =================
  const KB = await newCompany('Kontantbutiken AB', 559410000);
  await voucher(KB, 'Växelkassa från banken', [[1910, 5000], [1930, -5000]], day(10));
  await voucher(KB, 'Förbrukningsmaterial kontant', [[5460, 1200], [1910, -1200]], day(8));
  await voucher(KB, 'Insättning på banken', [[1930, 4500], [1910, -4500]], day(5));
  await voucher(KB, 'Kontantförsäljning', [[1910, 1000], [8310, -1000]], day(4));
  await owner.goto(KB + `/kassabok?from=${day(15)}&to=${day(0)}`);
  assert(await owner.locator('.cb-negative').count() === 1 && (await owner.locator('.cb-negative').innerText()).includes(day(5)), 'negativt saldo flaggas');
  assert(await owner.locator('.cb-overdue').count() === 1, 'kassan har inte räknats');
  assert(nb(await owner.locator('.cb-closing').innerText()) === '300,00', 'utgående saldo');
  await owner.fill('input[name=counted]', '280'); await owner.fill('input[name=counted_by]', 'Kim Kassör'); await owner.fill('form:has(button:has-text("Spara kassainventering")) input[name=date]', day(1));
  await owner.click('button:has-text("Spara kassainventering")');
  await owner.locator('text=underskott 20,00 kr bokfört på 3740').waitFor();
  await owner.goto(KB + `/kassabok?from=${day(15)}&to=${day(0)}`);
  assert(!(await owner.locator('.cb-overdue').count()) && nb(await owner.locator('.cb-closing').innerText()) === '280,00', 'kassan stämmer efter inventeringen');
  log('kassabok: löpande saldo, negativt saldo och oräknad kassa flaggas, kassainventering bokför differensen på 3740');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 28: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
