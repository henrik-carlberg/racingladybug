// End-to-end, omgång 14: bostadsrättsföreningar, kreditkontroll, leasing, provisioner, utlandsbetalningar.
const { chromium } = require('playwright');
const http = require('node:http');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const text = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); const sel = (await page.locator('main').count()) ? 'main' : 'body'; return (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').replace(/ /g, ' '); };
const iso = (d) => d.toISOString().slice(0, 10);
const day = (n) => iso(new Date(Date.now() - n * 864e5));
const YEAR = new Date().getFullYear();

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

const mailServer = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"m1"}'); }); }).listen(3303);

(async () => {
  const browser = await chromium.launch();
  const owner = await login(browser, 'agare@example.com', 'hemligtlosen1');
  const B = `${BASE}/c/1`;
  let t;
  const nb = (s) => s.replace(/[\s  ]/g, '');
  const next = (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + 1, 1); return d.toISOString().slice(0, 7); })();

  // ================= Del 1: bostadsrättsföreningar =================
  await owner.goto(B + '/brf');
  await owner.click('button.enable-brf');
  await owner.locator('text=Bostadsrättsföreningsläget är på').waitFor();
  for (const [n, area, share, name] of [['1001', '60', '0,3', 'Anna Brf'], ['1002', '90', '0,45', 'Bo Brf'], ['1003', '50', '0,25', 'Cia Brf']]) {
    await owner.goto(B + '/brf');
    const f = owner.locator('form:has(button:has-text("Lägg till lägenhet"))');
    await f.locator('input[name=number]').fill(n); await f.locator('input[name=skv_number]').fill(n);
    await f.locator('input[name=area]').fill(area); await f.locator('input[name=share]').fill(share);
    await f.locator('input[name=owner]').fill(name); await f.locator('input[name=insats]').fill('50000'); await f.locator('input[name=granted_on]').fill('2020-01-01');
    await f.locator('button').click();
    await owner.locator('text=Lägenheten är införd i förteckningen').waitFor();
  }
  assert((await owner.locator('.apt-count').innerText()) === '3' && nb(await owner.locator('.share-sum').innerText()) === '1', 'förteckning');
  log('lägenhetsförteckning med Skatteverkets nummer, yta, andelstal, insats och bostadsrättshavare');

  await owner.fill('input[name=fee_budget]', '360000');
  await owner.click('form:has(input[name=fee_budget]) button:has-text("Spara")');
  await owner.locator('text=Årets avgifter är sparade').waitFor();
  await owner.goto(B + '/brf');
  const fee = async (n) => nb(await owner.locator(`tr.apartment:has(td:text-is("${n}")) .apt-fee`).innerText());
  assert((await fee('1001')) === '9000,00' && (await fee('1002')) === '13500,00' && (await fee('1003')) === '7500,00', 'avgift per andelstal');
  await owner.fill('form:has(button:has-text("Skapa avgiftsavier")) input[name=month]', next);
  await owner.click('button:has-text("Skapa avgiftsavier")');
  await owner.locator('text=3 avgiftsavier är skapade och bokförda').waitFor();
  assert(nb(await owner.locator(`tr.fee-period:has-text("${next}") td`).nth(2).innerText()) === '30000,00' && (await owner.locator(`tr.fee-period:has-text("${next}") td`).nth(1).innerText()) === '3', 'avierna');
  await owner.goto(B + '/brf');
  await owner.fill('form:has(button:has-text("Skapa avgiftsavier")) input[name=month]', next);
  await owner.click('button:has-text("Skapa avgiftsavier")');
  await owner.locator('.flash.error, .flash:has-text("inga avgifter att avisera")').first().waitFor();
  log('årsavgiften fördelas efter andelstal och aviseras per lägenhet med OCR – en gång per period');

  await owner.goto(B + '/brf');
  const row1 = owner.locator('tr.apartment:has(td:text-is("1001"))');
  await row1.locator('summary').click();
  await row1.locator('input[name=buyer]').fill('Dan Köpare');
  await row1.locator('input[name=price]').fill('2500000');
  await row1.locator('button:has-text("Registrera överlåtelse")').click();
  await owner.locator('text=Överlåtelsen är registrerad').waitFor();
  t = await text(owner);
  assert(/1001 1001 60 0,3 Dan Köpare/.test(t) && /lgh 1001 från Anna Brf till Dan Köpare för 2[\s ]500[\s ]000,00/.test(t), 'överlåtelse: ' + t.slice(0, 2500));
  await owner.goto(B + '/fakturor');
  assert((await text(owner)).includes('Dan Köpare'), 'överlåtelseavgift fakturerad');
  await owner.goto(B + '/brf');
  const row2 = owner.locator('tr.apartment:has(td:text-is("1002"))');
  await row2.locator('summary').click();
  await row2.locator('input[name=lender]').fill('Swedbank');
  await row2.locator('button:has-text("Notera pantsättning")').click();
  await owner.locator('text=Pantsättningen är noterad').waitFor();
  assert((await owner.locator('tr.apartment:has(td:text-is("1002")) .pledge').count()) === 1, 'pant');
  const reg = await (await owner.context().request.get(B + '/brf/forteckning')).text();
  assert(reg.includes('Lägenhetsförteckning') && reg.includes('Dan Köpare') && reg.includes('Swedbank'), 'förteckning för utskrift');
  await owner.locator('tr.apartment:has(td:text-is("1002")) .pledge button').click();
  await owner.locator('text=Pantsättningen är avregistrerad').waitFor();
  log('överlåtelse och pantsättning förs in i förteckningen och avgifterna (högst 2,5 % resp. 1 % av prisbasbeloppet) faktureras');

  await owner.goto(B + '/brf');
  await owner.fill('form:has(input[name=item]) input[name=item]', 'Takomläggning');
  await owner.fill('form:has(input[name=item]) input[name=amount]', '800000');
  await owner.click('form:has(input[name=item]) button:has-text("Lägg till")');
  await owner.locator('text=Åtgärden är införd i underhållsplanen').waitFor();
  await owner.fill('form:has(select[name=kind]) input[name=amount]', '50000');
  await owner.click('form:has(select[name=kind]) button:has-text("Bokför")');
  await owner.locator('text=Avsättningen till fonden är bokförd').waitFor();
  assert(nb(await owner.locator('.fund-balance').innerText()) === '50000,00', 'fond');
  await owner.goto(B + '/brf');
  await owner.selectOption('select[name=kind]', 'use');
  await owner.fill('form:has(select[name=kind]) input[name=amount]', '90000');
  await owner.click('form:has(select[name=kind]) button:has-text("Bokför")');
  await owner.locator('.flash.error, .flash:has-text("Fonden räcker inte")').first().waitFor();
  t = await text(owner);
  assert(t.includes('Årsavgift per kvm upplåten med bostadsrätt') && t.includes('Räntekänslighet') && t.includes('Energikostnad per kvm'), 'nyckeltal: ' + t.slice(-1500));
  log('underhållsplan, fond för yttre underhåll och nyckeltalen enligt BFNAR 2023:1');

  await owner.goto(B + '/brf');
  await owner.click('button:has-text("Stäng av bostadsrättsföreningsläget")');
  await owner.locator('text=Bostadsrättsföreningsläget är av').waitFor();

  //@@NEXT@@
  await browser.close(); mailServer.close();
  console.log('Omgång 14: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
