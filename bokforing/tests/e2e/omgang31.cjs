// End-to-end, omgång 31: returer och reklamationer, punktskatter, försäkringsskador, körjournal, koncernkonto.
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

  // ================= Del 1: returer och reklamationer =================
  const RT = await newCompany('Returbutiken AB', 559600000);
  await owner.goto(RT + '/moduler');
  await owner.locator('.card:has(h2:text-is("Inköp, lager och logistik")) button:has-text("Aktivera")').click(); await owner.waitForURL(/ok=/);
  await owner.goto(RT + '/m/lager/artiklar');
  await owner.fill('input[name=sku]', 'A-1'); await owner.fill('input[name=name]', 'Kaffebryggare');
  await owner.fill('input[name=purchase_price]', '200'); await owner.fill('input[name=sales_price]', '500'); await owner.fill('input[name=opening_qty]', '10');
  await owner.click('button:has-text("Lägg upp artikel")'); await owner.locator('text=Artikeln är upplagd').waitFor();
  await owner.goto(RT + '/kunder');
  await owner.fill('input[name=name]', 'Reklamerande Kund AB');
  await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await owner.goto(RT + '/fakturor/ny');
  await owner.selectOption('select[name=customer_id]', { label: 'Reklamerande Kund AB' });
  await owner.fill('input[name=invoice_date]', day(5));
  let r0 = owner.locator('tbody tr').first();
  await r0.locator('td:nth-child(1) input').fill('A-1 Kaffebryggare'); await r0.locator('td:nth-child(2) input').fill('4');
  await r0.locator('td:nth-child(3) input').fill('st'); await r0.locator('td:nth-child(4) input').fill('500');
  await owner.click('button:has-text("Spara utkast")'); await owner.waitForURL(/fakturor\/\d+\?ok/);
  await owner.click('button:has-text("Bokför faktura")'); await owner.locator('text=Fakturan är bokförd').waitFor();
  const stock = async () => { await owner.goto(RT + '/m/lager/artiklar'); return nb(await owner.locator('tr:has-text("Kaffebryggare") td:nth-child(3)').innerText()); };
  const newReturn = async (qty, reason) => {
    await owner.goto(RT + '/fakturor/returer');
    await owner.selectOption('select[name=invoice]', { index: 1 }); await owner.click('button:has-text("Visa rader")');
    await owner.locator('.rt-line input').fill(qty); await owner.selectOption('select[name=reason]', reason);
    await owner.click('button:has-text("Registrera retur")'); await owner.locator('text=Returärendet är registrerat').waitFor();
  };
  await newReturn('5', 'defect').catch(() => {});
  await owner.locator('text=Högst 4 st').waitFor();
  await newReturn('2', 'defect');
  let rrow = owner.locator('.rt-row[data-status="received"]');
  assert(nb(await rrow.locator('.rt-value').innerText()) === '1000,00', 'returvärde exkl. moms');
  await rrow.locator('form:has(button:has-text("Kreditera")) button').click();
  await owner.waitForURL(/fakturor\/\d+\?ok/); await owner.locator('text=2 tillbaka i lager').waitFor();
  t = nb(await text(owner));
  assert(t.includes('Retur:A-1Kaffebryggare') && t.includes('-1250,00'), 'kreditfakturautkast med moms: ' + t.slice(0, 900));
  await owner.click('button:has-text("Bokför faktura")'); await owner.locator('text=Fakturan är bokförd').waitFor();
  assert(await stock() === '12st', 'två tillbaka i lager');
  await newReturn('1', 'damaged');
  rrow = owner.locator('.rt-row[data-status="received"]');
  await rrow.locator('form:has(button:has-text("Skicka ersättningsvara")) select').selectOption('scrap');
  await rrow.locator('button:has-text("Skicka ersättningsvara")').click(); await owner.locator('text=Ersättningsvara skickad utan ny faktura').waitFor();
  t = nb(await owner.locator('.flash').first().innerText()); assert(t.includes('1levereradeurlagret') && t.includes('1kasserade'), 'ersättning: ' + t);
  assert(await stock() === '11st', 'ersättningsvaran har lämnat lagret, den trasiga är kasserad');
  await newReturn('1', 'regret');
  rrow = owner.locator('.rt-row[data-status="received"]');
  await rrow.locator('input[name=note]').fill('Ångerfristen har gått ut'); await rrow.locator('button:has-text("Avslå")').click(); await owner.locator('text=Reklamationen är avslagen').waitFor();
  assert(await owner.locator('.rt-row[data-status="rejected"]').count() === 1 && await owner.locator('.rt-row[data-status="credited"]').count() === 1 && await owner.locator('.rt-row[data-status="replaced"]').count() === 1, 'tre avgjorda ärenden');
  t = nb(await owner.locator('.rt-stats').innerText());
  assert(t.includes('Felpåvaran11000,00') && t.includes('Transportskada1500,00') && t.includes('Ångerrätt10,00500,00'), 'orsaksstatistik: ' + t);
  assert(nb(await owner.locator('.rt-products').innerText()).includes('A-1Kaffebryggare33'), 'per artikel: ' + await owner.locator('.rt-products').innerText());
  // Den avslagna returen frigör antalet igen
  await owner.selectOption('select[name=invoice]', { index: 1 }); await owner.click('button:has-text("Visa rader")');
  assert(nb(await owner.locator('.rt-line td:nth-child(3)').innerText()) === '1', 'kvar att returnera efter avslag');
  log('returer: kreditering av returnerade rader med moms och återtag i lager, ersättningsvara ur lagret med kassation, avslag, orsaksstatistik per artikel');

  // ================= Del 2: punktskatter =================
  const PS = await newCompany('Kemiprodukter AB', 559610000);
  await owner.goto(PS + '/moduler');
  await owner.locator('.card:has(h2:text-is("Inköp, lager och logistik")) button:has-text("Aktivera")').click(); await owner.waitForURL(/ok=/);
  await owner.goto(PS + '/m/lager/artiklar');
  await owner.fill('input[name=sku]', 'K-1'); await owner.fill('input[name=name]', 'Rengöringsmedel');
  await owner.fill('input[name=purchase_price]', '40'); await owner.fill('input[name=sales_price]', '100'); await owner.fill('input[name=opening_qty]', '100');
  await owner.click('button:has-text("Lägg upp artikel")'); await owner.locator('text=Artikeln är upplagd').waitFor();
  await owner.goto(PS + '/kunder');
  await owner.fill('input[name=name]', 'Städbolaget AB');
  await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  const PER = `${YEAR}-${String(MONTH).padStart(2, '0')}`;
  await owner.goto(PS + `/punktskatter?period=${PER}`);
  await owner.fill('input[name=name]', 'Kemikalieskatt'); await owner.fill('input[name=rate]', '1,5'); await owner.check('input[name=invoice_line]');
  await owner.click('button:has-text("Lägg upp skatteslag")'); await owner.locator('text=Skatteslaget är upplagt').waitFor();
  await owner.fill('input[name=factor]', '0,5'); await owner.click('button:has-text("Koppla artikel")'); await owner.locator('text=Artikeln är kopplad').waitFor();
  await owner.goto(PS + '/m/lager/order');
  await owner.selectOption('select[name=customer_id]', { label: 'Städbolaget AB' });
  await owner.selectOption('select[name=product_0]', await owner.locator('select[name=product_0] option:has-text("K-1 ")').first().getAttribute('value'));
  await owner.fill('input[name=qty_0]', '10');
  await owner.click('button:has-text("Skapa kundorder")'); await owner.locator('text=Kundordern är skapad').waitFor();
  await owner.click('button:has-text("Leverera och dra från lagret")'); await owner.locator('text=Ordern är levererad').waitFor();
  await owner.click('button:has-text("Skapa faktura från leveransen")'); await owner.locator('text=Fakturautkastet är skapat').waitFor();
  t = nb(await text(owner));
  assert(t.includes('Kemikalieskatt5kg') && t.includes('7,50') && t.includes('1007,50'), 'punktskatt som fakturarad: ' + t.slice(0, 1200));
  await owner.goto(PS + `/punktskatter?period=${PER}`);
  await owner.fill('input[name=quantity]', '20'); await owner.fill('input[name=note]', 'Eget uttag till lokalvård');
  await owner.click('button:has-text("Registrera uttag")'); await owner.locator('text=Uttaget är registrerat').waitFor();
  assert(nb(await owner.locator('.ex-return tr[data-type="Kemikalieskatt"] .ex-qty').innerText()) === '25kg', 'underlag 5 kg levererat + 20 kg uttag');
  assert(nb(await owner.locator('.ex-total').innerText()) === '38,00', 'skatt 37,50 avrundad till hela kronor: ' + await owner.locator('.ex-total').innerText());
  await owner.click(`button:has-text("Bokför punktskatt för ${PER}")`); await owner.locator('text=Punktskatten för').waitFor().catch(async () => { throw new Error('deklaration: ' + (await text(owner)).slice(0, 500)); });
  assert(nb(await owner.locator('.ex-ledger').innerText()) === '38,00', 'skuld på 2660');
  await owner.fill('input[name=quantity]', '1'); await owner.click('button:has-text("Registrera uttag")'); await owner.locator('text=Perioden är redan deklarerad').waitFor();
  await owner.locator(`.ex-row[data-period="${PER}"] button:has-text("Betald")`).click(); await owner.locator('text=till skattekontot').waitFor();
  assert(nb(await owner.locator('.ex-ledger').innerText()) === '0,00', '2660 nollställd efter betalning');
  await owner.goto(PS + '/verifikationer');
  await owner.locator(`tr:has-text("Punktskatt ${PER}: Kemikalieskatt") a`).first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner));
  assert(t.includes('6900') && t.includes('2660') && t.includes('38,00'), 'kontering 6900/2660: ' + t.slice(0, 600));
  log('punktskatter: underlag från lagerleveranser × faktor och egna uttag, punktskatt som fakturarad, deklaration mot 2660 och betalning via skattekontot');

  // ================= Del 3: försäkringsskador =================
  const FS = await newCompany('Skadebolaget AB', 559620000);
  await owner.goto(FS + '/anlaggningar');
  await owner.fill('form:has(button:has-text("Lägg upp tillgång")) input[name=name]', 'Lastmaskin');
  await owner.fill('input[name=cost]', '50000'); await owner.fill('input[name=acquired_on]', day(30));
  await owner.click('button:has-text("Lägg upp tillgång")'); await owner.waitForURL(/ok=/);
  await owner.goto(FS + '/moduler');
  await owner.locator('.card:has(h2:text-is("Inköp, lager och logistik")) button:has-text("Aktivera")').click(); await owner.waitForURL(/ok=/);
  await owner.goto(FS + '/m/lager/artiklar');
  await owner.fill('input[name=sku]', 'V-1'); await owner.fill('input[name=name]', 'Pappersrulle');
  await owner.fill('input[name=purchase_price]', '100'); await owner.fill('input[name=sales_price]', '250'); await owner.fill('input[name=opening_qty]', '20');
  await owner.click('button:has-text("Lägg upp artikel")'); await owner.locator('text=Artikeln är upplagd').waitFor();
  await owner.goto(FS + '/forsakringsskador');
  await owner.fill('input[name=description]', 'Brand i lagerlokalen'); await owner.fill('input[name=insurer]', 'Försäkringsbolaget'); await owner.fill('input[name=claim_ref]', 'S-123');
  await owner.selectOption('select[name=kind]', 'asset'); await owner.selectOption('select[name=asset_id]', { label: 'Lastmaskin' });
  await owner.click('button:has-text("Anmäl skada")'); await owner.locator('text=Skadan är registrerad').waitFor();
  t = nb(await owner.locator('.flash').first().innerText()); assert(t.includes('50000,00kr'), 'utrangerat bokfört värde: ' + t);
  await owner.fill('input[name=description]', 'Vattenskada på varor'); await owner.selectOption('select[name=kind]', 'inventory');
  await owner.selectOption('select[name=product_id]', { index: 1 }); await owner.fill('input[name=quantity]', '5');
  await owner.click('button:has-text("Anmäl skada")'); await owner.locator('text=500,00 kr har skrivits bort').waitFor();
  let crow = owner.locator('.dc-row[data-description="Brand i lagerlokalen"]');
  await crow.locator('input[name=assessed]').fill('40000'); await crow.locator('input[name=deductible]').fill('5000');
  await crow.locator('button:has-text("Registrera besked")').click(); await owner.locator('text=är bokförd som fordran').waitFor();
  t = nb(await owner.locator('.flash').first().innerText());
  assert(t.includes('Ersättningen35000,00kr') && t.includes('självrisk5000,00kr') && t.includes('ersättningsfond'), 'besked: ' + t);
  assert(nb(await owner.locator('.dc-receivable').innerText()) === '35000,00', 'fordran 1689');
  crow = owner.locator('.dc-row[data-description="Vattenskada på varor"]');
  await crow.locator('input[name=denied]').check(); await crow.locator('button:has-text("Registrera besked")').click(); await owner.locator('text=avslutat utan ersättning').waitFor();
  await owner.locator('.dc-row[data-description="Brand i lagerlokalen"] button:has-text("Utbetald")').click(); await owner.locator('text=Utbetalningen 35000,00 kr är bokförd').first().waitFor().catch(() => {});
  assert(nb(await owner.locator('.dc-receivable').innerText()) === '0,00' && await owner.locator('.dc-row[data-status="paid"]').count() === 1, 'utbetald');
  await owner.goto(FS + '/anlaggningar');
  assert(await owner.locator('button:has-text("Bokför avyttring")').count() === 0, 'tillgången är utrangerad');
  await owner.goto(FS + '/verifikationer');
  await owner.locator('tr:has-text("utrangering av Lastmaskin") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('7973') && t.includes('1220') && t.includes('50000,00'), 'utrangering 7973/1220: ' + t.slice(0, 600));
  await owner.goto(FS + '/verifikationer');
  await owner.locator('tr:has-text("bortskrivna ur lagret") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('4960') && t.includes('1460') && t.includes('500,00'), 'lagerförlust 4960/1460: ' + t.slice(0, 600));
  await owner.goto(FS + '/verifikationer');
  await owner.locator('tr:has-text("självrisk 5") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('1689') && t.includes('3994') && t.includes('35000,00'), 'ersättning 1689/3994: ' + t.slice(0, 600));
  log('försäkringsskador: förstörd tillgång utrangeras, förstörda varor skrivs bort ur lagret, besked med självrisk som fordran 1689/3994, underlag för ersättningsfond, utbetalning');

  // ================= Del 4: körjournal =================
  await owner.goto(BASE + '/');
  await owner.fill('input[name=name]', 'Åkarfirman');
  await owner.selectOption('select[name=company_type]', 'EF');
  await owner.fill('input[name=orgnr]', `19${orgnrFor('790101' + String(100 + (Date.now() % 800)).padStart(3, '0'))}`);
  await owner.fill('input[name=fy_start]', `${YEAR}-01-01`); await owner.fill('input[name=fy_end]', `${YEAR}-12-31`);
  await owner.click('button:has-text("Skapa bolag")'); await owner.waitForURL(/kom-igang/);
  const KJ = owner.url().replace(/\/kom-igang.*/, '');
  await owner.goto(KJ + '/kunder');
  await owner.fill('input[name=name]', 'Byggkunden AB'); await owner.click('form button:has-text("Spara")'); await owner.waitForURL(/ok=/);
  await voucher(KJ, 'Drivmedel', [[5611, 3000], [1930, -3000]], `${YEAR}-01-05`);
  await owner.goto(KJ + '/korjournal');
  for (const [reg, own] of [['ABC123', 'company'], ['XYZ789', 'private']]) {
    await owner.fill('input[name=reg_no]', reg); await owner.selectOption('select[name=owner]', own);
    await owner.click('button:has-text("Lägg till fordon")'); await owner.locator('text=Fordonet är upplagt').waitFor();
  }
  const trip = async (reg, f) => {
    await owner.goto(KJ + '/korjournal');
    await owner.selectOption('select[name=vehicle_id]', { label: reg });
    await owner.fill('input[name=date]', f.date ?? `${YEAR}-01-10`);
    for (const k of ['odo_start', 'odo_end', 'km', 'purpose', 'from_place', 'to_place']) await owner.fill(`input[name=${k}]`, f[k] ?? '');
    if (f.private) await owner.check('input[name=private]'); else await owner.uncheck('input[name=private]');
    await owner.selectOption('select[name=customer_id]', f.customer ? { label: f.customer } : { index: 0 });
    await owner.click('button:has-text("Spara resa")');
  };
  await trip('ABC123', { odo_start: '1300', odo_end: '1200', purpose: 'Leverans' }); await owner.locator('text=ska vara högre än vid avfärd').waitFor().catch(async () => { throw new Error('mätare: ' + owner.url() + ' ' + (await text(owner)).slice(0, 800)); });
  await trip('ABC123', { odo_start: '1000', odo_end: '1250', purpose: 'Materialleverans', from_place: 'Kontoret', to_place: 'Bygget', customer: 'Byggkunden AB' }); await owner.locator('text=250 km').first().waitFor();
  await trip('ABC123', { km: '250', private: true, date: `${YEAR}-01-12` }); await owner.locator('text=Resan är sparad').waitFor();
  await trip('XYZ789', { km: '120', purpose: 'Kundmöte', customer: 'Byggkunden AB' }); await owner.locator('text=Resan är sparad').waitFor();
  const veh = (reg) => owner.locator(`.vl-vehicle[data-reg="${reg}"]`);
  assert(nb(await veh('ABC123').locator('.vl-business').innerText()) === '250km' && nb(await veh('ABC123').locator('.vl-private').innerText()) === '250km' && nb(await veh('ABC123').locator('.vl-share').innerText()) === '50%', 'tjänst och privat');
  assert(nb(await veh('ABC123').locator('.vl-customers').innerText()).includes('ByggkundenAB250km'), 'per kund');
  assert(nb(await owner.locator('.vl-cpm').innerText()) === '60,00', 'självkostnad 3 000 kr / 50 mil');
  t = nb(await veh('ABC123').locator('.vl-proposal').innerText()); assert(t.includes('250km') && t.includes('1500,00kr'), 'uttag 25 mil × 60 kr: ' + t);
  t = nb(await veh('XYZ789').locator('.vl-proposal').innerText()); assert(t.includes('120km') && t.includes('25,00kr/mil') && t.includes('300,00kr'), 'avdrag 12 mil × 25 kr: ' + t);
  await veh('ABC123').locator('button:has-text("Bokför årsavräkning")').click(); await veh('ABC123').locator('.vl-settled').waitFor();
  await owner.goto(KJ + '/korjournal');
  await veh('XYZ789').locator('button:has-text("Bokför årsavräkning")').click(); await veh('XYZ789').locator('.vl-settled').waitFor();
  assert(await owner.locator('.vl-settled').count() === 2, 'båda avräknade');
  await trip('XYZ789', { km: '10', purpose: 'Sen resa' }); await owner.locator('text=Året är redan avräknat').waitFor();
  await owner.goto(KJ + '/verifikationer');
  await owner.locator('tr:has-text("Privat körning") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('2013') && t.includes('3990') && t.includes('1500,00'), 'uttag 2013/3990: ' + t.slice(0, 600));
  await owner.goto(KJ + '/verifikationer');
  await owner.locator('tr:has-text("Egen bil i tjänsten") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('7331') && t.includes('2018') && t.includes('300,00'), 'avdrag 7331/2018: ' + t.slice(0, 600));
  log('körjournal: resor per fordon med mätarställning och kund, privat andel, uttag för privat körning till självkostnad och avdrag för egen bil i tjänsten i enskild firma');

  // ================= Del 5: koncernkonto =================
  const MB = await newCompany('Moderbolaget Pool AB', 559630000);
  const D1 = await newCompany('Dotter Ett AB', 559640000);
  const D2 = await newCompany('Dotter Två AB', 559650000);
  const PREV = MONTH === 1 ? `${YEAR - 1}-12` : `${YEAR}-${String(MONTH - 1).padStart(2, '0')}`;
  if (MONTH === 1) for (const B of [MB, D1, D2]) await addFy(B, YEAR - 1);
  const cidOf = (u) => u.replace(/.*\/c\//, '');
  await owner.goto(`${BASE}/koncern?c=${cidOf(MB)}&c=${cidOf(D1)}&c=${cidOf(D2)}&moder=${cidOf(MB)}`);
  for (let i = 0; i < 2; i++) {
    await owner.locator('.group-link button:has-text("Koppla som dotterbolag")').first().click(); await owner.waitForLoadState('networkidle');
    await owner.goto(`${BASE}/koncern?c=${cidOf(MB)}&c=${cidOf(D1)}&c=${cidOf(D2)}&moder=${cidOf(MB)}`);
  }
  assert(await owner.locator('.group-link button:has-text("Ta bort koppling")').count() === 2, 'två dotterbolag kopplade');
  await owner.goto(MB + `/koncernkonto?period=${PREV}`);
  await owner.fill('input[name=deposit_rate]', '2'); await owner.fill('input[name=borrow_rate]', '4');
  await owner.click('button:has-text("Lägg upp koncernkonto")'); await owner.locator('text=Koncernkontot är upplagt').waitFor();
  for (const name of ['Dotter Ett AB', 'Dotter Två AB']) {
    await owner.goto(MB + `/koncernkonto?period=${PREV}`);
    await owner.selectOption('form:has(button:has-text("Anslut")) select[name=company_id]', { label: name });
    await owner.click('button:has-text("Anslut")'); await owner.locator('text=Dotterbolaget är anslutet').waitFor();
  }
  const sweepTo = async (name, dir, amount, d) => {
    await owner.goto(MB + `/koncernkonto?period=${PREV}`);
    await owner.selectOption('form:has(button:has-text("Bokför överföring")) select[name=company_id]', { label: name });
    await owner.selectOption('select[name=direction]', dir); await owner.fill('input[name=amount]', amount); await owner.fill('form:has(button:has-text("Bokför överföring")) input[name=date]', d);
    await owner.click('button:has-text("Bokför överföring")'); await owner.locator('text=är bokförd i båda bolagen').waitFor();
  };
  await sweepTo('Dotter Ett AB', 'in', '100000', `${PREV}-01`);
  await sweepTo('Dotter Två AB', 'out', '50000', `${PREV}-16`);
  const dim = new Date(Date.UTC(Number(PREV.slice(0, 4)), Number(PREV.slice(5)), 0)).getUTCDate();
  const i1 = Math.round(10000000 * 0.02 / 365 * dim), i2 = -Math.round(5000000 * 0.04 / 365 * (dim - 15));
  const krs = (o) => (o / 100).toFixed(2).replace('.', ',').replace('-', '−');
  const prow = (name) => owner.locator(`.cp-row[data-company="${name}"]`);
  assert(nb(await prow('Dotter Ett AB').locator('.cp-interest').innerText()).replace('-', '−') === krs(i1), `ränta på insättning ${krs(i1)}: ` + await prow('Dotter Ett AB').innerText());
  assert(nb(await prow('Dotter Två AB').locator('.cp-interest').innerText()).replace('-', '−') === krs(i2), `ränta på utlåning ${krs(i2)}: ` + await prow('Dotter Två AB').innerText());
  assert(nb(await owner.locator('.cp-total').innerText()) === '50000,00', 'koncernen netto 50 000 kr');
  await owner.click(`button:has-text("Bokför internränta för ${PREV}")`); await owner.locator('text=är bokförd för 2 bolag').waitFor();
  assert((await prow('Dotter Ett AB').locator('.cp-interest').innerText()).includes('bokförd') && await owner.locator('.cp-check:text-is("Stämmer")').count() === 2, 'ränta bokförd och avstämd: ' + await owner.locator('.cp-members').innerText());
  await owner.click(`button:has-text("Bokför internränta för ${PREV}")`); await owner.locator('text=ingen ränta att bokföra').waitFor();
  await owner.goto(D1 + '/koncernkonto');
  t = nb(await owner.locator('.cp-member').innerText()); assert(t.includes(krs(100000 * 100 + i1).replace(/(\d)(?=(\d{3})+,)/g, '$1')) && t.includes('fordranpåmoderbolaget'), 'dotterbolagets vy: ' + t);
  await owner.goto(D1 + '/verifikationer');
  await owner.locator('tr:has-text("internränta") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('1660') && t.includes('8310'), 'dotterbolaget: ränteintäkt 1660/8310: ' + t.slice(0, 600));
  await owner.goto(D2 + '/verifikationer');
  await owner.locator('tr:has-text("överföring från huvudkontot") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('1930') && t.includes('1660') && t.includes('50000,00'), 'dotterbolaget lånar från huvudkontot: ' + t.slice(0, 600));
  log('koncernkonto: överföringar bokförs i dotterbolaget (1660) och moderbolaget (2860), internränta på dagligt saldo med olika in- och utlåningsränta, avstämning mellan bolagen');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 31: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
