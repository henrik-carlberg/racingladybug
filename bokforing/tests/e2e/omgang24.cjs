// End-to-end, omgång 24: likvidation, medarbetarlån och löneväxling, licensintäkter, revisionsberättelse, kontantmetoden.
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

  // ================= Del 1: skifte vid likvidation =================
  const LQ = await newCompany('Avvecklingen AB', 559210000);
  await voucher(LQ, 'Aktiekapital inbetalt', [[1930, 25000], [2081, -25000]], `${YEAR}-01-02`);
  await voucher(LQ, 'Försäljning', [[1930, 10000], [8310, -10000]], `${YEAR}-01-03`);
  await voucher(LQ, 'Inventarier', [[1220, 5000], [1930, -5000]], `${YEAR}-01-03`);
  await owner.goto(LQ + '/agare');
  for (const [n, sh, cb] of [['Anna Ägare', '60', '15000'], ['Bo Ägare', '40', '10000']]) {
    const of = owner.locator('form:has(button:has-text("Lägg till ägare"))');
    await of.locator('input[name=name]').fill(n); await of.locator('input[name=share_pct]').fill(sh); await of.locator('input[name=cost_basis]').fill(cb);
    await of.locator('button:has-text("Lägg till ägare")').click();
    await owner.locator('text=Ägaren är sparad').waitFor();
    await owner.goto(LQ + '/agare');
  }
  await owner.goto(LQ + '/kontrollbalans');
  await owner.click('summary:has-text("Frivillig likvidation")');
  await owner.fill('input[name=decided_on]', `${YEAR}-01-05`);
  await owner.fill('input[name=liquidator]', 'Lisa Likvidator');
  await owner.click('button:has-text("Registrera likvidationsbeslut")');
  await owner.locator('text=Likvidationsbeslutet är registrerat').waitFor();
  await owner.selectOption('.cb-liquidation select[name=step]', 'creditor_notice_on');
  await owner.fill('form:has(select[name=step]) input[name=date]', `${YEAR}-01-10`);
  await owner.click('.cb-liquidation button:has-text("Registrera")');
  await owner.locator('text=Steget är registrerat').waitFor();
  const skifte = async (d) => {
    await owner.goto(LQ + '/kontrollbalans');
    await owner.fill('form:has(button:has-text("Bokför skifte")) input[name=date]', d);
    await owner.click('button:has-text("Bokför skifte till ägarna")');
    await owner.locator('.flash').first().waitFor();
    return owner.locator('.flash').first().innerText();
  };
  assert((await skifte(`${YEAR}-06-01`)).includes('Skifte kan ske tidigast'), 'skifte före borgenärstiden nekas');
  assert((await skifte(`${YEAR}-07-15`)).includes('konto 1220'), 'osålda tillgångar stoppar skiftet');
  await voucher(LQ, 'Inventarier sålda', [[1930, 5000], [1220, -5000]], `${YEAR}-07-01`);
  t = await skifte(`${YEAR}-07-15`); assert(nb(t).includes("Skiftetärbokfört:35000,00kr"), "skiftet bokfört: " + t);
  await owner.goto(LQ + '/kontrollbalans');
  assert(nb(await owner.locator('.lq-row[data-name="Anna Ägare"] .lq-gain').innerText()) === '6000,00' && nb(await owner.locator('.lq-row[data-name="Bo Ägare"] .lq-gain').innerText()) === '4000,00', 'kapitalvinst per ägare');
  assert(await owner.locator('.lq-checklist li').count() === 4 && !(await owner.locator('button:has-text("Bokför skifte")').count()), 'checklista, inget nytt skifte');
  log('likvidation: skifte först efter borgenärstiden och när tillgångarna är sålda, 35 000 kr fördelas 60/40 med kapitalvinst 6 000 och 4 000 kr');

  // ================= Del 2: medarbetarlån =================
  const ML = await newCompany('Lånegivaren AB', 559220000);
  await voucher(ML, 'Aktiekapital', [[1930, 500000], [2081, -500000]], `${YEAR}-01-02`);
  await owner.goto(ML + '/lon/anstallda');
  await owner.fill('input[name=first_name]', 'Lena'); await owner.fill('input[name=last_name]', 'Lånetagare');
  await owner.fill('input[name=personal_number]', '19811218-9876'); await owner.fill('input[name=monthly_salary]', '40000'); await owner.fill('input[name=tax_table]', '32');
  await owner.click('form:has(input[name=first_name]) button:has-text("Spara")'); await owner.waitForURL(/ok=/);
  await owner.goto(ML + '/lon/medarbetarlan');
  await owner.fill('input[name=principal]', '120000'); await owner.fill('input[name=installment]', '10000'); await owner.fill('input[name=loan_date]', day(5));
  await owner.click('button:has-text("Bokför lånet")');
  await owner.locator('text=skattepliktig ränteförmån').waitFor();
  await owner.goto(ML + '/lon');
  await owner.fill('input[name=period]', `${YEAR}-${String(MONTH).padStart(2, '0')}`);
  await owner.fill('input[name=payment_date]', day(0));
  await owner.click('button:has-text("Ny lönekörning")');
  await owner.waitForURL(/lon\/\d+\?ok/);
  const loanRun = owner.url().split('?')[0];
  await owner.goto(ML + '/lon/medarbetarlan');
  await owner.locator('.el-row[data-name="Lena Lånetagare"] button:has-text("Dra på lönen")').click();
  await owner.locator('.flash').first().waitFor();
  const benefit = Math.round(12000000 * ({ 2024: 3.62, 2025: 2.96 }[YEAR] ?? 3.55) / 100 / 12);
  t = nb(await owner.locator('.flash').first().innerText());
  assert(t.includes('amortering10000,00kr') && t.includes(`ränteförmån${(benefit / 100).toFixed(2).replace('.', ',')}kr`), 'amortering och ränteförmån: ' + t);
  assert(!(await owner.locator('.el-row button:has-text("Dra på lönen")').count()), 'en gång per lönekörning');
  await owner.goto(loanRun);
  t = await owner.content();
  assert(t.includes('Ränteförmån medarbetarlån') && t.includes('Medarbetarlån: amortering'), 'raderna på lönespecen');
  await owner.click('button:has-text("Bokför lönekörning")');
  await owner.locator('text=Lönekörningen är bokförd').waitFor();
  await owner.goto(ML + '/lon/medarbetarlan');
  assert(nb(await owner.locator('.el-row[data-name="Lena Lånetagare"] .el-balance').innerText()) === '110000,00', 'saldo efter bokförd lön');
  log('medarbetarlån: 120 000 kr till 0 % ränta, amortering 10 000 kr på nettolönen och ränteförmån enligt statslåneräntan + 1 %, saldo 110 000 kr');

  // ================= Del 3: licensintäkter och royalty =================
  const LI = await newCompany('Licensgivaren AB', 559230000);
  const agree = async (f) => {
    await owner.goto(LI + '/licenser');
    for (const [k, v] of Object.entries(f)) await owner.fill(`form:has(button:has-text("Spara licensavtal")) input[name=${k}]`, v);
    await owner.click('button:has-text("Spara licensavtal")');
    await owner.locator('text=Licensavtalet är sparat').waitFor();
  };
  await agree({ licensee: 'Svensk Tillverkare AB', country: 'SE', rate: '5', minimum: '10000' });
  await agree({ licensee: 'Deutsche Lizenz GmbH', country: 'DE', rate: '8', treaty_rate: '0' });
  const rep = async (who, period, sales) => {
    await owner.goto(LI + '/licenser');
    const s = owner.locator(`.lic-agreement[data-licensee="${who}"]`);
    await s.locator('input[name=period]').fill(period); await s.locator('input[name=sales]').fill(sales);
    await s.locator('button:has-text("Bokför royalty")').click();
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await rep('Svensk Tillverkare AB', `${YEAR} Q2`, '100000');
  assert(t.includes('Royalty10000,00krärbokförd(garanteradminimiavgift)'), 'minimiavgiften: ' + t);
  t = await rep('Svensk Tillverkare AB', `${YEAR} Q2`, '300000');
  assert(t.includes('redanbokförd'), 'samma period två gånger nekas: ' + t);
  t = await rep('Deutsche Lizenz GmbH', `${YEAR} Q2`, '500000');
  assert(t.includes('Royalty40000,00krärbokförd'), 'royalty 8 %: ' + t);
  await owner.goto(LI + '/licenser');
  const de = owner.locator('.lic-agreement[data-licensee="Deutsche Lizenz GmbH"] .lic-report');
  await de.locator('input[name=withheld]').fill('4000');
  await de.locator('button:has-text("Inbetald")').click();
  await owner.locator('text=utländsk källskatt 4 000,00 kr').waitFor();
  await owner.goto(LI + '/licenser');
  const cr = owner.locator('.lic-credit[data-licensee="Deutsche Lizenz GmbH"]');
  assert(nb(await cr.locator('.lic-reclaim').innerText()) === '4000,00' && nb(await cr.locator('.lic-creditable').innerText()) === '0,00', 'källskatt över avtalssatsen återsöks');
  log('royalty: minimiavgift 10 000 kr, 8 % på tysk försäljning, källskatt 4 000 kr utöver avtalets 0 % ska återsökas i Tyskland');

  // ================= Del 4: revisionsberättelse =================
  const RB = await newCompany('Granskade AB', 559240000);
  await voucher(RB, 'Aktiekapital', [[1930, 25000], [2081, -25000]], `${YEAR}-01-02`);
  await voucher(RB, 'Skatt dragen från skattekontot', [[2510, 3000], [1630, -3000]], `${YEAR}-03-12`);
  const rv = await accept(browser, await invite(owner, RB, `revisor.omg24.${Date.now()}@example.com`, 'auditor'), 'Rut Revisor', 'revisorlosen24');
  await rv.goto(RB + '/revision');
  await rv.selectOption('select[name=fy]', { label: `${YEAR}-01-01 – ${YEAR}-12-31` });
  await rv.click('button:has-text("Starta granskning")');
  await rv.waitForURL(/revision\/\d+/);
  const rvUrl = rv.url().split('?')[0];
  for (const id of await rv.$$eval('section.checkpoint', (els) => els.map((e) => e.id))) {
    await rv.locator(`#${id} input[value=ok]`).check(); await rv.locator(`#${id} button:has-text("Spara")`).click();
    await rv.locator(`#${id} .badge:has-text("Utan anmärkning")`).waitFor();
  }
  await rv.fill('textarea[name=conclusion]', 'Inga väsentliga fel i räkenskaperna.');
  await rv.click('button:has-text("Avsluta granskningen")');
  await rv.waitForURL((u) => decodeURIComponent(u.href.replace(/\+/g, ' ')).includes('Granskningen är avslutad'));
  t = await text(rv);
  assert(t.includes('Överväg anmärkning') && t.includes('skattekontot visar ett underskott på 3') && !(await rv.locator('input[name=discharge]').isChecked()), 'förslag på anmärkning: ' + t.slice(-1500));
  await rv.fill('.ar-form input[name=place]', 'Stockholm');
  await rv.fill('.ar-form input[name=date]', `${YEAR}-12-31`);
  await rv.click('button:has-text("Signera revisionsberättelsen")');
  await rv.waitForURL(/error=/);
  assert(decodeURIComponent(rv.url().replace(/\+/g, ' ')).includes('dateras efter'), 'datum efter räkenskapsåret');
  await rv.goto(rvUrl);
  await rv.fill('.ar-form input[name=place]', 'Stockholm');
  await rv.fill('.ar-form input[name=date]', `${YEAR + 1}-02-15`);
  await rv.click('button:has-text("Signera revisionsberättelsen")');
  await rv.waitForURL((u) => decodeURIComponent(u.href.replace(/\+/g, ' ')).includes('signerad'));
  await owner.goto(rvUrl);
  t = await text(owner);
  assert(t.includes('Revisionsberättelse') && t.includes('Utan modifiering') && t.includes('Jag tillstyrker att årsstämman fastställer') && t.includes('Jag avstyrker att styrelsens ledamöter')
    && t.includes(`Stockholm den ${YEAR + 1}-02-15`) && t.includes('Rut Revisor') && !(await owner.locator('.ar-form').count()), 'bolaget ser berättelsen: ' + t.slice(-1500));
  const again = await rv.request.post(`${RB}/revision/granska`, { form: { op: 'report', eid: rvUrl.split('/').pop(), opinion: 'clean', place: 'X', date: `${YEAR + 1}-03-01` }, headers: { origin: BASE }, maxRedirects: 0 });
  assert(decodeURIComponent(again.headers().location).includes('redan signerad'), 'kan inte signeras två gånger');
  await owner.goto(RB + '/bokslut');
  await owner.locator(`tr:has-text("${YEAR}-01-01") a:has-text("Öppna")`).first().click();
  await owner.waitForURL(/bokslut\/\d+/);
  const pdf = await owner.request.get(owner.url().split('?')[0] + '/parm/pdf');
  assert(pdf.status() === 200 && (await pdf.body()).toString('latin1').includes('Revisionsber'), 'revisionsberättelsen i bokslutspärmen');
  log('revisionsberättelse: ren berättelse med anmärkning om underskott på skattekontot, avstyrkt ansvarsfrihet, signerad en gång och med i bokslutspärmen');

  // ================= Del 5: kontantmetoden =================
  const setMethod = async (B, m) => {
    await owner.goto(B + '/installningar');
    await owner.selectOption('select[name=accounting_method]', m);
    await owner.click('form:has(select[name=accounting_method]) button:has-text("Spara")');
    await owner.locator('.flash').first().waitFor();
    return owner.locator('.flash').first().innerText();
  };
  const FM = await newCompany('Fakturametoden AB', 559250000);
  await owner.goto(FM + '/kunder');
  await owner.fill('input[name=name]', 'Metodkunden AB');
  await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await invoice(FM, 'Metodkunden AB', 1000);
  t = await setMethod(FM, 'cash');
  assert(t.includes('byts vid ett nytt räkenskapsår'), 'byte mitt i året nekas: ' + t);
  await owner.goto(BASE + '/');
  await owner.fill('input[name=name]', 'Kontantfirman AB');
  await owner.selectOption('select[name=company_type]', 'AB');
  await owner.fill('input[name=orgnr]', orgnrFor(String(559260000 + (Date.now() % 900000)).slice(0, 9)));
  await owner.fill('input[name=fy_start]', `${YEAR}-01-01`); await owner.fill('input[name=fy_end]', `${YEAR}-12-31`);
  await owner.selectOption('select[name=accounting_method]', 'cash');
  await owner.click('button:has-text("Skapa bolag")');
  await owner.waitForURL(/kom-igang/);
  const KM = owner.url().replace(/\/kom-igang.*/, '');
  await owner.goto(KM + '/kunder');
  await owner.fill('input[name=name]', 'Kontantkunden AB');
  await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await invoice(KM, 'Kontantkunden AB', 1000);
  t = await setMethod(KM, 'invoice');
  assert(t.includes('Bokför först de 1 obetalda fakturorna'), 'obokförda fakturor stoppar bytet: ' + t);
  await voucher(KM, 'Stor försäljning', [[1930, 4375000], [3001, -3500000], [2611, -875000]], `${YEAR}-02-01`);
  await owner.goto(KM + '/bokslut');
  await owner.locator(`tr:has-text("${YEAR}-01-01") a:has-text("Öppna")`).first().click();
  await owner.waitForURL(/bokslut\/\d+/);
  t = nb(await owner.locator('.cash-warning').innerText());
  assert(t.includes('3500000kr') && t.includes('övergränsenpå3miljonerkronor'), 'varning över 3 Mkr: ' + t);
  log('kontantmetoden: byte av metod bara vid nytt räkenskapsår, obokförda fakturor stoppar bytet till faktureringsmetoden, varning när omsättningen passerar 3 Mkr');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 24: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
