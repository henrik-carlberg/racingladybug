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

  // ================= Del 2: kontrollbalansräkning =================
  const KB = await newCompany('Kapitalbrist AB', 559400000);
  await voucher(KB, 'Aktiekapital inbetalt', [[1930, 25000], [2081, -25000]], `${YEAR}-01-02`);
  await voucher(KB, 'Stora förluster', [[5010, 20000], [1930, -20000]], `${YEAR}-02-01`);
  await owner.goto(KB + '/bokslut');
  await owner.locator(`tr:has-text("${YEAR}-01-01") a:has-text("Öppna")`).first().click();
  await owner.waitForURL(/bokslut\/\d+/);
  await owner.goto(owner.url().split('?')[0] + '/kontroller');
  assert((await owner.$$eval('.qc-finding', (els) => els.map((e) => e.getAttribute('data-key')))).includes('capital:deficit'), 'kapitalbrist bland kontrollerna');
  await owner.goto(KB + '/kontrollbalans');
  assert(await owner.locator('.cb-warning').count() === 1 && nb(await owner.locator('.cb-equity').innerText()) === '5000,00', 'varning om kapitalbrist');
  await owner.fill('.cb-draw textarea[name=adjustments]', 'Övervärde inventarier enligt värdering; 3000');
  await owner.fill('.cb-draw input[name=audited_by]', 'Revisor Rut');
  await owner.click('.cb-draw button:has-text("Upprätta")');
  await owner.locator('text=visar kapitalbrist: eget kapital 8 000,00 kr understiger halva aktiekapitalet (12 500,00 kr)').waitFor();
  await owner.selectOption('.cb-open select[name=outcome]', 'continue');
  await owner.click('button:has-text("Registrera stämman")');
  await owner.locator('text=Första kontrollstämman är registrerad').waitFor();
  const second = await owner.locator('.cb-deadline').innerText();
  const exp = new Date(); exp.setMonth(exp.getMonth() + 8);
  assert(second.slice(0, 7) === exp.toISOString().slice(0, 7), 'andra stämman inom åtta månader: ' + second);
  await owner.selectOption('.cb-open select[name=outcome]', 'restored');
  await owner.click('button:has-text("Registrera stämman")');
  await owner.locator('text=Upprätta först en ny kontrollbalansräkning').waitFor();
  log('kapitalbrist: varning, kontrollbalansräkning med verkliga värden, första kontrollstämman och frist för den andra');

  await voucher(KB, 'Ovillkorat aktieägartillskott', [[1930, 20000], [2093, -20000]]);
  await owner.goto(KB + '/kontrollbalans');
  await owner.click('.cb-draw button:has-text("Upprätta")');
  await owner.locator('text=visar eget kapital 25 000,00 kr – ingen kapitalbrist').waitFor();
  await owner.selectOption('.cb-open select[name=outcome]', 'restored');
  await owner.click('button:has-text("Registrera stämman")');
  await owner.locator('text=kapitalet är återställt').waitFor();
  assert(!(await owner.locator('.cb-open').count()) && (await owner.locator('.cb-sheet').count()) === 2, 'två kontrollbalansräkningar, inget öppet ärende');
  log('aktieägartillskott återställer kapitalet och andra kontrollstämman avslutar ärendet');

  await owner.click('summary:has-text("Frivillig likvidation")');
  await owner.fill('input[name=liquidator]', 'Lisa Likvidator');
  await owner.click('button:has-text("Registrera likvidationsbeslut")');
  await owner.locator('text=Likvidationsbeslutet är registrerat').waitFor();
  await owner.selectOption('.cb-liquidation select[name=step]', 'final_report_on');
  await owner.click('.cb-liquidation button:has-text("Registrera")');
  await owner.locator('text=Kallelse på okända borgenärer ska ha kungjorts').waitFor();
  await owner.selectOption('.cb-liquidation select[name=step]', 'creditor_notice_on');
  await owner.click('.cb-liquidation button:has-text("Registrera")');
  await owner.locator('text=Steget är registrerat').waitFor();
  await owner.selectOption('.cb-liquidation select[name=step]', 'final_report_on');
  await owner.click('.cb-liquidation button:has-text("Registrera")');
  await owner.locator('text=Skifte kan ske tidigast').waitFor();
  assert(nb(await owner.locator('.cb-net').innerText()) === '25000,00', 'att skifta');
  log('likvidation: skifte först sex månader efter kallelsen på okända borgenärer, slutredovisning med nettotillgångar');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 19: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
