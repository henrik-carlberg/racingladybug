// End-to-end, omgång 26: jämkning, omvänd skattskyldighet för varor, löneutmätning, slutlön, kontrollenhet och dagsrapporter.
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

  // ================= Del 1: jämkning – ny-, till- och ombyggnad och slutjämkning =================
  const JK = await newCompany('Jämkaren AB', 559310000);
  const inv = async (desc, kind, vat, pct) => {
    await owner.goto(JK + '/rapporter/moms/avancerat#jamkning');
    const jf = owner.locator('form:has(input[name=vat_amount])');
    await jf.locator('input[name=description]').fill(desc); await jf.locator('select[name=kind]').selectOption(kind);
    await jf.locator('input[name=completed_on]').fill(`${YEAR - 1}-03-01`);
    await jf.locator('input[name=vat_amount]').fill(vat); await jf.locator('input[name=orig_pct]').fill(pct);
    await jf.locator('button:has-text("Registrera")').click();
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  assert((await inv('Liten ombyggnad', 'nybyggnad', '50000', '100')).includes('minst100000kr'), 'gräns för fastighetsinvestering');
  assert((await inv('Liten maskin', 'inventarie', '5000', '100')).includes('minst50000kr'), 'gräns för inventarier');
  await inv('Tillbyggnad lager', 'nybyggnad', '400000', '50');
  await inv('Fräsmaskin', 'inventarie', '50000', '100');
  const card = (d) => owner.locator(`.investment:has-text("${d}")`);
  await owner.goto(JK + '/rapporter/moms/avancerat#jamkning');
  assert((await card('Tillbyggnad lager').innerText()).includes(`t.o.m. ${YEAR + 18}`), 'tjugo års korrigeringstid');
  await card('Tillbyggnad lager').locator('select[name=disposal]').selectOption('taxable');
  await card('Tillbyggnad lager').locator('button:has-text("Slutjämka")').click();
  await owner.locator('.flash').first().waitFor();
  t = nb(await owner.locator('.flash').first().innerText());
  assert(t.includes('för19år') && t.includes('ytterligareavdrag190000,00kr'), 'momspliktig försäljning: 1/20 × 19 år × 50 %: ' + t);
  await owner.goto(JK + '/rapporter/moms/avancerat#jamkning');
  await card('Fräsmaskin').locator('select[name=disposal]').selectOption('exempt');
  await card('Fräsmaskin').locator('button:has-text("Slutjämka")').click();
  await owner.locator('.flash').first().waitFor();
  t = nb(await owner.locator('.flash').first().innerText());
  assert(t.includes('för4år') && t.includes('återbetalning40000,00kr'), 'uttag ur verksamheten: 1/5 × 4 år × 100 %: ' + t);
  await owner.goto(JK + '/rapporter/moms/avancerat#jamkning');
  assert(await owner.locator('.inv-disposed').count() === 2 && !(await card('Fräsmaskin').locator('button:has-text("Jämka")').count()), 'slutjämkade investeringar kan inte jämkas igen');
  log('jämkning: 20 år för ny-, till- och ombyggnad, beloppsgränser, slutjämkning vid försäljning med moms (+190 000 kr) och uttag (−40 000 kr)');

  // ================= Del 2: omvänd skattskyldighet för varor =================
  const OR = await newCompany('Mobilgrossisten AB', 559320000);
  await owner.goto(OR + '/kunder');
  await owner.fill('input[name=name]', 'Elektronikkedjan AB'); await owner.fill('input[name=orgnr]', orgnrFor('556688990'));
  await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  const rcInvoice = async (goods, desc, amount) => {
    await owner.goto(OR + '/fakturor/ny');
    await owner.selectOption('select[name=customer_id]', { label: 'Elektronikkedjan AB' });
    await owner.fill('input[name=invoice_date]', day(1));
    if (goods) await owner.selectOption('select[name=goods_rc]', goods);
    const r0 = owner.locator('tbody tr').first();
    await r0.locator('td:nth-child(1) input').fill(desc); await r0.locator('td:nth-child(2) input').fill('1');
    await r0.locator('td:nth-child(3) input').fill('st'); await r0.locator('td:nth-child(4) input').fill(amount);
    await owner.click('button:has-text("Spara utkast")');
    await owner.waitForURL(/fakturor\/(\d+\?ok|ny)/).catch(() => {});
    await owner.waitForLoadState('networkidle');
  };
  await rcInvoice('electronics', 'Mobiltelefoner 40 st', '80000');
  assert((await text(owner)).includes('Under 100 000 kr exkl. moms gäller vanlig moms'), 'elektronik under 100 000 kr');
  await rcInvoice('', 'Mobiltelefoner 100 st', '200000');
  assert(await owner.locator('.goods-rc-warning').count() === 1, 'varning: vanlig moms på mobiltelefoner över gränsen');
  await rcInvoice('electronics', 'Mobiltelefoner 60 st', '120000');
  assert(await owner.locator('.goods-rc').count() === 1, 'omvänd skattskyldighet på fakturan');
  t = nb(await text(owner));
  assert(t.includes('120000,00') && !t.includes('30000,00'), 'ingen moms debiteras: ' + t.slice(0, 600));
  await owner.click('button:has-text("Bokför faktura")');
  await owner.locator('text=Fakturan är bokförd').waitFor();
  await owner.goto(OR + `/rapporter/moms?from=${day(1).slice(0, 7)}-01&to=${day(0)}`);
  t = nb(await text(owner));
  assert(/Försäljningnärköparenärskattskyldig[iI]Sverige120000/.test(t), 'ruta 41: ' + t.slice(0, 900));
  log('omvänd skattskyldighet för varor: elektronik under 100 000 kr nekas, varning vid vanlig moms, 120 000 kr utan moms i ruta 41');

  // ================= Del 3: löneutmätning =================
  const LU = await newCompany('Arbetsgivaren AB', 559330000);
  await voucher(LU, 'Aktiekapital', [[1930, 500000], [2081, -500000]], `${YEAR}-01-02`);
  const emp = async (first, last, pn) => {
    await owner.goto(LU + '/lon/anstallda');
    await owner.fill('input[name=first_name]', first); await owner.fill('input[name=last_name]', last);
    await owner.fill('input[name=personal_number]', pn); await owner.fill('input[name=monthly_salary]', '40000'); await owner.fill('input[name=tax_table]', '32');
    await owner.click('form:has(input[name=first_name]) button:has-text("Spara")'); await owner.waitForURL(/ok=/);
  };
  await emp('Ulf', 'Utmätt', '19811218-9876');
  await emp('Vera', 'Värnad', '19' + orgnrFor('790315123'));
  const decide = async (name, monthly, reserved) => {
    await owner.goto(LU + '/lon/utmatning');
    await owner.selectOption('select[name=employee_id]', { label: name });
    await owner.fill('input[name=case_no]', `KFM-${name.split(' ')[0]}`); await owner.fill('input[name=monthly_amount]', monthly); await owner.fill('input[name=reserved_amount]', reserved);
    await owner.fill('input[name=valid_from]', `${YEAR}-01-01`);
    await owner.click('button:has-text("Registrera beslut")');
    await owner.locator('text=Beslutet om löneutmätning är registrerat').waitFor();
  };
  await decide('Ulf Utmätt', '5000', '20000');
  await decide('Vera Värnad', '5000', '60000');
  await owner.goto(LU + '/lon');
  await owner.fill('input[name=period]', `${YEAR}-${String(MONTH).padStart(2, '0')}`);
  await owner.fill('input[name=payment_date]', day(0));
  await owner.click('button:has-text("Ny lönekörning")');
  await owner.waitForURL(/lon\/\d+\?ok/);
  const luRun = owner.url().split('?')[0];
  const applyG = async (name) => {
    await owner.goto(LU + '/lon/utmatning');
    await owner.locator(`.ut-decision[data-name="${name}"] button:has-text("Dra på lönen")`).click();
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  assert((await applyG('Ulf Utmätt')).includes('Löneutmätning5000,00krdras'), 'avdrag enligt beslutet');
  assert((await applyG('Vera Värnad')).includes('Ingenutmätningdennamånad'), 'förbehållsbeloppet skyddar nettolönen');
  await owner.goto(luRun);
  assert((await owner.content()).includes('Löneutmätning, Kronofogden mål KFM-Ulf'), 'raden på lönespecen');
  await owner.click('button:has-text("Bokför lönekörning")');
  await owner.locator('text=Lönekörningen är bokförd').waitFor();
  await owner.goto(LU + '/lon/utmatning');
  assert(nb(await owner.locator('.ut-unpaid').innerText()) === '5000,00', 'att betala in till Kronofogden');
  await owner.click('button:has-text("Bokför inbetalning till Kronofogden")');
  await owner.locator('text=5 000,00 kr är bokfört som inbetalt').waitFor();
  await owner.goto(LU + '/lon/utmatning');
  assert(!(await owner.locator('.ut-unpaid').count()) && (await text(owner)).includes('Inbetald'), 'redovisat per månad');
  log('löneutmätning: 5 000 kr dras på nettolönen mot 2750, förbehållsbeloppet skyddar, inbetalning till Kronofogden och redovisning per månad');

  // ================= Del 4: slutlön =================
  const SL = await newCompany('Slutlönen AB', 559340000);
  await voucher(SL, 'Aktiekapital', [[1930, 500000], [2081, -500000]], `${YEAR}-01-02`);
  await owner.goto(SL + '/lon/anstallda');
  await owner.fill('input[name=first_name]', 'Sara'); await owner.fill('input[name=last_name]', 'Slutar');
  await owner.fill('input[name=personal_number]', '19811218-9876'); await owner.fill('input[name=monthly_salary]', '40000'); await owner.fill('input[name=tax_table]', '32');
  await owner.click('form:has(input[name=first_name]) button:has-text("Spara")'); await owner.waitForURL(/ok=/);
  await owner.goto(SL + '/lon');
  const MM = String(MONTH).padStart(2, '0');
  await owner.fill('input[name=period]', `${YEAR}-${MM}`); await owner.fill('input[name=payment_date]', day(0));
  await owner.click('button:has-text("Ny lönekörning")');
  await owner.waitForURL(/lon\/\d+\?ok/);
  const slRun = owner.url().split('?')[0];
  await owner.goto(SL + '/lon/anstallda');
  await owner.locator('a:has-text("Sara Slutar")').first().click();
  await owner.waitForURL(/anstallda\/\d+/);
  const empUrl = owner.url().split('?')[0];
  await owner.goto(empUrl + `/slutlon?slut=${YEAR}-${MM}-15`);
  assert(nb(await owner.locator('input[name=unused_days]').inputValue()) === '25', 'årets outtagna dagar från semestersaldot');
  await owner.fill('input[name=unused_days]', '5'); await owner.fill('input[name=saved_days]', '2'); await owner.fill('input[name=earned_days]', '10');
  await owner.selectOption('select[name=reason]', 'arbetsgivare');
  await owner.click('button:has-text("Lägg slutlönen på lönespecen")');
  await owner.locator('.flash').first().waitFor();
  t = nb(await owner.locator('.flash').first().innerText());
  const dim = new Date(Date.UTC(YEAR, MONTH, 0)).getUTCDate();
  const salary = (Math.round(4000000 * 15 / dim) / 100).toFixed(2).replace('.', ',');
  assert(t.includes(`lön${salary}kr`) && t.includes('semesterersättning34204,00krför17dagar') && t.includes('Anställningenäravslutad'), 'slutlön: ' + t);
  await owner.goto(empUrl + '/slutlon');
  assert(await owner.locator('.fp-done').count() === 1 && !(await owner.locator('.fp-form').count()), 'slutlönen beräknas en gång');
  await owner.goto(slRun);
  t = await owner.content();
  assert(t.includes('Semesterersättning 17 dagar') && t.includes(`(15 av ${dim} dagar)`), 'raderna på lönespecen');
  await owner.goto(empUrl + '/intyg');
  assert((await text(owner)).includes(`${YEAR}-${MM}-15`), 'slutdatum i arbetsgivarintyget');
  log(`slutlön: lön för 15 av ${dim} dagar, semesterersättning för 17 dagar (outtagna, sparade och intjänade), anställningen avslutas och syns i arbetsgivarintyget`);

  // ================= Del 5: kassaregister med kontrollenhet =================
  const KR = await newCompany('Butiken AB', 559350000);
  const reg = async (unit) => {
    await owner.goto(KR + '/kassa/register');
    await owner.fill('input[name=control_unit]', unit); await owner.fill('input[name=registered_on]', day(3));
    await owner.check('input[name=day_7]');
    await owner.click('button:has-text("Registrera kassaregister")');
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  assert((await reg('X1')).includes('8–40'), 'ogiltigt tillverkningsnummer');
  await reg('KE-2026-123456');
  const zRep = async (register, d) => {
    await owner.goto(KR + '/kassa');
    await owner.fill('input[name=date]', d); await owner.fill('input[name=register]', register); await owner.fill('input[name=z_number]', `Z-${d}-${register}`);
    await owner.fill('input[name=sales_25]', '1250'); await owner.fill('input[name=pay_card]', '1250');
    await owner.click('button:has-text("Bokför dagskassa")');
    await owner.locator('text=Dagskassan är bokförd').waitFor();
  };
  await zRep('Kassa 1', day(1)); await zRep('Kassa 1', day(2));
  await owner.goto(KR + '/kassa/register');
  t = await owner.locator('.kr-register[data-name="Kassa 1"] .kr-missing').innerText();
  assert(t.includes(day(3)) && !t.includes(day(1)), 'Z-rapport saknas för en öppetdag: ' + t);
  await zRep('Kassa 1', day(3));
  await owner.goto(KR + '/kassa/register');
  assert(await owner.locator('.kr-register[data-name="Kassa 1"] .kr-ok').count() === 1, 'alla öppetdagar har Z-rapport');
  await zRep('Kassa 2', day(1));
  await owner.goto(KR + '/kassa/register');
  assert((await owner.locator('.kr-unregistered').innerText()).includes('Kassa 2'), 'kassa utan anmäld kontrollenhet');
  assert(nb(await owner.locator('.kr-sales').innerText()) === '5000,00' && (await owner.locator('.kr-obliged').innerText()).includes('Under fyra prisbasbelopp'), 'kassaregisterplikt först över fyra prisbasbelopp');
  await owner.fill('form:has(button:has-text("Spara X-rapport")) input[name=amount]', '640');
  await owner.click('button:has-text("Spara X-rapport")');
  await owner.locator('text=X-rapporten är sparad').waitFor();
  assert(await owner.locator('.kr-x tr').count() === 1, 'X-rapport sparad');
  log('kassaregister: kontrollenhet anmäld, saknad Z-rapport för en öppetdag, kassa utan kontrollenhet flaggas, gräns för kassaregisterplikt och X-rapport');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 26: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
