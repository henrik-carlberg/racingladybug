// End-to-end, omgång 32: klientmedel, returemballage och pant, uthyrning av utrustning, lojalitetsprogram, franchise.
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

  // ================= Del 1: klientmedel =================
  const KM = await newCompany('Mäklarfirman AB', 559700000);
  await owner.goto(KM + '/kunder');
  await owner.fill('input[name=name]', 'Anna Andersson'); await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await invoice(KM, 'Anna Andersson', 25000, day(2));
  await owner.goto(KM + '/klientmedel');
  await owner.fill('input[name=name]', 'Anna Andersson'); await owner.fill('input[name=reference]', 'Villa Ekbacken');
  await owner.selectOption('select[name=customer_id]', { label: 'Anna Andersson' });
  await owner.click('button:has-text("Lägg upp klient")'); await owner.locator('text=Klienten är upplagd').waitFor();
  const cfEntry = async (kind, amount) => {
    await owner.selectOption('form:has(button:text-is("Bokför")) select[name=kind]', kind);
    await owner.fill('form:has(button:text-is("Bokför")) input[name=amount]', amount);
    await owner.click('button:text-is("Bokför")');
  };
  await cfEntry('deposit', '500000'); await owner.locator('text=Insättningen på').waitFor();
  await cfEntry('payout', '400000'); await owner.locator('text=Utbetalningen på').waitFor();
  await cfEntry('payout', '200000'); await owner.locator('text=en klients medel får inte användas för en annan').waitFor();
  await cfEntry('fee', ''); await owner.locator('text=och fakturan är betald').waitFor();
  assert(nb(await owner.locator('.cf-statement-balance').innerText()) === '68750,00', 'saldo efter arvode: ' + await owner.locator('.cf-statement').innerText());
  assert(nb(await owner.locator('.cf-bank').innerText()) === '68750,00' && nb(await owner.locator('.cf-liability').innerText()) === '68750,00' && (await owner.locator('.cf-check').innerText()) === 'Stämmer', 'avstämning 1940/2890');
  await owner.goto(KM + '/fakturor');
  assert((await text(owner)).includes('Betald'), 'arvodesfakturan är betald');
  await owner.goto(KM + '/klientmedel'); await owner.locator('.cf-row[data-name="Anna Andersson"] a').click(); await owner.waitForURL(/client=/);
  await cfEntry('payout', '68750'); await owner.locator('text=Utbetalningen på').waitFor();
  await owner.click('button:has-text("Avsluta klienten")'); await owner.locator('text=Klienten är avslutad').waitFor();
  assert(nb(await owner.locator('.cf-total').innerText()) === '0,00' && nb(await owner.locator('.cf-bank').innerText()) === '0,00', 'allt utbetalt');
  await owner.goto(KM + '/verifikationer');
  await owner.locator('tr:has-text("Arvode faktura") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('2890') && t.includes('1940') && t.includes('31250,00'), 'arvode 2890/1940: ' + t.slice(0, 600));
  log('klientmedel: avskilt konto 1940 med skuld 2890, saldo per klient som inte får bli negativt, arvode mot faktura till eget konto, saldobesked och avstämning');

  // ================= Del 2: returemballage och pant =================
  const PE = await newCompany('Pallbolaget AB', 559710000);
  await owner.goto(PE + '/kunder');
  await owner.fill('input[name=name]', 'Grossist AB'); await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await owner.goto(PE + '/emballage');
  await owner.fill('form:has(button:has-text("Lägg upp förpackning")) input[name=name]', 'EUR-pall'); await owner.fill('input[name=deposit]', '150');
  await owner.click('button:has-text("Lägg upp förpackning")'); await owner.locator('text=Förpackningstypen är upplagd').waitFor();
  const pk = async (btn, q) => {
    await owner.goto(PE + '/emballage');
    const f = owner.locator(`form:has(button:has-text("${btn}"))`);
    await f.locator('input[name=quantity]').fill(q); await f.locator('button').click();
  };
  await pk('Fakturera pant', '10'); await owner.waitForURL(/fakturor\/\d+\?ok/);
  t = nb(await text(owner)); assert(t.includes('PantEUR-pall') && t.includes('1500,00'), 'pant på fakturan: ' + t.slice(0, 900));
  await owner.click('button:has-text("Bokför faktura")'); await owner.locator('text=Fakturan är bokförd').waitFor();
  await pk('Kreditera pant', '4'); await owner.waitForURL(/fakturor\/\d+\?ok/);
  assert(nb(await text(owner)).includes('-600,00'), 'kredit av pant');
  await owner.click('button:has-text("Bokför faktura")'); await owner.locator('text=Fakturan är bokförd').waitFor();
  await pk('Kreditera pant', '7'); await owner.locator('text=har bara 6 EUR-pall utlämnade').waitFor();
  await owner.goto(PE + '/emballage');
  const prw = owner.locator('.pk-row[data-customer="Grossist AB"]');
  assert(nb(await prw.locator('.pk-qty').innerText()) === '6' && nb(await prw.locator('.pk-value').innerText()) === '900,00', 'sex pallar hos kunden');
  assert(nb(await owner.locator('.pk-ledger').innerText()) === '900,00' && nb(await owner.locator('.pk-total').innerText()) === '900,00', 'pantskuld 2899 stämmer');
  await prw.locator('button:has-text("Förverka panten")').click(); await owner.locator('text=är förverkad och intäktsförd').waitFor();
  assert(nb(await owner.locator('.pk-ledger').innerText()) === '0,00' && await owner.locator('.pk-row').count() === 0, 'förverkad pant');
  await owner.goto(PE + '/verifikationer');
  await owner.locator('tr:has-text("Förverkad pant") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('2899') && t.includes('3990') && t.includes('900,00'), 'förverkad 2899/3990: ' + t.slice(0, 600));
  log('returemballage: pant utan moms mot pantskuld 2899 på fakturan, kreditering vid retur, saldo per kund, förverkad pant som intäkt');

  // ================= Del 3: uthyrning av utrustning =================
  const UH = await newCompany('Maskinuthyrning AB', 559720000);
  if (Number(day(20).slice(0, 4)) !== YEAR) await addFy(UH, YEAR - 1);
  await owner.goto(UH + '/kunder');
  await owner.fill('input[name=name]', 'Byggare AB'); await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await owner.goto(UH + '/uthyrning');
  await owner.fill('input[name=serial]', 'GRV-01'); await owner.fill('form:has(button:has-text("Lägg upp utrustning")) input[name=name]', 'Minigrävare');
  await owner.fill('input[name=day_rate]', '1000'); await owner.fill('input[name=week_rate]', '5000'); await owner.fill('input[name=month_rate]', '15000');
  await owner.click('button:has-text("Lägg upp utrustning")'); await owner.locator('text=Utrustningen är upplagd').waitFor();
  const rrow = () => owner.locator('.rn-row[data-serial="GRV-01"]');
  await rrow().locator('input[name=start_date]').fill(day(20)); await rrow().locator('input[name=expected_end]').fill(day(5));
  await rrow().locator('button:has-text("Lämna ut")').click(); await owner.locator('text=Utrustningen är utlämnad').waitFor();
  t = await rrow().locator('.rn-status').innerText();
  assert(t.includes('Uthyrd till Byggare AB') && t.includes('Skulle ha lämnats'), 'uthyrd och försenad: ' + t);
  await owner.goto(UH + '/uthyrning');
  await rrow().locator('input[name=until]').fill(day(11)); await rrow().locator('button:has-text("Fakturera period")').click(); await owner.waitForURL(/fakturor\/\d+\?ok/);
  t = nb(await text(owner)); assert(t.includes('(10dagar)') && t.includes('8000,00'), 'vecka + tre dagar: ' + t.slice(0, 900));
  await owner.click('button:has-text("Bokför faktura")'); await owner.locator('text=Fakturan är bokförd').waitFor();
  await owner.goto(UH + '/uthyrning');
  await rrow().locator('input[name=damage]').fill('2500'); await rrow().locator('input[name=damage_note]').fill('Trasig skopa'); await rrow().locator('input[name=late]').fill('1000');
  await rrow().locator('button:has-text("Återlämnad")').click(); await owner.waitForURL(/fakturor\/\d+\?ok/);
  t = nb(await text(owner));
  assert(t.includes('(11dagar)') && t.includes('9000,00') && t.includes('SkadeavgiftGRV-01:Trasigskopa') && t.includes('Förseningsavgift'), 'slutfaktura: ' + t.slice(0, 1200));
  await owner.click('button:has-text("Bokför faktura")'); await owner.locator('text=Fakturan är bokförd').waitFor();
  await owner.goto(UH + '/uthyrning');
  assert((await rrow().locator('.rn-status').innerText()) === 'Tillgänglig', 'tillgänglig igen');
  assert(nb(await rrow().locator('.rn-util').innerText()) === '23,3%' && nb(await rrow().locator('.rn-revenue').innerText()) === '20500,00', 'beläggning och intäkt: ' + await rrow().innerText());
  log('uthyrning: individ med serienummer, fakturering per period med billigaste av dag-/veckopris, återlämning med skade- och förseningsavgift, beläggning och intäkt per individ');

  // ================= Del 4: lojalitetsprogram =================
  const LY = await newCompany('Kundklubben AB', 559730000);
  if (Number(day(30).slice(0, 4)) !== YEAR) await addFy(LY, YEAR - 1);
  await owner.goto(LY + '/kunder');
  await owner.fill('input[name=name]', 'Stamkund AB'); await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await owner.goto(LY + '/lojalitet');
  await owner.fill('input[name=kr_per_point]', '10'); await owner.fill('input[name=point_value]', '0,10'); await owner.fill('input[name=redemption_rate]', '80');
  await owner.fill('input[name=start_date]', day(30));
  await owner.click('button:has-text("Starta programmet")'); await owner.locator('text=Programmet är sparat').waitFor();
  await owner.fill('input[name=joined_on]', day(30)); await owner.click('button:has-text("Lägg till medlem")'); await owner.locator('text=Kunden är medlem').waitFor();
  await invoice(LY, 'Stamkund AB', 4000, day(10));
  await invoice(LY, 'Stamkund AB', 1505, day(8));
  await owner.goto(LY + '/lojalitet');
  await owner.click('button:has-text("Registrera poäng från fakturor")'); await owner.locator('text=550 poäng har registrerats från 2 fakturor').waitFor();
  await owner.click('button:has-text("Justera skulden")'); await owner.locator('text=Skulden för bonuspoäng är justerad till 44,00 kr').waitFor();
  assert(nb(await owner.locator('.ly-booked').innerText()) === '44,00' && nb(await owner.locator('.ly-points').innerText()) === '550', 'skuld 550 p × 0,10 × 80 %');
  await owner.fill('input[name=points]', '600'); await owner.click('button:has-text("Lös in poäng")'); await owner.locator('text=har 550 poäng').waitFor();
  await owner.fill('input[name=points]', '200'); await owner.click('button:has-text("Lös in poäng")'); await owner.waitForURL(/fakturor\/\d+\?ok/);
  t = nb(await text(owner)); assert(t.includes('Inlöstabonuspoäng(200p)') && t.includes('-25,00'), 'rabatt med moms: ' + t.slice(0, 900));
  await owner.click('button:has-text("Bokför faktura")'); await owner.locator('text=Fakturan är bokförd').waitFor();
  await owner.goto(LY + '/lojalitet');
  await owner.click('button:has-text("Registrera poäng från fakturor")'); await owner.locator('text=0 poäng har registrerats').waitFor();
  assert(nb(await owner.locator('.ly-row[data-name="Stamkund AB"] .ly-balance').innerText()) === '350', 'saldo efter inlösen');
  await owner.click('button:has-text("Låt gamla poäng förfalla")'); await owner.locator('text=Inga poäng har förfallit').waitFor();
  await owner.click('button:has-text("Justera skulden")'); await owner.locator('text=justerad till 28,00 kr').waitFor();
  await owner.click('button:has-text("Justera skulden")'); await owner.locator('text=Skulden för bonuspoäng stämmer redan').waitFor();
  await owner.goto(LY + '/verifikationer');
  await owner.locator('tr:has-text("Skuld för utestående bonuspoäng: 550") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('3790') && t.includes('2970') && t.includes('44,00'), 'skuld 3790/2970: ' + t.slice(0, 600));
  log('lojalitetsprogram: poäng på fakturerade köp, skuld som förutbetald intäkt med förväntad inlösen, inlösen som rabatt med moms, förfall och justering');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 32: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
