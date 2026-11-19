// End-to-end, omgång 12: aktiebok, klimatbokföring, lån och finansiering, moms för e-handel inom EU, koncerninterna flöden.
const { chromium } = require('playwright');
const http = require('node:http');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const text = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); const sel = (await page.locator('main').count()) ? 'main' : 'body'; return (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').replace(/ /g, ' '); };
const iso = (d) => d.toISOString().slice(0, 10);
const day = (n) => iso(new Date(Date.now() - n * 864e5));

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

  // ================= Del 1: aktiebok och ägarfrågor =================
  await owner.goto(B + '/aktiebok');
  await owner.fill('input[name=share_capital]', '25000');
  await owner.fill('input[name=date]', '2026-01-01');
  await owner.fill('input[name=name_0]', 'Ägare Testsson'); await owner.fill('input[name=id_0]', '19800101-0019'); await owner.fill('input[name=shares_0]', '600');
  await owner.fill('input[name=name_1]', 'Bo Delägare'); await owner.fill('input[name=id_1]', '19770303-0408'); await owner.fill('input[name=shares_1]', '400');
  await owner.click('button:has-text("Lägg upp aktieboken")');
  await owner.locator('text=Aktieboken är upplagd').waitFor();
  t = await text(owner);
  assert(t.includes('25 000,00') && /Ägare Testsson.*1–600.*600.*60 %/.test(t) && /Bo Delägare.*601–1000.*400.*40 %/.test(t) && t.includes('Kvotvärde 25,00'), 'aktiebok: ' + t.slice(0, 1500));
  log('aktiebok med aktienummer, kapital- och röstandel och kvotvärde');

  await owner.selectOption('select[name=from]', { label: 'Ägare Testsson (600 st)' });
  await owner.fill('form:has(select[name=from]) input[name=shares]', '100');
  await owner.fill('input[name=to_name]', 'Investerare Ida');
  await owner.fill('input[name=to_id]', '19900101-1239');
  await owner.fill('input[name=price]', '50000');
  await owner.click('button:has-text("För in överlåtelsen")');
  await owner.locator('text=Överlåtelsen är införd i aktieboken').waitFor();
  t = await text(owner);
  assert(/Ägare Testsson.*101–600.*500.*50 %/.test(t) && /Investerare Ida.*1–100.*100.*10 %/.test(t) && t.includes('Ägare Testsson överlät 100 B-aktier (nr 1–100) till Investerare Ida för 50 000,00 kr'), 'överlåtelse: ' + t.slice(0, 2000));
  await owner.goto(B + '/agare');
  assert(/Ägare Testsson · 50 %/.test(await text(owner)), 'K10-ägarnas andel följer aktieboken: ' + (await text(owner)).slice(0, 1200));
  log('överlåtelse flyttar aktienummer till köparen och ägarandelen för K10 uppdateras');

  await owner.goto(B + '/aktiebok');
  await owner.fill('input[name=new_shares]', '100');
  await owner.fill('form:has(input[name=new_shares]) input[name=price]', '500');
  await owner.click('button:has-text("Besluta om nyemission")');
  await owner.locator('text=Beslutet om nyemission är skickat för signering').waitFor();
  const issue = owner.locator('.issue[data-status=decided]');
  assert((await issue.innerText()).replace(/\s+/g, ' ').includes('Totalt 50 000,00 kr: aktiekapital 2 500,00 kr, överkurs 47 500,00 kr'), 'emissionen: ' + await issue.innerText());
  for (const [n, id, c] of [['Investerare Ida', '19900101-1239', '60'], ['Ny Ägare AB', '556677-8899', '40']]) {
    await owner.fill('.issue input[name=name]', n); await owner.fill('.issue input[name=holder_id]', id); await owner.fill('.issue input[name=shares]', c);
    await owner.click('.issue button:has-text("För in teckning")');
    await owner.locator('text=Teckningen är införd').waitFor();
  }
  await owner.click('.issue button:has-text("Bokför inbetalningen")');
  await owner.locator('text=Inbetalningen är bokförd').waitFor();
  t = await text(owner);
  assert(t.includes('Underlag till Bolagsverket') && t.includes('ökar från 25 000,00 kr till 27 500,00 kr') && t.includes('från 1000 till 1100'), 'underlag: ' + t.slice(0, 2500));
  await owner.click('.issue button:has-text("Registrerad – uppdatera aktieboken")');
  await owner.locator('text=Emissionen är registrerad').waitFor();
  t = await text(owner);
  assert(t.includes('27 500,00') && /1[\s ]100/.test(t) && /Ny Ägare AB.*1061–1100.*40/.test(t) && /Investerare Ida.*1–100, 1001–1060.*160/.test(t), 'efter registrering: ' + t.slice(0, 2500));
  await owner.goto(B + '/dokument');
  assert((await text(owner)).includes('Beslut om nyemission'), 'protokollet finns för signering');
  log('nyemission: beslut med protokoll för e-signering, teckning, inbetalning bokförd (2082/2097), underlag till Bolagsverket och registrering (2081, nya aktienummer)');

  await owner.goto(B + '/aktiebok');
  await owner.fill('input[name=present]', 'Ägare Testsson, Bo Delägare');
  await owner.fill('textarea[name=items]', 'Mötet öppnades\nStyrelsen beslutade att teckna leasingavtal för bil\nMötet avslutades');
  await owner.fill('input[name=sname_0]', 'Bo Delägare'); await owner.fill('input[name=semail_0]', 'bo.delagare@example.com');
  await owner.click('button:has-text("Skicka för e-signering")');
  await owner.locator('text=Protokollet är skickat för e-signering').waitFor();
  log('styrelseprotokoll skickas för e-signering');

  // ================= Del 2: klimatbokföring =================
  await owner.goto(B + '/klimat');
  const ton = async (sel) => Number((await owner.locator(sel).innerText()).replace(/\s| /g, '').replace('ton', '').replace(',', '.'));
  const tot0 = await ton('.climate-total');
  const s1 = await ton('[data-scope="1"]'), s2 = await ton('[data-scope="2"]'), s3 = await ton('[data-scope="3"]');
  assert(tot0 > 0 && Math.abs(tot0 - (s1 + s2 + s3)) < 0.21, 'totalt = scope 1+2+3: ' + [tot0, s1, s2, s3]);
  t = await text(owner);
  assert(t.includes('Största källorna') && /Schablon på [\d\s ]+ kr/.test(t) && t.includes('Per månad'), 'rapport: ' + t.slice(0, 1500));
  log('utsläpp räknas fram ur bokföringen per kategori och scope 1–3, med trend per månad');

  await owner.selectOption('select[name=kind]', 'diesel_l');
  await owner.fill('input[name=quantity]', '500');
  await owner.fill('input[name=note]', 'Tankning enligt kort');
  await owner.click('form:has(select[name=kind]) button:has-text("Spara")');
  await owner.locator('text=Mängden är sparad').waitFor();
  t = await text(owner);
  assert(/Diesel 1 Mängd 1[\s ]300/.test(t), 'exakt mängd: ' + t.slice(0, 2000));
  assert(!t.includes('Drivmedel till egna fordon 1 Schablon'), 'schablonen för drivmedel ersatt');
  const tot1 = await ton('.climate-total');
  const csv = await (await owner.request.get(`${B}/klimat/csv?ar=${day(0).slice(0, 4)}`)).text();
  assert(csv.includes('Kategori;Scope;Källa;Kostnad (kr);kg CO2e') && csv.includes('"Diesel";1;Mängd;0,00;1300'), 'csv: ' + csv.slice(0, 600));
  await owner.click('summary:has-text("Faktorer per kategori")');
  await owner.fill('input[aria-label="Faktor Inköp av varor och material"]', '0');
  await owner.click('form:has(input[aria-label="Faktor Inköp av varor och material"]) button');
  await owner.locator('text=Faktorn är sparad').waitFor();
  assert(await ton('.climate-total') <= tot1, 'egen faktor används');
  log('exakta mängder (liter, kWh) ersätter schablonen, egna faktorer per kategori och underlag som CSV');

  //@@NEXT@@
  await browser.close(); mailServer.close();
  console.log('Omgång 12: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
