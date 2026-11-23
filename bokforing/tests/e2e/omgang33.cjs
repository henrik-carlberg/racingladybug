// End-to-end, omgång 33: kundprisavtal, kommissionsförsäljning, egen elproduktion, lantbruk, indexuppräkning.
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

  // ================= Del 1: kundprisavtal =================
  const PA = await newCompany('Grossisthandeln AB', 559800000);
  await owner.goto(PA + '/moduler');
  await owner.locator('.card:has(h2:text-is("Inköp, lager och logistik")) button:has-text("Aktivera")').click(); await owner.waitForURL(/ok=/);
  await owner.goto(PA + '/m/lager/artiklar');
  await owner.fill('input[name=sku]', 'P-1'); await owner.fill('input[name=name]', 'Kaffebönor');
  await owner.fill('input[name=purchase_price]', '60'); await owner.fill('input[name=sales_price]', '100'); await owner.fill('input[name=opening_qty]', '200');
  await owner.click('button:has-text("Lägg upp artikel")'); await owner.locator('text=Artikeln är upplagd').waitFor();
  for (const n of ['Grossisten AB', 'Specialkund AB']) {
    await owner.goto(PA + '/kunder'); await owner.fill('input[name=name]', n); await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  }
  await owner.goto(PA + '/prisavtal');
  await owner.fill('form:has(button:has-text("Lägg upp grupp")) input[name=name]', 'Grossister'); await owner.fill('form:has(button:has-text("Lägg upp grupp")) input[name=discount_pct]', '10');
  await owner.click('button:has-text("Lägg upp grupp")'); await owner.locator('text=Kundgruppen är upplagd').waitFor();
  await owner.selectOption('form:has(button:has-text("Spara grupp")) select[name=customer_id]', { label: 'Grossisten AB' });
  await owner.selectOption('form:has(button:has-text("Spara grupp")) select[name=group_id]', { label: 'Grossister' });
  await owner.click('button:has-text("Spara grupp")'); await owner.locator('text=Kundens grupp är sparad').waitFor();
  const agree = async (party, f) => {
    await owner.goto(PA + '/prisavtal');
    await owner.selectOption('select[name=party]', { label: party });
    for (const k of ['net_price', 'discount_pct', 'min_qty', 'valid_to']) await owner.fill(`form:has(button:has-text("Lägg upp avtal")) input[name=${k}]`, f[k] ?? '');
    await owner.click('button:has-text("Lägg upp avtal")'); await owner.locator('text=Prisavtalet är upplagt').waitFor();
  };
  await agree('Grupp: Grossister', { discount_pct: '15', min_qty: '50' });
  await agree('Specialkund AB', { net_price: '80', valid_to: day(-10) });
  assert(await owner.locator('.pa-row[data-party="Specialkund AB"] .pa-expiring').count() === 1, 'avtalet går snart ut');
  const order = async (cust, q) => {
    await owner.goto(PA + '/m/lager/order');
    await owner.selectOption('select[name=customer_id]', { label: cust });
    await owner.selectOption('select[name=product_0]', await owner.locator('select[name=product_0] option:has-text("P-1 ")').first().getAttribute('value'));
    await owner.fill('input[name=qty_0]', q);
    await owner.click('button:has-text("Skapa kundorder")'); await owner.locator('text=Kundordern är skapad').waitFor();
    await owner.goto(PA + '/prisavtal');
    return nb(await owner.locator(`.pa-margins tr[data-customer="${cust}"] .pa-rev`).innerText());
  };
  t = await order('Grossisten AB', '10'); assert(t === '900,00', 'grupprabatt 10 %: ' + t);
  t = await order('Grossisten AB', '60'); assert(t === '6000,00', 'volymrabatt 15 % från 50 st (900 + 5 100): ' + t);
  t = await order('Specialkund AB', '5'); assert(t === '400,00', 'kundens nettopris 80 kr: ' + t);
  await owner.goto(PA + '/prisavtal');
  assert(nb(await owner.locator('.pa-margins tr[data-customer="Grossisten AB"] .pa-pct').innerText()) === '30%', 'marginal grossist: ' + await owner.locator('.pa-margins').innerText());
  assert(nb(await owner.locator('.pa-margins tr[data-customer="Specialkund AB"] .pa-pct').innerText()) === '25%', 'marginal specialkund');
  log('kundprisavtal: grupprabatt, volymrabatt från 50 st och kundens nettopris sätts automatiskt på kundordern, varning när avtal går ut, marginal per kund');

  // ================= Del 2: kommissionsförsäljning =================
  const KS = await newCompany('Second hand-butiken AB', 559810000);
  await owner.goto(KS + '/kommission');
  for (const [n, pct, vat] of [['Privat Säljare', '30', false], ['Antikhandlaren AB', '20', true]]) {
    await owner.fill('form:has(button:has-text("Lägg upp huvudman")) input[name=name]', n); await owner.fill('input[name=commission_pct]', pct);
    if (vat) await owner.check('input[name=vat_registered]'); else await owner.uncheck('input[name=vat_registered]');
    await owner.click('button:has-text("Lägg upp huvudman")'); await owner.locator('text=Huvudmannen är upplagd').waitFor();
    await owner.goto(KS + '/kommission');
  }
  for (const [pr, d, ask] of [['Privat Säljare', 'Teakbyrå', '2500'], ['Antikhandlaren AB', 'Spegel', '1250'], ['Privat Säljare', 'Lampa', '400']]) {
    await owner.goto(KS + '/kommission');
    await owner.selectOption('form:has(button:has-text("Ta emot vara")) select[name=principal_id]', { label: pr });
    await owner.fill('form:has(button:has-text("Ta emot vara")) input[name=description]', d); await owner.fill('input[name=ask_price]', ask);
    await owner.click('button:has-text("Ta emot vara")'); await owner.locator('text=Varan är mottagen i kommission').waitFor();
  }
  const cm = (d) => owner.locator(`.cm-row[data-description="${d}"]`);
  await owner.goto(KS + '/kommission');
  await cm('Teakbyrå').locator('button:has-text("Sålt")').click(); await owner.locator('text=Försäljningen är bokförd').waitFor();
  t = nb(await owner.locator('.flash').first().innerText()); assert(t.includes('provision600,00kr') && t.includes('moms500,00kr') && t.includes('huvudmannen1400,00kr'), 'privat huvudman: ' + t);
  await owner.goto(KS + '/kommission');
  await cm('Spegel').locator('button:has-text("Sålt")').click(); await owner.locator('text=Försäljningen är bokförd').waitFor();
  t = nb(await owner.locator('.flash').first().innerText()); assert(t.includes('provision200,00kr') && t.includes('huvudmannen1000,00kr'), 'momsregistrerad huvudman: ' + t);
  await owner.goto(KS + '/kommission');
  await cm('Lampa').locator('button:has-text("Återlämna")').click(); await owner.locator('text=Varan är återlämnad').waitFor();
  assert(nb(await owner.locator('.cm-debt').innerText()) === '2400,00', 'skuld till huvudmän 2895');
  await owner.locator('.cm-prow[data-name="Privat Säljare"] button:has-text("Avräkna och betala ut")').click(); await owner.locator('text=Avräkningen är bokförd').waitFor();
  assert(nb(await owner.locator('.cm-nota-total').innerText()) === '1400,00' && (await owner.locator('.cm-nota').innerText()).includes('Teakbyrå'), 'avräkningsnota');
  assert(nb(await owner.locator('.cm-debt').innerText()) === '1000,00', 'kvar att avräkna');
  await owner.goto(KS + '/verifikationer');
  await owner.locator('tr:has-text("Kommissionsförsäljning: Spegel") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('3045') && t.includes('2611') && t.includes('2641') && t.includes('2895') && t.includes('1000,00'), 'kontering med huvudmannens moms: ' + t.slice(0, 700));
  log('kommissionsförsäljning: moms på hela priset, provisionen som intäkt och resten som skuld till huvudmannen, huvudmannens moms vid momsregistrering, återlämning och avräkningsnota');

  // ================= Del 3: egen elproduktion =================
  const PY = YEAR - 1;
  await owner.goto(BASE + '/');
  await owner.fill('input[name=name]', 'Solgårdens firma');
  await owner.selectOption('select[name=company_type]', 'EF');
  await owner.fill('input[name=orgnr]', `19${orgnrFor('750101' + String(100 + (Date.now() % 800)).padStart(3, '0'))}`);
  await owner.fill('input[name=fy_start]', `${PY}-01-01`); await owner.fill('input[name=fy_end]', `${PY}-12-31`);
  await owner.click('button:has-text("Skapa bolag")'); await owner.waitForURL(/kom-igang/);
  const EP = owner.url().replace(/\/kom-igang.*/, '');
  await owner.goto(EP + '/elproduktion');
  await owner.fill('form:has(button:has-text("Lägg upp anläggning")) input[name=name]', 'Solceller ladugård'); await owner.fill('input[name=capacity_kw]', '12');
  await owner.fill('input[name=investment]', '11000'); await owner.fill('input[name=start_date]', `${PY}-03-01`);
  await owner.click('button:has-text("Lägg upp anläggning")'); await owner.locator('text=Anläggningen är upplagd').waitFor();
  const month = async (period, produced, sold, bought, amount) => {
    await owner.goto(EP + `/elproduktion?year=${PY}`);
    const f = owner.locator('form:has(button:has-text("Registrera månad"))');
    await f.locator('input[name=period]').fill(period); await f.locator('input[name=produced_kwh]').fill(produced); await f.locator('input[name=sold_kwh]').fill(sold);
    await f.locator('input[name=bought_kwh]').fill(bought); await f.locator('input[name=sold_amount]').fill(amount);
    await f.locator('button').click();
  };
  await month(`${PY}-06`, '100', '700', '0', '0'); await owner.locator('text=Såld el kan inte vara mer än den producerade').waitFor();
  await month(`${PY}-06`, '1200', '700', '100', '420'); await owner.locator('text=försäljningen 420,00 kr').waitFor();
  await month(`${PY}-07`, '1300', '800', '150', '480'); await owner.locator('text=Månaden är registrerad').waitFor();
  await owner.goto(EP + `/elproduktion?year=${PY}`);
  const cf = owner.locator('form:has(button:has-text("Bokför försäljning"))');
  await cf.locator('input[name=quantity]').fill('10'); await cf.locator('input[name=amount]').fill('200'); await cf.locator('input[name=date]').fill(`${PY}-12-15`);
  await cf.locator('button').click(); await owner.locator('text=Försäljningen 200,00 kr exkl. moms är bokförd').waitFor();
  const pl = owner.locator('.pw-plant[data-name="Solceller ladugård"]');
  assert(nb(await pl.locator('.pw-produced').innerText()) === '2500kWh' && nb(await pl.locator('.pw-sold').innerText()) === '1500kWh' && nb(await pl.locator('.pw-own').innerText()) === '1000kWh', 'produktionsår');
  assert(nb(await pl.locator('.pw-revenue').innerText()) === '1100,00' && nb(await pl.locator('.pw-payback').innerText()) === '10år', 'intäkter och återbetalningstid');
  t = nb(await pl.locator('.pw-reduction').innerText());
  assert(t.includes('250kWh') && (PY <= 2025 ? t.includes('150,00kr') : t.includes('kontrolleraholsSkatteverket')), 'skattereduktion begränsad av köpt el: ' + t);
  await owner.goto(EP + '/verifikationer');
  await owner.locator(`tr:has-text("Såld el ${PY}-06") a`).first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('3060') && t.includes('2611') && t.includes('525,00'), 'elförsäljning med moms: ' + t.slice(0, 600));
  log('egen elproduktion: producerad och såld el per månad med moms på försäljningen, elcertifikat, egen förbrukning, återbetalningstid och underlag för skattereduktion');

  // ================= Del 4: lantbruk =================
  const LB = await newCompany('Gården AB', 559820000);
  if (Number(day(1).slice(0, 4)) !== YEAR) await addFy(LB, YEAR - 1);
  await owner.goto(LB + '/lantbruk');
  await owner.fill('input[name=kind]', 'Gårdsstöd'); await owner.fill('input[name=applied]', '120000');
  await owner.click('button:has-text("Registrera ansökan")'); await owner.locator('text=Stödansökan är registrerad').waitFor();
  const srow = () => owner.locator('.fm-row[data-kind="Gårdsstöd"]');
  await srow().locator('form:has(button:has-text("Bokför fordran")) input[name=amount]').fill('115000');
  await srow().locator('button:has-text("Bokför fordran")').click(); await owner.locator('text=Fordran 115 000,00 kr är bokförd för stödåret').waitFor();
  assert(nb(await owner.locator('.fm-receivable').innerText()) === '115000,00', 'fordran 1684');
  await srow().locator('form:has(button:has-text("Utbetalt")) input[name=amount]').fill('116500');
  await srow().locator('button:has-text("Utbetalt")').click(); await owner.locator('text=skillnad mot fordran 1 500,00 kr').waitFor();
  assert(nb(await owner.locator('.fm-receivable').innerText()) === '0,00' && await owner.locator('.fm-row[data-status="paid"]').count() === 1, 'fordran upplöst');
  for (const [n, v] of [['Mjölkkor', '15000'], ['Kalvar', '3000']]) {
    await owner.fill('form:has(button:has-text("Spara djurslag")) input[name=name]', n); await owner.fill('input[name=value_per_head]', v);
    await owner.click('button:has-text("Spara djurslag")'); await owner.locator('text=Djurslaget är sparat').waitFor();
    await owner.goto(LB + '/lantbruk');
  }
  const countHerd = async (d, cows, calves) => {
    await owner.goto(LB + '/lantbruk');
    await owner.fill('input[aria-label="Antal Mjölkkor"]', cows); await owner.fill('input[aria-label="Antal Kalvar"]', calves);
    await owner.fill('form:has(button:has-text("Värdera och bokför")) input[name=date]', d);
    await owner.click('button:has-text("Värdera och bokför")'); await owner.locator('text=Djurinventeringen är värderad').waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await countHerd(day(1), '40', '10'); assert(t.includes('630000,00kr') && t.includes('förändring630000,00kr'), 'första inventeringen: ' + t);
  t = await countHerd(day(0), '38', '15'); assert(t.includes('615000,00kr') && (t.includes('-15000,00') || t.includes('−15000,00')), 'minskat djurlager: ' + t);
  await owner.goto(LB + '/verifikationer');
  await owner.locator('tr:has-text("40 Mjölkkor") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('1450') && t.includes('4950') && t.includes('630000,00'), 'djurlager 1450/4950: ' + t.slice(0, 600));
  log('lantbruk: EU-stöd som fordran för stödåret, utbetalning med skillnad mot intäkten, djurinventering per djurslag med bokförd lagerförändring');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 33: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
