// End-to-end, omgång 29: leverantörskrediter, befarade kundförluster, betalningsföreläggande, konsignationslager, ränta och anstånd på skattekontot.
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

  // ================= Del 1: kundbonus =================
  const KB = await newCompany('Bonusgrossisten AB', 559500000);
  if (Number(day(60).slice(0, 4)) !== YEAR) await addFy(KB, YEAR - 1);
  await owner.goto(KB + '/kunder');
  await owner.fill('input[name=name]', 'Kedjan AB');
  await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await invoice(KB, 'Kedjan AB', 400000, day(40));
  await invoice(KB, 'Kedjan AB', 200000, day(30));
  await owner.goto(KB + '/kundbonus');
  await owner.fill('input[name=start_date]', day(60)); await owner.fill('input[name=end_date]', day(5));
  await owner.fill('input[name=tiers]', '500000:2; 1000000:3');
  await owner.click('button:has-text("Lägg upp avtal")'); await owner.locator('text=Bonusavtalet är upplagt').waitFor();
  let row = owner.locator('.rb-row[data-customer="Kedjan AB"]');
  assert(nb(await row.locator('.rb-volume').innerText()) === '600000,00', 'omsättning under perioden');
  assert(nb(await row.locator('.rb-amount').innerText()).startsWith('12000,00'), 'bonus 2 % på hela omsättningen: ' + await row.locator('.rb-amount').innerText());
  await owner.click('button:has-text("Bokför upplupen bonus")'); await owner.locator('text=Upplupen kundbonus har ökats med').waitFor();
  assert(nb(await row.locator('.rb-accrued').innerText()) === '12000,00', 'upplupen bonus 2990');
  await owner.click('button:has-text("Bokför upplupen bonus")'); await owner.locator('text=Den upplupna bonusen stämmer redan').waitFor();
  await row.locator('button:has-text("Reglera")').click();
  await owner.waitForURL(/fakturor\/\d+\?ok/);
  t = nb(await text(owner));
  assert(t.includes('Bonus') && t.includes('-15000,00'), 'kreditfakturautkast med moms: ' + t.slice(0, 900));
  await owner.click('button:has-text("Bokför faktura")'); await owner.locator('text=Fakturan är bokförd').waitFor();
  await owner.goto(KB + '/kundbonus');
  row = owner.locator('.rb-row[data-customer="Kedjan AB"]');
  assert((await row.innerText()).includes('Reglerad') && nb(await row.locator('.rb-accrued').innerText()) === '0,00', 'reglerad och upplupet upplöst: ' + await row.innerText());
  assert(nb(await row.locator('.rb-volume').innerText()) === '600000,00', 'bonusfakturan räknas inte in i omsättningen');
  log('kundbonus: trappsteg på omsättningen, upplupen bonus 3730/2990 vid bokslut, reglering med kreditfaktura och momsreduktion, upplupet löses upp');

  // ================= Del 2: förskott till leverantörer =================
  const supplierInvoice = async (B, sup, no, total, vat, account = '4010') => {
    await owner.goto(B + '/leverantorsfakturor/ny');
    await owner.selectOption('select[name=supplier_id]', { label: sup });
    await owner.fill('input[name=invoice_number]', no); await owner.fill('input[name=invoice_date]', day(10)); await owner.fill('input[name=due_date]', day(-10));
    await owner.fill('input[name=total]', total); await owner.locator('input[name=total]').blur(); await owner.fill('input[name=vat]', vat);
    await owner.fill('input[name=account_0]', account); await owner.fill('input[name=amount_0]', String(Number(total) - Number(vat)));
    await owner.click('button:has-text("Registrera och bokför")'); await owner.waitForURL(/ok=/);
    return owner.url().split('?')[0];
  };
  const FP = await newCompany('Förskottsbetalaren AB', 559510000);
  await owner.goto(FP + '/leverantorer');
  await owner.fill('input[name=name]', 'Maskinleverantören AB');
  await owner.click('button:has-text("Spara leverantör")'); await owner.waitForURL(/ok=/);
  await owner.goto(FP + '/leverantorsfakturor/forskott');
  await owner.fill('input[name=amount]', '30000'); await owner.fill('input[name=date]', day(20));
  await owner.click('button:has-text("Bokför förskott")'); await owner.locator('text=Förskottet är bokfört på 1480').waitFor();
  assert(nb(await owner.locator('.pp-outstanding').innerText()) === '30000,00' && nb(await owner.locator('.pp-ledger').innerText()) === '30000,00', 'förskott på 1480 och avstämt');
  const fUrl = await supplierInvoice(FP, 'Maskinleverantören AB', 'M-100', '100000', '20000', '5410');
  await owner.goto(FP + '/leverantorsfakturor/forskott');
  await owner.locator('.pp-row button:has-text("Avräkna")').click(); await owner.locator('text=av förskottet är avräknat').waitFor();
  t = nb(await text(owner));
  assert(t.includes('kvarattbetalapåfakturan:70000,00'), 'avräknat, mellanskillnaden kvar: ' + t.slice(0, 500));
  assert(nb(await owner.locator('.pp-outstanding').innerText()) === '0,00' && nb(await owner.locator('.pp-ledger').innerText()) === '0,00', '1480 nollställt');
  await owner.goto(fUrl);
  t = nb(await text(owner));
  assert(t.includes('70000,00'), 'fakturan har 70 000 kr kvar att betala: ' + t.slice(0, 900));
  // Ett andra förskott som inte används betalas tillbaka
  await owner.goto(FP + '/leverantorsfakturor/forskott');
  await owner.fill('input[name=amount]', '5000'); await owner.click('button:has-text("Bokför förskott")'); await owner.locator('text=Förskottet är bokfört på 1480').waitFor();
  await owner.locator('.pp-row').first().locator('button:has-text("Återbetalt")').click(); await owner.locator('text=Återbetalt förskott 5000').first().waitFor().catch(() => {});
  assert(nb(await owner.locator('.pp-outstanding').innerText()) === '0,00', 'återbetalt förskott');
  log('leverantörsförskott: förskott på 1480, avräkning mot slutfakturan lämnar mellanskillnaden att betala, återbetalning, avstämning mot 1480');

  // ================= Del 3: tantiem =================
  const TA = await newCompany('Vinstdelaren AB', 559520000);
  await voucher(TA, 'Försäljning', [[1930, 1000000], [3001, -1000000]], `${YEAR}-01-15`);
  await owner.goto(TA + '/lon/anstallda');
  await owner.fill('input[name=first_name]', 'Tove'); await owner.fill('input[name=last_name]', 'Tantiem');
  await owner.fill('input[name=personal_number]', '19811218-9876'); await owner.fill('input[name=monthly_salary]', '40000'); await owner.fill('input[name=tax_table]', '32');
  await owner.click('form:has(input[name=first_name]) button:has-text("Spara")'); await owner.waitForURL(/ok=/);
  await owner.goto(TA + '/lon/tantiem');
  await owner.fill('input[name=pct]', '5'); await owner.click('button:has-text("Lägg upp tantiemavtal")'); await owner.locator('text=Tantiemavtalet är upplagt').waitFor();
  const prow = owner.locator('.ps-row[data-employee="Tove Tantiem"]');
  assert(nb(await prow.locator('.ps-proposal').innerText()) === '50000,00', 'tantiem 5 % av 1 000 000 kr');
  await owner.click('button:has-text("Bokför upplupen tantiem")'); await owner.locator('text=Upplupen tantiem med sociala avgifter är bokförd').waitFor();
  assert(nb(await prow.locator('.ps-accrued').innerText()) === '50000,00' && nb(await prow.locator('.ps-fee').innerText()) === '15710,00', 'upplupen lön 2910 och avgifter 2940: ' + await prow.innerText());
  assert(nb(await owner.locator('.ps-result').innerText()) === '1000000,00', 'resultatet räknas före tantiem');
  await owner.click('button:has-text("Bokför upplupen tantiem")'); await owner.locator('text=Den upplupna tantiemen stämmer redan').waitFor();
  await owner.goto(TA + '/lon');
  await owner.fill('input[name=period]', `${YEAR}-${String(MONTH).padStart(2, '0')}`);
  await owner.fill('input[name=payment_date]', day(0));
  await owner.click('button:has-text("Ny lönekörning")'); await owner.waitForURL(/lon\/\d+\?ok/);
  const tRun = owner.url().split('?')[0];
  await owner.goto(TA + '/lon/tantiem');
  await prow.locator('button:has-text("Lägg på lön")').click(); await owner.locator('text=är lagd på lönekörningen').waitFor();
  await owner.goto(tRun);
  assert((await owner.content()).includes(`Tantiem ${YEAR}`), 'tantiemen på lönespecen');
  await owner.click('button:has-text("Bokför lönekörning")'); await owner.locator('text=Lönekörningen är bokförd').waitFor();
  await owner.goto(TA + '/lon/tantiem');
  assert((await prow.innerText()).includes('Utbetald'), 'utbetald och upplupet upplöst: ' + await prow.innerText());
  await owner.goto(TA + '/verifikationer');
  assert((await text(owner)).includes('Upplöst upplupen tantiem, Tove Tantiem'), 'upplösningsverifikation');
  log('tantiem: 5 % av resultatet före tantiem, upplupen lön 7210/2910 och avgifter 7519/2940 vid bokslut, utbetalning via lönekörningen löser upp skulden');

  // ================= Del 4: tvistiga fakturor och förlikning =================
  const TV = await newCompany('Tvistbolaget AB', 559530000);
  if (Number(day(60).slice(0, 4)) !== YEAR) await addFy(TV, YEAR - 1);
  await owner.goto(TV + '/moduler');
  await owner.locator('.card:has(h2:text-is("Kundreskontra och påminnelser")) button:has-text("Aktivera")').click(); await owner.waitForURL(/ok=/);
  await owner.goto(TV + '/kunder');
  await owner.fill('input[name=name]', 'Missnöjd Kund AB');
  await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await invoice(TV, 'Missnöjd Kund AB', 10000, day(60));
  await owner.goto(TV + '/m/reskontra');
  assert(await owner.locator('button:has-text("Påminnelse 1")').count() === 1, 'påminnelse möjlig före tvisten');
  await owner.goto(TV + '/fakturor/tvister');
  await owner.fill('textarea[name=reason]', 'Kunden anser att leveransen var ofullständig');
  await owner.click('button:has-text("Markera som tvistig")'); await owner.locator('text=påminnelser och inkasso är pausade').waitFor();
  await owner.goto(TV + '/m/reskontra');
  assert((await text(owner)).includes('Tvist – pausad') && await owner.locator('button:has-text("Påminnelse 1")').count() === 0, 'påminnelser pausade');
  await owner.goto(TV + '/fakturor/tvister');
  const drow = owner.locator('.dp-row[data-status="open"]');
  await drow.locator('input[name=agreed]').fill('15000');
  await drow.locator('button:has-text("Förlikning")').click(); await owner.locator('text=ska vara lägre än det som återstår').waitFor();
  await drow.locator('input[name=agreed]').fill('8000');
  await drow.locator('button:has-text("Förlikning")').click(); await owner.locator('text=Förlikningen är bokförd').waitFor();
  t = nb(await owner.locator('.flash').first().innerText());
  assert(t.includes('inbetalt8000,00kr') && t.includes('nedsatt4500,00kr'), 'förlikning: ' + t);
  assert(await owner.locator('.dp-row[data-status="settled"]').count() === 1, 'tvisten avslutad med förlikning');
  await owner.goto(TV + '/verifikationer');
  await owner.locator('tr:has-text("Förlikning faktura") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner));
  assert(t.includes('3730') && t.includes('3600,00') && t.includes('2611') && t.includes('900,00') && t.includes('4500,00'), 'nedsättning med momsreduktion: ' + t.slice(0, 700));
  await owner.goto(TV + '/m/reskontra');
  assert(!(await text(owner)).includes('Missnöjd Kund AB'), 'fakturan är reglerad');
  log('tvistiga fakturor: påminnelser och inkasso pausas, förlikning med inbetalning av avtalat belopp och nedsättning av resten med momsreduktion');

  // ================= Del 5: leverantörsbonus =================
  const LB = await newCompany('Storköparen AB', 559540000);
  if (Number(day(60).slice(0, 4)) !== YEAR) await addFy(LB, YEAR - 1);
  await owner.goto(LB + '/leverantorer');
  await owner.fill('input[name=name]', 'Partihandeln AB');
  await owner.click('button:has-text("Spara leverantör")'); await owner.waitForURL(/ok=/);
  await supplierInvoice(LB, 'Partihandeln AB', 'P-1', '150000', '30000');
  await supplierInvoice(LB, 'Partihandeln AB', 'P-2', '125000', '25000');
  await owner.goto(LB + '/leverantorsfakturor/bonus');
  await owner.fill('input[name=start_date]', day(60)); await owner.fill('input[name=end_date]', day(5));
  await owner.fill('input[name=tiers]', '200000:1; 500000:2');
  await owner.click('button:has-text("Lägg upp avtal")'); await owner.locator('text=Bonusavtalet är upplagt').waitFor();
  const brow = owner.locator('.sb-row[data-supplier="Partihandeln AB"]');
  assert(nb(await brow.locator('.sb-volume').innerText()) === '220000,00', 'inköp exkl. moms');
  assert(nb(await brow.locator('.sb-amount').innerText()).startsWith('2200,00'), 'bonus 1 %: ' + await brow.locator('.sb-amount').innerText());
  await owner.click('button:has-text("Bokför upplupen bonus")'); await owner.locator('text=Upplupen leverantörsbonus har ökats med').waitFor();
  assert(nb(await brow.locator('.sb-accrued').innerText()) === '2200,00', 'upplupen fordran 1790');
  await brow.locator('select[name=method]').selectOption('credit'); await brow.locator('input[name=credit_number]').fill('BON-1');
  await brow.locator('button:has-text("Ta emot bonus")').click(); await owner.locator('text=kvitta den mot en faktura').waitFor();
  t = nb(await owner.locator('.flash').first().innerText()); assert(t.includes('2200,00kr(moms550,00kr)'), 'bonus med moms: ' + t);
  assert((await brow.innerText()).includes('Mottagen') && nb(await brow.locator('.sb-accrued').innerText()) === '0,00' && nb(await brow.locator('.sb-volume').innerText()) === '220000,00', 'mottagen, upplupet upplöst, volymen oförändrad');
  await owner.goto(LB + '/leverantorsfakturor/kredit');
  assert((await text(owner)).includes('BON-1'), 'kreditnotan kan kvittas mot en faktura');
  await owner.goto(LB + '/verifikationer');
  await owner.locator('tr:has-text("Leverantörsbonus") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner));
  assert(t.includes('2440') && t.includes('2750,00') && t.includes('2641') && t.includes('550,00') && t.includes('1790'), 'kontering 2440/2641/1790: ' + t.slice(0, 700));
  log('leverantörsbonus: trappsteg på inköpen, upplupen fordran 1790/4730 vid bokslut, bonus som kreditnota minskar ingående moms och löser upp det upplupna');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 30: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
