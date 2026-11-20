// End-to-end, omgång 20: rättelse av moms, tillverkning, fastigheter, underskottsavdrag, forskningsavdrag.
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

  // ================= Del 1: rättelse av momsdeklaration =================
  const MK = await newCompany('Momsrättelse AB', 559050000);
  await voucher(MK, 'Försäljning januari', [[1930, 1250], [3001, -1000], [2611, -250]], `${YEAR}-01-15`);
  const JAN = `from=${YEAR}-01-01&to=${YEAR}-01-31`;
  await owner.goto(`${MK}/rapporter/moms?${JAN}`);
  await owner.click('button:has-text("Bokför momsavräkning per")');
  await owner.locator('text=Momsavräkningen är bokförd').waitFor();
  await owner.goto(`${MK}/rapporter/moms?${JAN}`);
  assert(await owner.locator('.vat-declared').count() === 1, 'deklarerad och stämmer');
  await owner.goto(MK + '/verifikationer/ny');
  await owner.fill('input[name=date]', `${YEAR}-01-20`);
  await owner.fill('input[name=description]', 'Sen faktura');
  await owner.locator('text=är redan deklarerad').first().waitFor({ timeout: 5000 }).catch(() => {});
  const warned = (await text(owner)).includes('är redan deklarerad');
  await voucher(MK, 'Sen faktura januari', [[1930, 500], [3001, -400], [2611, -100]], `${YEAR}-01-20`);
  await owner.goto(`${MK}/rapporter/moms?${JAN}`);
  assert(await owner.locator('.vat-correction').count() === 1, 'rättelse behövs');
  assert(nb(await owner.locator('.corr-row[data-box="10"]').innerText()).includes('250,00350,00100,00') && nb(await owner.locator('.corr-diff').innerText()) === '100,00', 'rutor: ' + await owner.locator('.vat-correction').innerText());
  await owner.click('button:has-text("Bokför rättelse och förbered ny deklaration")');
  await owner.locator('text=Rättelse 1 är bokförd: 100,00 kr mer att betala').waitFor();
  assert(await owner.locator('.vat-declared').count() === 1 && (await owner.locator('.vat-declared').innerText()).includes('rättad 1 gång'), 'rättad');
  await owner.goto(MK + '/rapporter/huvudbok?account=2650');
  t = nb(await text(owner));
  assert(t.includes('250,00') && t.includes('100,00'), '2650 med avräkning och rättelse');
  await owner.goto(MK + '/inlamning');
  assert((await text(owner)).includes('rattelse1') || (await text(owner)).includes(':r1'), 'ny deklaration förberedd');
  log('rättelse av momsdeklaration: sen verifikation i deklarerad period ger differens per ruta, rättelse till 2650 och ny deklaration' + (warned ? ', varning i formuläret' : ''));

  // ================= Del 2: tillverkning =================
  const TV = await newCompany('Verkstaden AB', 559060000);
  await owner.goto(TV + '/moduler');
  await owner.locator('.card:has(h2:text-is("Inköp, lager och logistik")) button:has-text("Aktivera")').click();
  await owner.waitForURL(/ok=/);
  const TM = TV + '/m/lager';
  for (const [sku, name, buy, opening] of [['R-1', 'Plåt', '100', '10'], ['R-2', 'Skruv', '2', '100'], ['F-1', 'Låda', '0', '0']]) {
    await owner.goto(TM + '/artiklar');
    await owner.fill('input[name=sku]', sku); await owner.fill('input[name=name]', name);
    await owner.fill('input[name=purchase_price]', buy); await owner.fill('input[name=sales_price]', '1000');
    await owner.fill('input[name=opening_qty]', opening);
    await owner.click('button:has-text("Lägg upp artikel")');
    await owner.locator('text=Artikeln är upplagd').waitFor();
  }
  await owner.goto(TM + '/tillverkning');
  const optOf = async (sel, sku) => owner.locator(`${sel} option:has-text("${sku} ")`).first().getAttribute('value');
  await owner.click('summary:has-text("Ny eller ändrad stycklista")');
  await owner.selectOption('.mf-bom-form select[name=product_id]', await optOf('.mf-bom-form select[name=product_id]', 'F-1'));
  await owner.selectOption('select[name=component_0]', await optOf('select[name=component_0]', 'R-1')); await owner.fill('input[name=cqty_0]', '2');
  await owner.selectOption('select[name=component_1]', await optOf('select[name=component_1]', 'R-2')); await owner.fill('input[name=cqty_1]', '8');
  await owner.fill('input[name=labor_minutes]', '30'); await owner.fill('input[name=labor_rate]', '600'); await owner.fill('input[name=overhead_pct]', '10');
  await owner.click('button:has-text("Spara stycklista")');
  await owner.locator('text=Stycklistan är sparad').waitFor();
  assert(nb(await owner.locator('.mf-bom[data-sku="F-1"] .mf-unit').innerText()) === '567,60', 'självkostnad per st: ' + await owner.locator('.mf-boms').innerText());
  await owner.fill('.mf-new input[name=qty]', '3');
  await owner.click('button:has-text("Skapa tillverkningsorder")');
  await owner.locator('text=Tillverkningsordern är skapad').waitFor();
  await owner.click('.mf-order button:has-text("Starta")');
  await owner.locator('text=material 648,00 kr är fört till produkter i arbete').waitFor();
  assert(nb(await owner.locator('.mf-wip').innerText()) === '648,00', 'produkter i arbete');
  await owner.fill('.mf-order input[name=minutes]', '100');
  await owner.click('.mf-order button:has-text("Färdig")');
  await owner.locator('text=självkostnad 1 812,80 kr (604,27 kr per st)').waitFor();
  assert(nb(await owner.locator('.mf-wip').innerText()) === '0,00' && nb(await owner.locator('.mf-variance').innerText()).includes('+110,00'), 'avvikelse mot kalkyl');
  await owner.goto(TM + '/artiklar');
  t = await text(owner);
  assert(/R-1.*Plåt/.test(t), 'artiklar');
  await owner.goto(TV + '/rapporter/huvudbok?account=4940');
  assert(nb(await text(owner)).includes('1164,80'), 'aktiverat arbete och omkostnader på 4940');
  log('tillverkning: stycklista med självkostnadskalkyl, material till 1440 vid start, färdiga produkter till lagret med arbete och omkostnader, avvikelse +110 kr');

  // ================= Del 3: fastighetsskatt och skattemässiga avskrivningar =================
  const FS = await newCompany('Fastighetsbolaget Eken AB', 559070000);
  await owner.goto(FS + '/fastighet/skatt');
  await owner.fill('input[name=designation]', 'Eken 4');
  await owner.selectOption('select[name=type]', 'lokal');
  await owner.fill('input[name=tax_value]', '10000000');
  await owner.fill('input[name=acquired]', `${YEAR}-04-01`);
  await owner.fill('input[name=building_cost]', '6000000'); await owner.fill('input[name=building_rate]', '4');
  await owner.fill('input[name=improvement_cost]', '400000'); await owner.fill('input[name=land_cost]', '1000000');
  await owner.click('button:has-text("Lägg upp fastigheten")');
  await owner.locator('text=Fastigheten är upplagd').waitFor();
  const ek = owner.locator('.tax-property[data-designation="Eken 4"]');
  assert(nb(await ek.locator('.pt-yearly').innerText()) === '100000,00' && nb(await ek.locator('.pt-building').innerText()) === '180000,00' && nb(await ek.locator('.pt-improvement').innerText()) === '15000,00', 'skatt och avskrivning: ' + await ek.innerText());
  await ek.locator('input[name=until]').fill(`${YEAR}-06`);
  await ek.locator('button:has-text("Bokför månaderna")').click();
  await owner.locator('text=Fastighetsskatt 24 999,99 kr för 3 månader är bokförd').waitFor();
  await owner.locator('.tax-property[data-designation="Eken 4"] input[name=until]').fill(`${YEAR}-06`);
  await owner.locator('.tax-property[data-designation="Eken 4"] button:has-text("Bokför månaderna")').click();
  await owner.locator('text=Månaderna är redan bokförda').waitFor();
  await voucher(FS, 'Avskrivning byggnad enligt plan', [[7820, 200000], [1119, -200000]], `${YEAR}-12-31`);
  await owner.goto(FS + '/fastighet/skatt');
  assert(nb(await owner.locator('.pt-booked-dep').innerText()) === '200000,00' && nb(await owner.locator('.pt-adjustment').innerText()) === '5000,00' && (await owner.locator('.pt-summary').innerText()).includes('Läggs till'), 'justering INK2S');
  log('fastighetsskatt 1 % per månad från förvärvet (5191/2513), värdeminskningsavdrag 4 % byggnad och 5 % markanläggningar pro rata, justering mot bokförd avskrivning');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 20: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
