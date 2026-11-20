// End-to-end, omgång 15: handelsbolag, skatteplanering för enskild firma, successiv vinstavräkning, abonnemangsintäkter, kostnadsfördelning.
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

const mailServer = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"m1"}'); }); }).listen(3303);

const luhn = (s) => { let sum = 0; for (let i = 0; i < s.length; i++) { let v = Number(s[s.length - 1 - i]); if (i % 2 === 1) { v *= 2; if (v > 9) v -= 9; } sum += v; } return sum % 10 === 0; };
const orgnrFor = (prefix) => { for (let i = 0; i < 10; i++) { const s = prefix + String(i); if (luhn(s)) return `${s.slice(0, 6)}-${s.slice(6)}`; } };

(async () => {
  const browser = await chromium.launch();
  const owner = await login(browser, 'agare@example.com', 'hemligtlosen1');
  let t;
  const nb = (s) => s.replace(/[\s  ]/g, '');

  // ================= Del 1: handelsbolag och kommanditbolag =================
  await owner.goto(BASE + '/');
  await owner.fill('input[name=name]', 'Bröderna Test HB');
  await owner.selectOption('select[name=company_type]', 'HB');
  await owner.fill('input[name=orgnr]', orgnrFor(String(916000000 + (Date.now() % 900000)).slice(0, 9)));
  await owner.fill('input[name=fy_start]', `${YEAR - 1}-01-01`); await owner.fill('input[name=fy_end]', `${YEAR - 1}-12-31`);
  await owner.click('button:has-text("Skapa bolag")');
  await owner.waitForURL(/kom-igang/);
  const H = owner.url().replace(/\/kom-igang.*/, '');
  await owner.goto(H + '/installningar');
  assert((await owner.locator('input[value="Handelsbolag"]').count()) === 1, 'bolagsform');
  await owner.goto(H + '/agare');
  await owner.waitForURL(/delagare/);
  await owner.fill('input[name=name_1]', 'Anna Delägare'); await owner.fill('input[name=share_1]', '60');
  await owner.fill('input[name=name_2]', 'Bo Delägare'); await owner.fill('input[name=share_2]', '50');
  await owner.click('button:has-text("Spara delägare")');
  await owner.locator('.flash.error, .flash:has-text("ska summera till 100")').first().waitFor();
  await owner.goto(H + '/delagare');
  await owner.fill('input[name=name_1]', 'Anna Delägare'); await owner.fill('input[name=share_1]', '60');
  await owner.fill('input[name=name_2]', 'Bo Delägare'); await owner.fill('input[name=share_2]', '40');
  await owner.click('button:has-text("Spara delägare")');
  await owner.locator('text=Delägarna är sparade').waitFor();
  log('handelsbolag med delägare och andel i resultatet – andelarna ska summera till 100 %');

  await owner.goto(H + '/kunder');
  await owner.fill('input[name=name]', 'HB-kund AB');
  await owner.click('form button:has-text("Spara")');
  await owner.locator('text=Kunden är sparad').waitFor();
  await owner.goto(H + '/fakturor/ny');
  await owner.selectOption('select[name=customer_id]', { label: 'HB-kund AB' });
  await owner.fill('input[name=invoice_date]', `${YEAR - 1}-06-01`);
  const r0 = owner.locator('tbody tr').first();
  await r0.locator('td:nth-child(1) input').fill('Konsult'); await r0.locator('td:nth-child(2) input').fill('1');
  await r0.locator('td:nth-child(3) input').fill('st'); await r0.locator('td:nth-child(4) input').fill('100000');
  await owner.click('button:has-text("Spara utkast")');
  await owner.waitForURL(/fakturor\/\d+\?ok/);
  await owner.click('button:has-text("Bokför faktura")');
  await owner.locator('text=klar att skicka').first().waitFor();
  await owner.fill('input[name=date]', `${YEAR - 1}-06-20`);
  await owner.click('button:has-text("Registrera inbetalning")');
  await owner.locator('text=Inbetalningen är bokförd').waitFor();
  await owner.goto(H + '/delagare');
  await owner.selectOption('form:has(input[name=amount]) select[name=partner]', '1');
  await owner.fill('form:has(input[name=amount]) input[name=amount]', '20000'); await owner.fill('form:has(input[name=amount]) input[name=date]', `${YEAR - 1}-09-01`);
  await owner.click('form:has(input[name=amount]) button:has-text("Bokför")');
  await owner.locator('text=Uttaget är bokfört').waitFor();
  await owner.goto(H + '/delagare');
  const pr = (n) => owner.locator(`tr.partner-row:has-text("${n}")`);
  assert(nb(await pr('Anna').locator('.withdrawals').innerText()) === '20000,00' && nb(await pr('Anna').locator('.share').innerText()).startsWith('60000,00') && nb(await pr('Bo').locator('.share').innerText()).startsWith('40000,00'), 'kapitalkonton');
  assert(nb(await owner.locator('tr.n3b-row:has-text("Anna") .surplus').innerText()) === '60000,00', 'N3B');
  log('egna uttag per delägare och resultatets fördelning med underlag till INK4 och N3B');

  await owner.goto(H + '/bokslut');
  await owner.locator(`tr:has-text("${YEAR - 1}-01-01") a:has-text("Öppna")`).click();
  await owner.waitForURL(/\/bokslut\/\d+$/);
  const hfy = owner.url();
  t = await text(owner);
  assert(t.includes('delägarnas konton för årets resultat') && t.includes('Inkomstdeklaration 4 och delägarnas N3B'), 'bokslutet: ' + t.slice(0, 2000));
  await owner.click('button:has-text("Bokför resultat och stäng året")');
  await owner.locator('text=Årets resultat är bokfört och räkenskapsåret är stängt').waitFor();
  await owner.goto(H + `/rapporter/huvudbok?account=2029&from=${YEAR - 1}-01-01&to=${YEAR - 1}-12-31`);
  assert(nb(await text(owner)).includes('40000,00'), 'Bos andel på 2029');
  await owner.goto(hfy + '/arsredovisning');
  t = await text(owner);
  assert(t.includes('Årsbokslut') && t.includes('handelsbolag') && t.includes('Delägarnas kapitalkonton') && /Anna Delägare 60 % 0 0 −?-?20 000 60 000 40 000/.test(t.replace(/[  ]/g, ' ')), 'årsbokslut: ' + t.slice(0, 3000));
  await owner.goto(hfy + '/deklaration');
  await owner.waitForURL(/delagare/);
  await owner.goto(H + '/deadlines');
  assert((await text(owner)).includes('Inkomstdeklaration 4'), 'INK4 i deadlines');
  log('bokslut: resultatet fördelas på delägarnas 20x9, årsbokslut med kapitalkonton och INK4 bland deadlines');

  // ================= Del 2: skatteplanering för enskild firma =================
  await owner.goto(BASE + '/');
  await owner.fill('input[name=name]', 'Planeringsfirman');
  await owner.selectOption('select[name=company_type]', 'EF');
  const pn = orgnrFor('800101' + String(100 + (Date.now() % 800)).padStart(3, '0'));
  await owner.fill('input[name=orgnr]', `19${pn}`);
  await owner.fill('input[name=fy_start]', `${YEAR - 1}-01-01`); await owner.fill('input[name=fy_end]', `${YEAR - 1}-12-31`);
  await owner.click('button:has-text("Skapa bolag")');
  await owner.waitForURL(/kom-igang/);
  const E = owner.url().replace(/\/kom-igang.*/, '');
  await owner.goto(E + '/kunder');
  await owner.fill('input[name=name]', 'EF-kund AB');
  await owner.click('form button:has-text("Spara")');
  await owner.locator('text=Kunden är sparad').waitFor();
  await owner.goto(E + '/fakturor/ny');
  await owner.selectOption('select[name=customer_id]', { label: 'EF-kund AB' });
  await owner.fill('input[name=invoice_date]', `${YEAR - 1}-05-01`);
  const er = owner.locator('tbody tr').first();
  await er.locator('td:nth-child(1) input').fill('Uppdrag'); await er.locator('td:nth-child(2) input').fill('1');
  await er.locator('td:nth-child(3) input').fill('st'); await er.locator('td:nth-child(4) input').fill('1200000');
  await owner.click('button:has-text("Spara utkast")');
  await owner.waitForURL(/fakturor\/\d+\?ok/);
  await owner.click('button:has-text("Bokför faktura")');
  await owner.locator('text=klar att skicka').first().waitFor();
  await owner.goto(E + '/bokslut');
  await owner.locator(`tr:has-text("${YEAR - 1}-01-01") a:has-text("Öppna")`).click();
  await owner.waitForURL(/\/bokslut\/\d+$/);
  const efy = owner.url();
  await owner.click('a:has-text("Skatteplanering NE")');
  await owner.waitForURL(/ne-planering/);
  await owner.fill('input[name=slr_pct]', '2'); await owner.fill('input[name=municipal_pct]', '32'); await owner.fill('input[name=brytpunkt]', '640000');
  await owner.click('button:has-text("Spara satser")');
  await owner.locator('text=Årets satser är sparade').waitFor();
  const cellv = async (c) => nb(await owner.locator(`tr.${c} td`).nth(2).innerText());
  assert((await cellv('ef-pfond')) === '346600,00' && (await cellv('ef-interest')) === '0,00' && (await cellv('ef-expansion')) === '0,00', 'förslag: ' + (await text(owner)).slice(0, 2000));
  assert(Number(nb(await owner.locator('.ef-saving').innerText()).replace(',', '.')) > 100000, 'besparing');
  log('NE-planering: periodiseringsfond (högst 30 %) och expansionsfond föreslås så att inkomsten hamnar vid brytpunkten');

  await owner.fill('form:has(button:has-text("Bokför avsättningarna")) input[name=pfond]', '400000');
  await owner.click('button:has-text("Bokför avsättningarna")');
  await owner.locator('.flash.error, .flash:has-text("Periodiseringsfonden får vara högst")').first().waitFor();
  await owner.goto(efy + '/ne-planering');
  await owner.click('button:has-text("Bokför avsättningarna")');
  await owner.locator('.ef-booked').waitFor();
  await owner.goto(E + `/rapporter/huvudbok?account=8811&from=${YEAR - 1}-01-01&to=${YEAR - 1}-12-31`);
  assert(nb(await text(owner)).includes('346600,00'), 'periodiseringsfonden bokförd');
  log('avsättningen bokförs inom gränsen (8811 mot 212x) och kan inte överstiga det tillåtna');

  //@@NEXT@@
  await browser.close(); mailServer.close();
  console.log('Omgång 15: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
