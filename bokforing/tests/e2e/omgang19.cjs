// End-to-end, omgång 19: kundförluster, kontrollbalansräkning, värdepapper, ombildning EF till AB, avsättningar och åtaganden.
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

  // ================= Del 1: kundförluster =================
  const KF = await newCompany('Kundförlust AB', 559500000);
  await owner.goto(KF + '/kunder');
  await owner.fill('input[name=name]', 'Konkursbolaget AB');
  await owner.click('button:has-text("Spara kund")');
  await owner.locator('text=Kunden är sparad').waitFor();
  await owner.goto(KF + '/kunder');
  await owner.fill('input[name=name]', 'Sen Betalare AB');
  await owner.click('button:has-text("Spara kund")');
  await owner.locator('text=Kunden är sparad').waitFor();
  await invoice(KF, 'Konkursbolaget AB', '10000', `${YEAR}-01-15`);
  const kfInv = owner.url().split('?')[0];
  await invoice(KF, 'Sen Betalare AB', '4000', `${YEAR}-02-01`);
  await owner.goto(kfInv);
  await owner.click('summary:has-text("Konstaterad kundförlust")');
  await owner.fill('.bad-debt input[name=reason]', 'Kunden försatt i konkurs, ingen utdelning');
  await owner.click('button:has-text("Skriv bort fordran")');
  await owner.locator('text=Kundförlusten är bokförd').waitFor();
  t = nb(await owner.locator('.flash').first().innerText());
  assert(t.includes('12500,00kr') && t.includes('2500,00kr'), 'bortskrivning: ' + t);
  await owner.goto(KF + '/rapporter/huvudbok?account=6351');
  assert(nb(await text(owner)).includes('10000,00'), '6351 nettot');
  await owner.goto(KF + '/rapporter/huvudbok?account=1510');
  assert(nb(await text(owner)).includes('12500,00'), 'kundfordran krediteras');
  log('konstaterad kundförlust: fordran 12 500 kr skrivs bort, 10 000 kr på 6351 och utgående moms 2 500 kr sätts ned');

  await owner.goto(kfInv);
  await owner.fill('.written-off input[name=amount]', '2500');
  await owner.click('button:has-text("Registrera återvunnen betalning")');
  await owner.locator('text=Återvunnen kundförlust 2 500,00 kr är bokförd').waitFor();
  assert(!(await owner.locator('button:has-text("Ångra bortskrivningen")').count()), 'kan inte ångras efter återvinning');
  await owner.goto(KF + '/rapporter/huvudbok?account=2611');
  assert(nb(await text(owner)).includes('500,00'), 'momsen redovisas igen på återvunnet');
  log('återvunnen kundförlust: 2 500 kr minskar förlusten med 2 000 kr och 500 kr utgående moms redovisas igen');

  await owner.goto(KF + '/bokslut');
  await owner.locator(`tr:has-text("${YEAR}-01-01") a:has-text("Öppna")`).first().click();
  await owner.waitForURL(/bokslut\/\d+/);
  await owner.click('a:has-text("Kundförluster")');
  await owner.waitForURL(/kundforluster/);
  assert(nb(await owner.locator('.bd-target').innerText()) === '4000,00', 'befarad exkl. moms: ' + await owner.locator('.bd-target').innerText());
  assert(nb(await owner.locator('.bd-written').innerText()) === '10000,00', 'konstaterade netto i år');
  await owner.click('button:has-text("Bokför reserven")');
  await owner.locator('text=Reserven för befarade kundförluster är ökad med 4 000,00 kr').waitFor();
  assert(nb(await owner.locator('.bd-current').innerText()) === '4000,00' && !(await owner.locator('button:has-text("Bokför reserven")').count()), 'reserven bokförd en gång');
  log('befarade kundförluster: förfallen faktura reserveras exklusive moms på 1519/6352 i bokslutet');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 19: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
