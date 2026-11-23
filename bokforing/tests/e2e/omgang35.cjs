// End-to-end, omgång 35: anbud och ramavtal, scenarioplanering, evenemang, avgångsvederlag och uppsägning, leverantörsbedömning.
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

  // ================= Del 1: anbud och ramavtal =================
  const AN = await newCompany('Städtjänst AB', 559950000);
  if (Number(day(5).slice(0, 4)) !== YEAR) await addFy(AN, YEAR - 1);
  await owner.goto(AN + '/kunder');
  await owner.fill('input[name=name]', 'Kommunen'); await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  for (const [title, cost, bid] of [['Skolstädning', '800000', '1000000'], ['Parkskötsel', '400000', '500000']]) {
    await owner.goto(AN + '/anbud');
    const f = owner.locator('form:has(button:has-text("Registrera anbud"))');
    await f.locator('input[name=title]').fill(title); await f.locator('input[name=due_date]').fill(day(-5)); await f.locator('input[name=cost]').fill(cost); await f.locator('input[name=bid]').fill(bid);
    await f.locator('button').click(); await owner.locator('text=Anbudet är registrerat').waitFor();
  }
  for (const [title, st] of [['Skolstädning', 'won'], ['Parkskötsel', 'lost']]) {
    await owner.goto(AN + '/anbud');
    const r = owner.locator(`.tn-row[data-title="${title}"]`);
    await r.locator('select[name=status]').selectOption(st); await r.locator('button:has-text("Spara")').click(); await owner.locator('text=Anbudets status är uppdaterad').waitFor();
  }
  assert(nb(await owner.locator('.tn-winrate').innerText()) === '50%', 'vinstprocent');
  const af = owner.locator('form:has(button:has-text("Lägg upp ramavtal"))');
  await af.locator('select[name=tender_id]').selectOption({ label: 'Skolstädning' }); await af.locator('input[name=cap]').fill('100000');
  await af.locator('input[name=start_date]').fill(day(30)); await af.locator('input[name=end_date]').fill(day(-30));
  await af.locator('button').click(); await owner.locator('text=Ramavtalet är upplagt').waitFor();
  await invoice(AN, 'Kommunen', 85000, day(5));
  await invoice(AN, 'Kommunen', 20000, day(4));
  const fa = () => owner.locator('.fa-row[data-name="Skolstädning"]');
  await owner.goto(AN + '/anbud');
  assert(await fa().locator('.fa-expiring').count() === 1, 'avtalet löper ut snart');
  await fa().locator('select[name=invoice_id]').selectOption({ index: 1 }); await fa().locator('button:has-text("Koppla avrop")').click();
  await owner.locator('text=85 % av taket är avropat. Varningsgränsen är passerad').waitFor();
  await fa().locator('button:has-text("Koppla avrop")').click(); await owner.locator('text=105 % av taket är avropat. Taket är nått').waitFor();
  assert(nb(await fa().locator('.fa-left').innerText()).replace('−', '-') === '-5000,00' && nb(await fa().locator('.fa-level').innerText()) === 'Taketärnått', 'över taket');
  await fa().locator('input[name=end_date]').fill(`${YEAR + 2}-12-31`); await fa().locator('button:has-text("Förläng")').click(); await owner.locator('text=Avtalet är förlängt').waitFor();
  assert(await fa().locator('.fa-expiring').count() === 0, 'förlängt');
  log('anbud och ramavtal: anbud med kalkyl och vinstprocent, vunnet anbud blir ramavtal, avrop mot takbelopp med varning vid 80 % och 100 %, förlängning');

  // ================= Del 2: scenarioplanering =================
  const SC = await newCompany('Prognosbolaget AB', 559960000);
  if (Number(day(30).slice(0, 4)) !== YEAR) await addFy(SC, YEAR - 1);
  await owner.goto(SC + '/kunder');
  await owner.fill('input[name=name]', 'Storkunden AB'); await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await voucher(SC, 'Försäljning kontant', [[1930, 960000], [3001, -960000]], day(30));
  await voucher(SC, 'Varuinköp', [[4010, 600000], [1930, -600000]], day(25));
  await invoice(SC, 'Storkunden AB', 240000, day(20));
  const NY = YEAR + 1;
  await owner.goto(SC + `/scenarier?year=${NY}`);
  await owner.fill('form:has(button:has-text("Skapa scenario")) input[name=name]', 'Pessimistiskt'); await owner.click('button:has-text("Skapa scenario")'); await owner.locator('text=Scenariot är skapat').waitFor();
  const addItem = async (f) => {
    await owner.goto(SC + `/scenarier?year=${NY}`);
    const fm = owner.locator('.sn-scenario[data-name="Pessimistiskt"] form:has(button:has-text("Lägg till"))');
    await fm.locator('select[name=kind]').selectOption(f.kind);
    for (const k of ['label', 'from_month', 'pct', 'amount', 'years']) await fm.locator(`input[name=${k}]`).fill(f[k] ?? (k === 'from_month' ? '1' : ''));
    if (f.customer) await fm.locator('select[name=customer_id]').selectOption({ label: f.customer });
    await fm.locator('button').click(); await owner.locator('text=Förändringen är tillagd').waitFor();
  };
  await addItem({ kind: 'lost_customer', customer: 'Storkunden AB' });
  await addItem({ kind: 'hire', label: 'Ny säljare', from_month: '4', amount: '40000' });
  const sr = (n) => owner.locator(`.sn-row[data-name="${n}"]`);
  const neg = (s) => nb(s).replace('−', '-');
  assert(neg(await sr('Bas').locator('.sn-result').innerText()) === '600000,00' && neg(await sr('Bas').locator('.sn-lowest').innerText()) === '410000,00', 'bas: årstakt 100 000 − 50 000 per månad: ' + await sr('Bas').innerText());
  assert(neg(await sr('Pessimistiskt').locator('.sn-result').innerText()) === '-113112,00' && neg(await sr('Pessimistiskt').locator('.sn-diff').innerText()) === '-713112,00', 'scenario: ' + await sr('Pessimistiskt').innerText());
  assert(neg(await sr('Pessimistiskt').locator('.sn-lowest').innerText()) === '246888,00' && (await sr('Pessimistiskt').innerText()).includes('dec'), 'lägsta kassa i december');
  const items = owner.locator('.sn-scenario[data-name="Pessimistiskt"] .sn-item');
  assert((await items.first().getAttribute('data-label')) === 'Ny säljare' || neg(await owner.locator('.sn-item[data-label="Ny säljare"] .sn-impact').innerText()) === '-473112,00', 'påverkan per post');
  assert(neg(await owner.locator('.sn-item[data-label="Förlorar Storkunden AB"] .sn-impact').innerText()) === '-240000,00', 'förlorad kund 20 000 kr per månad');
  log('scenarioplanering: bas från årstakten, förlorad kund och nyanställning med arbetsgivaravgift, jämförelse av resultat och lägsta kassa, påverkan per förändring');

  // ================= Del 3: evenemang och biljetter =================
  const EV = await newCompany('Konferensbolaget AB', 559970000);
  await owner.goto(EV + '/kunder');
  await owner.fill('input[name=name]', 'Banken AB'); await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await owner.goto(EV + '/leverantorer');
  await owner.fill('input[name=name]', 'Lokalen AB'); await owner.click('button:has-text("Spara leverantör")'); await owner.waitForURL(/ok=/);
  await owner.goto(EV + '/evenemang');
  await owner.fill('form:has(button:has-text("Lägg upp evenemang")) input[name=name]', 'Sommarkonferens'); await owner.fill('form:has(button:has-text("Lägg upp evenemang")) input[name=date]', day(-20));
  await owner.fill('input[name=budget_cost]', '7000');
  await owner.click('button:has-text("Lägg upp evenemang")'); await owner.locator('text=Evenemanget är upplagt').waitFor();
  const ev = () => owner.locator('.ev-event[data-name="Sommarkonferens"]');
  for (const [n, p, v, c] of [['Konferens', '1250', '25', '3'], ['Middag', '1120', '12', '']]) {
    await owner.goto(EV + '/evenemang');
    const f = ev().locator('form:has(button:has-text("Lägg till biljettyp"))');
    await f.locator('input[name=name]').fill(n); await f.locator('input[name=price]').fill(p); await f.locator('select[name=vat_rate]').selectOption(v); await f.locator('input[name=capacity]').fill(c);
    await f.locator('button').click(); await owner.locator('text=Biljettypen är upplagd').waitFor();
  }
  const sellT = async (type, q, buyer) => {
    await owner.goto(EV + '/evenemang');
    const f = ev().locator('form:has(button:has-text("Sälj biljetter"))');
    await f.locator('select[name=type_id]').selectOption({ label: type }); await f.locator('input[name=quantity]').fill(q); await f.locator('input[name=buyer]').fill(buyer);
    await f.locator('button').click();
  };
  await sellT('Konferens', '2', 'Anna'); await owner.locator('text=Biljetter för 2 500,00 kr är sålda').waitFor();
  await sellT('Konferens', '1', 'Bertil'); await owner.locator('text=är sålda').waitFor();
  await sellT('Konferens', '1', 'Cecilia'); await owner.locator('text=Bara 0 platser kvar').waitFor();
  await sellT('Middag', '1', 'Anna'); await owner.locator('text=Biljetter för 1 120,00 kr är sålda').waitFor();
  await owner.goto(EV + '/evenemang');
  await ev().locator('.ev-ticket[data-buyer="Bertil"] button:has-text("Återbetala")').click(); await owner.locator('text=1 250,00 kr är återbetalt').waitFor();
  assert(nb(await ev().locator('.ev-type[data-name="Konferens"] .ev-left').innerText()) === '1', 'plats frigjord efter återbetalning');
  await ev().locator('input[name=amount]').fill('10000'); await ev().locator('button:has-text("Fakturera sponsring")').click(); await owner.waitForURL(/fakturor\/\d+\?ok/);
  assert(nb(await text(owner)).includes('12500,00'), 'sponsorfaktura med moms');
  await owner.click('button:has-text("Bokför faktura")'); await owner.locator('text=Fakturan är bokförd').waitFor();
  await owner.goto(EV + '/leverantorsfakturor/ny');
  await owner.selectOption('select[name=supplier_id]', { label: 'Lokalen AB' });
  await owner.fill('input[name=invoice_number]', 'L-1'); await owner.fill('input[name=invoice_date]', day(2)); await owner.fill('input[name=due_date]', day(-28));
  await owner.fill('input[name=total]', '10000'); await owner.locator('input[name=total]').blur(); await owner.fill('input[name=vat]', '2000');
  await owner.fill('input[name=account_0]', '5010'); await owner.fill('input[name=amount_0]', '8000');
  await owner.click('button:has-text("Registrera och bokför")'); await owner.waitForURL(/ok=/);
  await owner.goto(EV + '/evenemang');
  await ev().locator('button:has-text("Koppla kostnad")').click(); await owner.locator('text=Kostnaden är kopplad').waitFor();
  await ev().locator('button:text-is("Genomfört")').click(); await owner.locator('text=13 000,00 kr är intäktsfört').waitFor();
  assert(nb(await ev().locator('.ev-revenue').innerText()) === '13000,00' && nb(await ev().locator('.ev-costs').innerText()) === '8000,00' && nb(await ev().locator('.ev-result').innerText()) === '5000,00', 'resultat per event');
  await owner.goto(EV + '/verifikationer');
  await owner.locator('tr:has-text("Genomfört evenemang Sommarkonferens") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('2970') && t.includes('13000,00') && t.includes('3001') && t.includes('12000,00') && t.includes('3002') && t.includes('1000,00'), 'intäktsföring per momssats: ' + t.slice(0, 700));
  log('evenemang: biljettyper med momssats och kapacitet, biljetter och sponsring som förutbetald intäkt, återbetalning, kostnader och resultat per event, intäktsföring när eventet genomförs');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 35: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
