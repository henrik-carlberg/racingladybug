// End-to-end, omgång 13: föreningar, fastighet och uthyrning, K3 och kassaflödesanalys, import och tull, företagsinloggning.
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

  // ================= Del 1: föreningar =================
  await owner.goto(B + '/forening');
  await owner.click('button.enable-association');
  await owner.locator('text=Föreningsläget är på').waitFor();
  const addM = async (name, email, category, joined) => {
    await owner.goto(B + '/forening');
    await owner.fill('form:has(button:has-text("Lägg till medlem")) input[name=name]', name);
    await owner.fill('form:has(button:has-text("Lägg till medlem")) input[name=email]', email);
    await owner.fill('form:has(button:has-text("Lägg till medlem")) input[name=category]', category);
    await owner.fill('form:has(button:has-text("Lägg till medlem")) input[name=joined]', joined);
    await owner.click('button:has-text("Lägg till medlem")');
    await owner.locator('text=är registrerad').waitFor();
  };
  await addM('Anna Medlem', 'anna@example.com', 'Ordinarie', `${YEAR}-01-10`);
  await addM('Bert Ungdom', 'bert@example.com', 'Ungdom', `${YEAR}-02-01`);
  await addM('Cilla Ledig', '', 'Ordinarie', `${YEAR - 2}-05-01`);
  t = await text(owner);
  assert(/1 Anna Medlem Ordinarie/.test(t) && /3 Cilla Ledig/.test(t) && (await owner.locator('.member-count').innerText()) === '3', 'medlemsregister: ' + t.slice(0, 1500));
  await owner.locator('tr.member:has-text("Cilla Ledig") button:has-text("Utträde")').click();
  await owner.locator('text=Utträdet är registrerat').waitFor();
  log('medlemsregister med löpnummer, kategori, inträde och utträde');

  const setRate = async (cat, amt) => {
    await owner.goto(B + '/forening');
    await owner.fill('form:has(button:has-text("Spara")):has(input[name=amount]) input[name=category]', cat);
    await owner.fill('form:has(input[name=amount]):has(input[name=category]) input[name=amount]', amt);
    await owner.click('form:has(input[name=amount]):has(input[name=category]) button:has-text("Spara")');
    await owner.locator('text=Avgiften är sparad').waitFor();
  };
  await setRate('Ordinarie', '300');
  await setRate('Ungdom', '100');
  await owner.goto(B + '/forening');
  await owner.click('button:has-text("Avisera")');
  await owner.locator('text=2 avier är skapade och bokförda').waitFor();
  t = await text(owner);
  assert(/Anna Medlem 300,00/.test(t) && /Bert Ungdom 100,00/.test(t) && !/Cilla Ledig 300/.test(t), 'avier: ' + t.slice(0, 2500));
  assert((await owner.locator('tr.fee .fee-status').first().innerText()) === 'Obetald', 'status');
  await owner.click('button:has-text("Avisera")');
  await owner.locator('.flash.error, .flash:has-text("inga medlemmar att avisera")').first().waitFor();
  log('medlemsavgiften aviseras per kategori som momsfri faktura med OCR – en gång per medlem och år');

  await owner.locator('tr.fee:has-text("Anna Medlem") a').click();
  await owner.waitForURL(/\/fakturor\/\d+/);
  t = await text(owner);
  assert(t.includes('Medlemsavgift') && t.includes('300,00'), 'fakturan: ' + t.slice(0, 1500));
  // Betalning registreras som vanligt (Swish/autogiro/bankgiro matchar OCR-numret)
  await owner.click('button:has-text("Registrera inbetalning")');
  await owner.locator('text=Inbetalningen är bokförd').waitFor();
  await owner.goto(B + '/forening');
  assert((await owner.locator('tr.fee:has-text("Anna Medlem") .fee-status').innerText()) === 'Betald', 'betald');
  await owner.goto(B + '/rapporter/huvudbok?account=3890');
  t = await text(owner);
  assert(t.includes('3890') && t.includes('400,00'), 'huvudbok 3890: ' + t.slice(0, 1500));
  log('betald avgift syns i medlemsregistret och intäkten är bokförd på 3890 Medlemsavgifter');

  await owner.goto(B + '/forening');
  await owner.selectOption('select[name=kind]', 'grant');
  await owner.fill('input[name=donor]', 'Kommunen');
  await owner.fill('form:has(input[name=donor]) input[name=amount]', '5000');
  await owner.fill('form:has(input[name=donor]) input[name=purpose]', 'Ungdomsverksamhet');
  await owner.check('input[name=restricted]');
  await owner.fill('form:has(input[name=donor]) input[name=date]', day(0));
  await owner.click('button:has-text("Bokför")');
  await owner.locator('text=Bidraget är bokfört').waitFor();
  t = await text(owner);
  assert(/Bidrag Kommunen Ungdomsverksamhet.*ändamålsbestämt.*5[\s ]000,00/.test(t) && t.includes('varav ändamålsbestämt 5 000,00'), 'bidrag: ' + t.slice(0, 2500));
  await owner.locator('tr.gift a:has-text("Verifikation")').click();
  await owner.waitForURL(/\/verifikationer\/\d+/);
  t = await text(owner);
  assert(t.includes('1930') && t.includes('3980') && t.includes('5 000,00'), 'verifikation bidrag: ' + t.slice(0, 1500));
  log('bidrag och gåvor bokförs mot 3980/3985 och ändamålsbestämda medel visas separat');

  await owner.goto(B + '/forening');
  await owner.fill('form:has(button:has-text("Spara årsmötet")) input[name=date]', `${YEAR + 1}-03-15`);
  await owner.fill('form:has(button:has-text("Spara årsmötet")) input[name=place]', 'Klubbhuset');
  await owner.click('button:has-text("Spara årsmötet")');
  await owner.locator('text=Årsmötet är sparat').waitFor();
  assert((await owner.locator('.notice-deadline').innerText()) === `${YEAR + 1}-03-01`, 'sista kallelsedag');
  await owner.click('button:has-text("Skicka kallelse")');
  await owner.locator('text=Kallelsen är skickad till').waitFor();
  t = await text(owner);
  assert(/Kallelsen är skickad till \d av 2 medlemmar/.test(t) && (await owner.locator('.notice-sent').count()) === 1, 'kallelse: ' + t.slice(0, 1000));
  log('kallelse till årsmötet med dagordning skickas till aktiva medlemmar, med sista dag enligt stadgarna');

  await owner.fill('textarea[name=text]', 'Föreningen har haft träningar varje vecka.');
  await owner.fill('input[name=board_name_0]', 'Ordförande Olle');
  await owner.fill('input[name=board_email_0]', 'olle@example.com');
  await owner.click('form:has(textarea[name=text]) button:has-text("Skapa för underskrift")');
  await owner.waitForURL(/\/dokument\/\d+/);
  t = await text(owner);
  assert(t.includes('Verksamhetsberättelse') && t.includes('Ordförande Olle'), 'verksamhetsberättelse: ' + t.slice(0, 1500));
  await owner.goto(B + '/forening');
  await owner.fill('input[name=auditor_name_0]', 'Revisor Rut');
  await owner.click('form:has(input[name=auditor_name_0]) button:has-text("Skapa för underskrift")');
  await owner.waitForURL(/\/dokument\/\d+/);
  t = await text(owner);
  assert(t.includes('Revisionsberättelse') && t.includes('Revisor Rut'), 'revisionsberättelse: ' + t.slice(0, 1500));
  await owner.goto(B + '/forening');
  assert((await owner.locator('a:has-text("Visa verksamhetsberättelsen")').count()) === 1 && (await owner.locator('a:has-text("Visa revisionsberättelsen")').count()) === 1, 'länkar');
  log('verksamhetsberättelse med RR/BR och revisionsberättelse skapas som dokument för digital underskrift');

  await owner.click('button:has-text("Stäng av föreningsläget")');
  await owner.locator('text=Föreningsläget är av').waitFor();

  //@@NEXT@@
  await browser.close(); mailServer.close();
  console.log('Omgång 13: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
