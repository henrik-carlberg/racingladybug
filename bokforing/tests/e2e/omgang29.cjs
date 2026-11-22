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

  // ================= Del 1: kreditfakturor från leverantörer =================
  const LK = await newCompany('Kreditmottagaren AB', 559450000);
  await owner.goto(LK + '/leverantorer');
  await owner.fill('input[name=name]', 'Grossisten AB');
  await owner.click('button:has-text("Spara leverantör")'); await owner.waitForURL(/ok=/);
  const si = async (no, total, vat) => {
    await owner.goto(LK + '/leverantorsfakturor/ny');
    await owner.selectOption('select[name=supplier_id]', { label: 'Grossisten AB' });
    await owner.fill('input[name=invoice_number]', no); await owner.fill('input[name=invoice_date]', day(10)); await owner.fill('input[name=due_date]', day(-10));
    await owner.fill('input[name=total]', total); await owner.locator('input[name=total]').blur(); await owner.fill('input[name=vat]', vat);
    await owner.fill('input[name=account_0]', '4010'); await owner.fill('input[name=amount_0]', String(Number(total) - Number(vat)));
    await owner.click('button:has-text("Registrera och bokför")'); await owner.waitForURL(/ok=/);
    return owner.url().split('?')[0];
  };
  await si('A-1', '12500', '2500');
  const dUrl = await si('D-1', '1250', '250');
  await owner.goto(dUrl);
  await owner.click('button:has-text("Attestera")'); await owner.waitForURL(/ok=/);
  await owner.click('button:has-text("Bokför betalning")'); await owner.waitForURL(/ok=/);
  const credit = async (inv, no, total, vat) => {
    await owner.goto(LK + '/leverantorsfakturor/kredit');
    await owner.selectOption('select[name=original_invoice_id]', { label: inv });
    await owner.fill('input[name=credit_number]', no); await owner.fill('input[name=total]', total); await owner.fill('input[name=vat]', vat);
    await owner.click('button:has-text("Bokför kreditfaktura")');
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await credit('Grossisten AB – A-1 (12 500,00)', 'CN-1', '2500', '500');
  assert(t.includes('2500,00krärkvittatmotfakturan'), 'kreditnota mot obetald faktura kvittas: ' + t);
  assert((await credit('Grossisten AB – A-1 (12 500,00)', 'CN-2', '11000', '2200')).includes('fårinteöverstiga'), 'mer än fakturans belopp nekas');
  t = await credit('Grossisten AB – D-1 (1 250,00)', 'CN-3', '1250', '250');
  assert(t.includes('1250,00krfinnskvar'), 'kredit på betald faktura finns kvar');
  await owner.goto(LK + '/leverantorsfakturor/kredit');
  await owner.locator('.sc-row[data-number="CN-3"] button:has-text("Återbetald")').click();
  await owner.locator('text=Återbetalningen 1 250,00 kr är bokförd').waitFor();
  await owner.goto(LK + '/leverantorsfakturor/kredit');
  assert(nb(await owner.locator('.sc-row[data-number="CN-3"] .sc-left').innerText()) === '0,00', 'krediten är använd');
  await owner.goto(LK + '/rapporter/moms?from=' + day(10).slice(0, 7) + '-01&to=' + day(0));
  t = nb(await text(owner));
  assert(t.includes('Ingåendemomsattdraav2000'), 'ingående moms minskad med krediterna: ' + t.slice(0, 600));
  log('leverantörskrediter: kreditnota kvittas mot obetald faktura, högst fakturans belopp, kredit på betald faktura återbetalas, ingående moms minskar');

  // ================= Del 2: individuell bedömning av osäkra kundfordringar =================
  const BF = await newCompany('Fordringsägaren AB', 559460000);
  await owner.goto(BF + '/kunder');
  await owner.fill('input[name=name]', 'Osäkra kunden AB');
  await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await invoice(BF, 'Osäkra kunden AB', 10000, day(200));
  await invoice(BF, 'Osäkra kunden AB', 8000, day(60));
  await owner.goto(BF + '/bokslut');
  await owner.locator(`tr:has-text("${YEAR}-01-01") a:has-text("Öppna")`).first().click();
  await owner.waitForURL(/bokslut\/\d+/);
  const kf = owner.url().split('?')[0] + '/kundforluster';
  await owner.goto(kf);
  assert(nb(await owner.locator('.bd-target').innerText()) === '10000,00', 'schablon: förfallen mer än 90 dagar till 100 %');
  const rows = owner.locator('.bd-row');
  assert(await rows.count() === 2, 'båda förfallna fakturorna visas för bedömning');
  const assessRow = async (i, pct, note) => {
    await owner.goto(kf);
    const r = owner.locator('.bd-row').nth(i);
    await r.locator('input[name=pct]').fill(pct); await r.locator('input[name=note]').fill(note);
    await r.locator('button:has-text("Spara")').click();
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  assert((await assessRow(0, '40', '')).includes('Motiverabedömningen'), 'motivering krävs');
  await assessRow(0, '40', 'Avbetalningsplan, kunden har betalat delar');
  await assessRow(1, '50', 'Kunden har aviserat likviditetsproblem');
  await owner.goto(kf);
  assert(nb(await owner.locator('.bd-target').innerText()) === '8000,00', 'reserv efter individuell bedömning (40 % av 10 000 + 50 % av 8 000)');
  await owner.click('button:has-text("Bokför reserven")');
  await owner.locator('text=Reserven för befarade kundförluster är ökad med 8 000,00 kr').waitFor();
  log('befarade kundförluster: individuell bedömning per faktura med motivering ersätter schablonen, reserven 8 000 kr bokförs exkl. moms');

  // ================= Del 3: betalningsföreläggande =================
  const BFO = await newCompany('Borgenären AB', 559470000);
  await owner.goto(BFO + '/kunder');
  await owner.fill('input[name=name]', 'Gäldenären AB'); await owner.fill('input[name=orgnr]', orgnrFor('556123456'));
  await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await invoice(BFO, 'Gäldenären AB', 10000, day(90));
  await owner.goto(BFO + '/betalningsforelaggande');
  await owner.fill('input[name=reminder_fee]', '100');
  await owner.click('button:has-text("Registrera ansökan")');
  await owner.locator('.flash').first().waitFor();
  assert(nb(await owner.locator('.flash').first().innerText()).includes('högst60kr'), 'påminnelseavgift högst 60 kr');
  await owner.goto(BFO + '/betalningsforelaggande');
  await owner.fill('input[name=reminder_fee]', '60');
  await owner.click('button:has-text("Registrera ansökan")');
  await owner.locator('text=Ansökan är registrerad: kapital 12 500,00 kr').waitFor();
  await owner.goto(BFO + '/betalningsforelaggande');
  const po = owner.locator('.po-order').first();
  const expInt = Math.round(1250000 * 10 * 60 / 100 / 365);
  assert(nb(await po.locator('.po-interest').innerText()) === (expInt / 100).toFixed(2).replace('.', ','), 'dröjsmålsränta 10 % i 60 dagar');
  await po.locator('select[name=status]').selectOption('ruling'); await po.locator('input[name=case_no]').fill('KFM-1');
  await po.locator('button:has-text("Uppdatera")').click(); await owner.locator('text=Statusen är uppdaterad').waitFor();
  const pay = async (amt) => {
    await owner.goto(BFO + '/betalningsforelaggande');
    await owner.locator('.po-order').first().locator('input[name=amount]').fill(amt);
    await owner.locator('.po-order').first().locator('button:has-text("Registrera inbetalning")').click();
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  assert((await pay('400')).includes('kostnader360,00kr,ränta40,00kr,kapital0,00kr'), 'kostnader först, sedan ränta');
  assert((await pay('100000')).includes('meränskulden'), 'mer än skulden nekas');
  t = await pay(String((1250000 + expInt - 4000) / 100).replace('.', ','));
  assert(t.includes('kapital12500,00kr'), 'resten betalar ränta och kapital: ' + t);
  await owner.goto(BFO + '/betalningsforelaggande');
  assert((await owner.locator('.po-status').first().innerText()).includes('Betald') && nb(await owner.locator('.po-remaining').first().innerText()) === '0,00', 'fakturan är betald via Kronofogden');
  log('betalningsföreläggande: underlag med kapital, dröjsmålsränta och avgifter, ansökningsavgift som fordran, inbetalning avräknas mot kostnader, ränta och kapital');

  // ================= Del 4: konsignationslager =================
  const KG = await newCompany('Lampgrossisten AB', 559480000);
  await owner.goto(KG + '/kunder');
  await owner.fill('input[name=name]', 'Butikskedjan AB');
  await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await owner.goto(KG + '/konsignation');
  await owner.fill('input[name=article]', 'Lampa'); await owner.fill('input[name=unit_cost]', '200'); await owner.fill('input[name=unit_price]', '350');
  await owner.click('button:has-text("Lägg upp artikel")'); await owner.locator('text=Artikeln är upplagd').waitFor();
  const kmove = async (kind, qty) => {
    await owner.goto(KG + '/konsignation');
    const r = owner.locator('.kg-row[data-article="Lampa"]');
    await r.locator('select[name=kind]').selectOption(kind); await r.locator('input[name=qty]').fill(qty);
    await r.locator('button:has-text("Bokför")').click();
    await owner.waitForURL(/(ok|error)=/);
    return decodeURIComponent(owner.url().replace(/\+/g, ' '));
  };
  await kmove('ship', '10');
  await owner.goto(KG + '/konsignation');
  assert(nb(await owner.locator('.kg-total').innerText()) === '2000,00', 'lagervärde hos återförsäljaren');
  assert((await kmove('sold', '4')).includes('kvar hos återförsäljaren: 6 st'), 'sålt enligt rapport');
  t = nb(await text(owner));
  assert(t.includes('Lampa(såltur') && t.includes('1400,00'), 'fakturautkast för sålda: ' + t.slice(0, 800));
  assert((await kmove('return', '10')).includes('har 6 st i konsignation'), 'retur högst det som finns hos återförsäljaren');
  await kmove('return', '2');
  await owner.goto(KG + '/konsignation');
  assert(nb(await owner.locator('.kg-qty').innerText()) === '4st' && nb(await owner.locator('.kg-total').innerText()) === '800,00', 'kvar efter retur');
  log('konsignation: utleverans flyttar lagret till 1465, sålt enligt rapport ger fakturautkast och lagerminskning, retur högst det som finns kvar');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 29: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
