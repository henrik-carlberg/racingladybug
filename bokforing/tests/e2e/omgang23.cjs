// End-to-end, omgång 23: inkråmsköp, valutasäkring, kupongskatt, tryggandelagen, kvittning och nettning.
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

  // ================= Del 1: förvärv av rörelse =================
  const IK = await newCompany('Inkråmsköparen AB', 559160000);
  const buy = async (f) => {
    await owner.goto(IK + '/forvarv');
    await owner.fill('input[name=seller]', 'Säljarfirman'); for (const [k, v] of Object.entries(f)) await owner.fill(`input[name=${k}]`, v);
    await owner.click('button:has-text("Bokför förvärvet")');
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  assert((await buy({ price: '100000', a_inventarier: '200000' })).includes('negativgoodwill'), 'negativ goodwill nekas');
  t = await buy({ price: '500000', a_inventarier: '200000', a_lager: '100000', l_semester: '50000' });
  assert(t.includes('tillgångar300000,00kr') && t.includes('goodwill250000,00kr'), 'fördelning: ' + t);
  assert(nb(await owner.locator('.acq-gw').first().innerText()) === '250000,00', 'goodwill i listan');
  await owner.goto(IK + '/anlaggningar');
  t = await text(owner);
  assert(t.includes('Goodwill, förvärv från Säljarfirman') && t.includes('Inventarier från Säljarfirman'), 'i anläggningsregistret');
  await owner.goto(IK + '/rapporter/huvudbok?account=2920');
  assert(nb(await text(owner)).includes('50000,00'), 'övertagen semesterlöneskuld');
  log('inkråmsköp: köpeskilling 500 000 kr fördelad på inventarier och lager, semesterlöneskuld tas över, goodwill 250 000 kr i anläggningsregistret');

  // ================= Del 2: valutaterminer =================
  const VT = await newCompany('Valutasäkrarna AB', 559170000);
  await owner.goto(VT + '/valutaterminer');
  await owner.fill('input[name=amount]', '100000'); await owner.fill('input[name=forward_rate]', '11,5'); await owner.fill('input[name=maturity]', `${YEAR + 1}-03-31`);
  await owner.click('button:has-text("Registrera termin")');
  await owner.locator('text=Terminen är registrerad').waitFor();
  const fx = () => owner.locator('.fx-row[data-currency="EUR"]');
  await fx().locator('input[name=rate]').fill('11,8');
  await fx().locator('button:has-text("Värdera")').click();
  await owner.locator('text=reserv för orealiserad förlust 30 000,00 kr').waitFor();
  assert(nb(await fx().locator('.fx-reserve').innerText()) === '30000,00', 'reserv');
  await fx().locator('form:has(input[name=spot_rate]) input[name=date]').fill(`${YEAR}-12-31`);
  await fx().locator('input[name=spot_rate]').fill('11,7');
  await fx().locator('button:has-text("Avräkna")').click();
  await owner.locator('text=Terminen är avräknad: kursförlust 20 000,00 kr').waitFor();
  await owner.goto(VT + '/rapporter/huvudbok?account=2990');
  t = nb(await text(owner));
  assert(t.includes('30000,00'), 'reserven löses upp vid avräkning');
  log('valutatermin: osäkrad termin reserveras med 30 000 kr i bokslutet (lägsta värdets princip) och avräknas med kursförlust 20 000 kr');

  // ================= Del 3: kupongskatt =================
  const KS = await newCompany('Utdelaren AB', 559180000);
  await voucher(KS, 'Utdelningsbeslut', [[2091, 200000], [2898, -200000]], `${YEAR}-05-15`);
  const divi = async (f) => {
    await owner.goto(KS + '/kupongskatt');
    for (const [k, v] of Object.entries(f)) { if (k === 'recipient_type') await owner.selectOption('select[name=recipient_type]', v); else if (k === 'business_related') await owner.check('input[name=business_related]'); else await owner.fill(`input[name=${k}]`, v); }
    await owner.click('button:has-text("Bokför utbetalning")');
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await divi({ recipient: 'Ola Nordmann', country: 'NO', gross: '100000' });
  assert(t.includes('kupongskatt15%(15000,00kr)') && t.includes('utbetalt85000,00kr'), 'Norge 15 %: ' + t);
  t = await divi({ recipient: 'Mutter GmbH', country: 'DE', recipient_type: 'company', holding_pct: '30', gross: '80000' });
  assert(t.includes('kupongskatt0%'), 'EU-bolag befriat: ' + t);
  t = await divi({ recipient: 'För mycket', country: 'NO', gross: '50000' });
  assert(t.includes('störreänbeslutad'), 'mer än beslutad utdelning nekas');
  await owner.goto(KS + '/kupongskatt');
  assert(nb(await owner.locator('.ks-unpaid').innerText()) === '15000,00', 'att betala');
  await owner.click('button:has-text("Bokför inbetalning till Skatteverket")');
  await owner.locator('text=Kupongskatt 15 000,00 kr är bokförd som betald').waitFor();
  log('kupongskatt: 15 % enligt avtal med Norge, EU-moderbolag befriat, utdelning över beslutat belopp nekas, inbetalning till Skatteverket');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 23: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
