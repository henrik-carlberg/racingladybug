// End-to-end, omgång 27: inköp med omvänd skattskyldighet, utlägg för kund, presentkort, personalfester, pensionssparande.
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

  // ================= Del 1: inköp med omvänd skattskyldighet =================
  const RB = await newCompany('Byggherren AB', 559360000);
  await owner.goto(RB + '/leverantorer');
  await owner.fill('input[name=name]', 'Byggfirman AB');
  await owner.click('button:has-text("Spara leverantör")'); await owner.waitForURL(/ok=/);
  const si = async (no, total, vat, account, rc) => {
    await owner.goto(RB + '/leverantorsfakturor/ny');
    await owner.selectOption('select[name=supplier_id]', { label: 'Byggfirman AB' });
    await owner.fill('input[name=invoice_number]', no); await owner.fill('input[name=due_date]', day(-20));
    await owner.fill('input[name=invoice_date]', day(2)).catch(() => {});
    await owner.fill('input[name=total]', total); await owner.locator('input[name=total]').blur(); await owner.fill('input[name=vat]', vat);
    await owner.fill('input[name=account_0]', account); await owner.fill('input[name=amount_0]', String(Number(total) - Number(vat)));
    if (rc) await owner.selectOption('select[name=rc_kind]', rc);
    await owner.click('button:has-text("Registrera och bokför")');
    await owner.waitForURL(/(ok|error)=/);
    return decodeURIComponent(owner.url().replace(/\+/g, ' '));
  };
  assert((await si('B-1', '100000', '25000', '5010', 'construction')).includes('inte innehålla moms'), 'omvänd skattskyldighet utan moms på fakturan');
  assert((await si('B-2', '125000', '25000', '4425', '')).includes('omvänd skattskyldighet'), 'konto för omvänd skattskyldighet med moms nekas');
  assert((await si('B-3', '100000', '0', '5010', 'construction')).includes('ok='), 'byggtjänst med omvänd skattskyldighet');
  await owner.goto(RB + `/rapporter/moms?from=${day(2).slice(0, 7)}-01&to=${day(0)}`);
  t = nb(await text(owner));
  assert(t.includes('(omvändskattskyldighet)100000') && t.includes('påinköpiruta20–2425000') && t.includes('Ingåendemomsattdraav25000') && t.includes('fåtillbaka0'), 'rutorna 24, 30 och 48: ' + t.slice(0, 1200));
  log('inköp med omvänd byggmoms: fakturan utan moms, 100 000 kr i ruta 24, beräknad moms 25 000 kr i ruta 30 och 48, konto med moms nekas');

  // ================= Del 2: utlägg för kunds räkning =================
  const UK = await newCompany('Ombudsbyrån AB', 559370000);
  await owner.goto(UK + '/kunder');
  await owner.fill('input[name=name]', 'Klienten AB');
  await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  const outlay = async (desc, amount, ok) => {
    await owner.goto(UK + '/kundutlagg');
    await owner.fill('input[name=description]', desc); await owner.fill('input[name=amount]', amount); await owner.fill('input[name=date]', day(3));
    if (ok) { await owner.check('input[name=on_behalf]'); await owner.check('input[name=receipt]'); }
    await owner.click('button:has-text("Bokför utlägg")');
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  assert((await outlay('Kontorsmaterial', '500', false)).includes('vidarefakturering'), 'utan kvitto i kundens namn är det vidarefakturering');
  await outlay('Registreringsavgift Bolagsverket', '2200', true);
  await outlay('Avgift Lantmäteriet', '800', true);
  await owner.goto(UK + '/kundutlagg');
  assert(nb(await owner.locator('.ku-open').innerText()) === '3000,00', 'ofakturerade utlägg');
  await owner.click('.ku-invoice button:has-text("Skapa faktura för utläggen")');
  await owner.waitForURL(/fakturor\/\d+/);
  await owner.click('button:has-text("Bokför faktura")');
  await owner.locator('text=Fakturan är bokförd').waitFor();
  t = nb(await text(owner));
  assert(t.includes('3000,00') && t.includes('Utlägg:RegistreringsavgiftBolagsverket'), 'faktura utan moms: ' + t.slice(0, 800));
  await owner.goto(UK + `/rapporter/moms?from=${day(3).slice(0, 7)}-01&to=${day(0)}`);
  t = nb(await text(owner));
  assert(t.includes('ruta06–080') && t.includes('fåtillbaka0'), 'utläggen är inte med i momsdeklarationen: ' + t.slice(0, 600));
  await owner.goto(UK + '/kundutlagg');
  assert(nb(await owner.locator('.ku-open').innerText()) === '0,00' && !(await owner.locator('.ku-invoice').count()), 'alla utlägg fakturerade');
  log('utlägg för kund: kräver kvitto i kundens namn, bokförs mot 1680 och faktureras utan moms utanför momsdeklarationen');

  // ================= Del 3: presentkort =================
  const GC = await newCompany('Presentbutiken AB', 559380000);
  const sellGc = async (code, kind, amount, d, valid) => {
    await owner.goto(GC + '/presentkort');
    const f = owner.locator('.gc-sell');
    await f.locator('input[name=code]').fill(code); await f.locator('select[name=kind]').selectOption(kind); await f.locator('input[name=amount]').fill(amount);
    await f.locator('input[name=date]').fill(d); await f.locator('input[name=valid_to]').fill(valid);
    await f.locator('button:has-text("Bokför försäljning")').click();
    await owner.locator('.flash').first().waitFor();
  };
  const redeemGc = async (code, amount, d) => {
    await owner.goto(GC + '/presentkort');
    const f = owner.locator('.gc-redeem');
    await f.locator('input[name=code]').fill(code); await f.locator('input[name=amount]').fill(amount); await f.locator('input[name=date]').fill(d);
    await f.locator('button:has-text("Bokför inlösen")').click();
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  await sellGc('PK-1', 'single', '1250', day(10), day(-300));
  await sellGc('PK-2', 'multi', '1000', day(40), day(5));
  assert((await redeemGc('PK-1', '2000', day(2))).includes('Kvarpåkortet:1250kr'), 'mer än kortets värde nekas');
  assert((await redeemGc('PK-1', '500', day(2))).includes('kvarpåkortet750,00kr'), 'delvis inlösen');
  assert((await redeemGc('PK-2', '100', day(2))).includes('gickut'), 'utgånget kort kan inte lösas in');
  await owner.goto(GC + '/presentkort');
  assert(nb(await owner.locator('.gc-outstanding').innerText()) === '1750,00', 'utestående före intäktsföring');
  await owner.click('button:has-text("Intäktsför utgångna presentkort")');
  await owner.locator('text=1 utgångna presentkort (1 000,00 kr) är intäktsförda').waitFor();
  await owner.goto(GC + '/presentkort');
  assert(nb(await owner.locator('.gc-outstanding').innerText()) === '750,00', 'utestående efter intäktsföring');
  await owner.goto(GC + `/rapporter/moms?from=${day(40).slice(0, 7)}-01&to=${day(0)}`);
  t = nb(await text(owner));
  assert(t.includes('Utgåendemoms25%250'), 'moms på enfunktionsvouchern vid försäljningen, inte på det utgångna flerfunktionskortet: ' + t.slice(0, 700));
  log('presentkort: enfunktionsvoucher med moms vid försäljning, delvis inlösen, flerfunktionsvoucher som går ut intäktsförs utan moms');

  // ================= Del 4: personalfester =================
  const PF = await newCompany('Festbolaget AB', 559390000);
  const party = async (title, f) => {
    await owner.goto(PF + '/personalfest');
    await owner.fill('input[name=title]', title); await owner.fill('input[name=date]', day(5));
    for (const [k, v] of Object.entries(f)) await owner.fill(`input[name=${k}]`, v);
    await owner.click('button:has-text("Bokför personalfest")');
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await party('Julfest', { persons: '10', meal: '6000', meal_vat: '720', other: '2500', other_vat: '625' });
  assert(t.includes('momsattdraav810,00kr') && t.includes('avdragsgillt1800,00kr') && t.includes('ejavdragsgillt7235,00kr') && !t.includes('⚠'), 'moms 300 kr och övrigt 180 kr per person: ' + t);
  await party('Sommarfest', { persons: '10', meal: '3000', meal_vat: '360' });
  t = await party('Höstfest', { persons: '10', meal: '3000', meal_vat: '360', guideline: '200' });
  assert(t.includes('årets3:epersonalfest') && t.includes('riktvärde'), 'förmånsvarning för tredje festen och över riktvärdet: ' + t);
  await owner.goto(PF + '/personalfest');
  assert(nb(await owner.locator('.pf-count').innerText()) === '3', 'tre fester i år');
  log('personalfester: momsavdrag högst 300 kr per person, övriga kostnader 180 kr per person, måltiden ej avdragsgill, varning vid tredje festen');

  // ================= Del 5: pensionssparande för enskild näringsidkare =================
  const pnr = (nine) => { let s = 0; for (let i = 0; i < 9; i++) { const v = +nine[i] * (i % 2 ? 1 : 2); s += v > 9 ? v - 9 : v; } return nine + ((10 - (s % 10)) % 10); };
  const nr = pnr(`7708${String(10 + (Date.now() % 18)).padStart(2, '0')}${String(Date.now() % 1000).padStart(3, '0')}`);
  await owner.goto(BASE + '/');
  await owner.fill('input[name=name]', 'Konsulten Enskild Firma');
  await owner.selectOption('select[name=company_type]', 'EF');
  await owner.fill('input[name=orgnr]', `19${nr.slice(0, 6)}-${nr.slice(6)}`);
  await owner.fill('input[name=fy_start]', `${YEAR}-01-01`); await owner.fill('input[name=fy_end]', `${YEAR}-12-31`);
  await owner.click('button:has-text("Skapa bolag")');
  await owner.waitForURL(/kom-igang/);
  const EP = owner.url().replace(/\/kom-igang.*/, '');
  await voucher(EP, 'Konsultintäkter', [[1930, 500000], [3001, -400000], [2611, -100000]], `${YEAR}-03-01`);
  const prem = async (amount) => {
    await owner.goto(EP + `/pensionssparande?ar=${YEAR}`);
    await owner.fill('form:has(button:has-text("Bokför premie")) input[name=amount]', amount); await owner.fill('input[name=insurer]', 'Pensionsbolaget');
    await owner.fill('form:has(button:has-text("Bokför premie")) input[name=date]', day(2));
    await owner.click('button:has-text("Bokför premie")');
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  await owner.goto(EP + `/pensionssparande?ar=${YEAR}`);
  assert(nb(await owner.locator('.ep-max').innerText()) === '140000,00', '35 % av inkomsten 400 000 kr');
  assert((await prem('150000')).includes('räckertill140000kr'), 'över avdragsutrymmet nekas');
  await prem('100000');
  await owner.goto(EP + `/pensionssparande?ar=${YEAR}`);
  assert(nb(await owner.locator('.ep-left').innerText()) === '40000,00' && nb(await owner.locator('.ep-slp').innerText()) === '24260,00', 'kvar och särskild löneskatt');
  await owner.check('input[name=has_occupational]'); await owner.click('form:has(input[name=has_occupational]) button:has-text("Spara")');
  await owner.locator('text=Uppgifterna är sparade').waitFor();
  assert((await prem('10000')).includes('saknartjänstepension'), 'tjänstepension i anställning stänger avdraget');
  await owner.goto(GC + '/pensionssparande');
  assert(await owner.locator('.ep-not-ef').count() === 1, 'gäller bara enskild firma');
  log('pensionssparande: avdragsutrymme 35 % (högst 10 prisbasbelopp), premie som privat uttag, kvar att sätta in, särskild löneskatt 24,26 %');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 27: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
