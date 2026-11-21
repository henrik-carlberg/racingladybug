// End-to-end, omgång 25: vinstmarginalbeskattning, Intrastat, skogskonto, korttidsinventarier, sponsring och gåvor.
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

  // ================= Del 1: vinstmarginalbeskattning =================
  const VM = await newCompany('Antikhandeln AB', 559270000);
  const vmb = async (kind, what, price, d) => {
    await owner.goto(VM + '/vmb');
    const f = owner.locator(`form:has(button:has-text("Bokför ${kind}"))`);
    await f.locator('input[name=description]').fill(what); await f.locator('input[name=price]').fill(price); await f.locator('input[name=date]').fill(d);
    await f.locator(`button:has-text("Bokför ${kind}")`).click();
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  assert((await vmb('inköp', 'Byrå', '60000', `${YEAR}-01-05`)).includes('högst50000kr'), 'förenklad metod högst 50 000 kr');
  await vmb('inköp', 'Byrå', '10000', `${YEAR}-01-05`);
  await vmb('försäljning', 'Byrå', '8000', `${YEAR}-01-20`);
  const settleVmb = async (from, to) => {
    await owner.goto(VM + '/vmb');
    await owner.fill('input[name=period_from]', from); await owner.fill('input[name=period_to]', to);
    await owner.click('button:has-text("Avräkna perioden")');
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await settleVmb(`${YEAR}-01-01`, `${YEAR}-01-31`);
  assert(t.includes('Negativmarginal2000,00kr'), 'negativ marginal förs över: ' + t);
  assert((await settleVmb(`${YEAR}-03-01`, `${YEAR}-03-31`)).includes(`Nästaperiodbörjar${YEAR}-02-01`), 'perioderna i följd');
  await vmb('inköp', 'Tavla', '5000', `${YEAR}-02-03`);
  await vmb('försäljning', 'Tavla', '19500', `${YEAR}-02-25`);
  t = await settleVmb(`${YEAR}-02-01`, `${YEAR}-02-28`);
  assert(t.includes('Marginalenär12500,00kr:moms2500,00kr,beskattningsunderlag10000,00kriruta07'), 'moms på marginalen: ' + t);
  assert((await vmb('försäljning', 'Sen byrå', '5000', `${YEAR}-02-10`)).includes('VMBäravräknadtillochmed'), 'försäljning i avräknad period nekas');
  await owner.goto(VM + `/rapporter/moms?from=${YEAR}-02-01&to=${YEAR}-02-28`);
  t = await text(owner);
  assert(t.includes('Beskattningsunderlag vid vinstmarginalbeskattning'), 'ruta 07 i momsrapporten: ' + t.slice(0, 600));
  log('VMB: förenklad metod, negativ marginal 2 000 kr förs över, marginal 12 500 kr ger moms 2 500 kr och underlag 10 000 kr i ruta 07');

  // ================= Del 2: Intrastat =================
  const IS = await newCompany('Exportören AB', 559280000);
  const P = `${YEAR}-10`;
  await voucher(IS, 'Försäljning till Tyskland', [[1930, 4000000], [3106, -4000000]], `${P}-15`);
  await voucher(IS, 'Inköp från Polen', [[4515, 100000], [1930, -100000]], `${P}-16`);
  await owner.goto(IS + `/intrastat?period=${P}`);
  t = nb(await owner.locator('.is-dispatch .is-status').innerText());
  assert(t.includes('Näratröskeln'), 'varning nära tröskeln: ' + t);
  await voucher(IS, 'Försäljning till Finland', [[1930, 1000000], [3106, -1000000]], `${YEAR}-09-10`);
  await owner.goto(IS + `/intrastat?period=${P}`);
  assert(nb(await owner.locator('.is-dispatch .is-status').innerText()).includes('Rapporteringsplikt') && !nb(await owner.locator('.is-arrival .is-status').innerText()).includes('Rapporteringsplikt'), 'utförseln över tröskeln, inte införseln');
  const isLine = async (kn, value, mass) => {
    await owner.goto(IS + `/intrastat?period=${P}`);
    await owner.fill('input[name=kn]', kn); await owner.selectOption('select[name=country]', 'DE');
    await owner.fill('input[name=value]', value); await owner.fill('input[name=mass]', mass);
    await owner.click('button:has-text("Lägg till rad")');
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  assert((await isLine('1234', '100', '1')).includes('åttasiffror'), 'KN-nummer med åtta siffror');
  await isLine('94036010', '4000000', '1200');
  await owner.goto(IS + `/intrastat?period=${P}`);
  assert(nb(await owner.locator('.is-dispatch').innerText()).includes('(0%)'), 'deklarationen stämmer med bokföringen');
  const csv = await (await owner.request.get(IS + `/intrastat/fil?period=${P}`)).text();
  assert(csv.includes(`2;${P.replace('-', '')};94036010;DE;;11;4000000;1200;`), 'fil: ' + csv);
  await owner.goto(IS + `/rapporter/moms?from=${P}-01&to=${P}-31`);
  assert((await text(owner)).includes('Inköp av varor från annat EU-land'), 'ruta 20 i momsrapporten');
  log('Intrastat: varning nära tröskeln, rapporteringsplikt över 4,5 Mkr utförsel, rad med KN-nummer stämmer med bokföringen, fil för SCB');

  // ================= Del 3: skogsbruk =================
  const pnr = (nine) => { let s = 0; for (let i = 0; i < 9; i++) { const v = +nine[i] * (i % 2 ? 1 : 2); s += v > 9 ? v - 9 : v; } return nine + ((10 - (s % 10)) % 10); };
  const nr = pnr(`8505${String(10 + (Date.now() % 18)).padStart(2, '0')}${String(Date.now() % 1000).padStart(3, '0')}`);
  await owner.goto(BASE + '/');
  await owner.fill('input[name=name]', 'Skogsägaren Enskild Firma');
  await owner.selectOption('select[name=company_type]', 'EF');
  await owner.fill('input[name=orgnr]', `19${nr.slice(0, 6)}-${nr.slice(6)}`);
  await owner.fill('input[name=fy_start]', `${YEAR}-01-01`); await owner.fill('input[name=fy_end]', `${YEAR}-12-31`);
  await owner.click('button:has-text("Skapa bolag")');
  await owner.waitForURL(/kom-igang/);
  const SK = owner.url().replace(/\/kom-igang.*/, '');
  await voucher(SK, 'Insättning eget kapital', [[1930, 500000], [2010, -500000]], `${YEAR}-01-02`);
  const sk = async (formSel, fields, btn) => {
    await owner.goto(SK + `/skog?ar=${YEAR}`);
    const f = owner.locator(formSel);
    for (const [k, v] of Object.entries(fields)) { if (k === 'kind' || k === 'account') await f.locator(`select[name=${k}]`).selectOption(v); else await f.locator(`input[name=${k}]`).fill(v); }
    await f.locator(`button:has-text("${btn}")`).click();
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  await sk('form:has(button:has-text("Registrera likvid"))', { date: `${YEAR}-03-01`, kind: 'rotpost', amount: '100000' }, 'Registrera likvid');
  await sk('form:has(button:has-text("Registrera likvid"))', { date: `${YEAR}-04-01`, kind: 'leveransvirke', amount: '50000' }, 'Registrera likvid');
  await owner.goto(SK + `/skog?ar=${YEAR}`);
  assert(nb(await owner.locator('.sk-room-skog').innerText()) === '80000,00' && nb(await owner.locator('.sk-room-skada').innerText()) === '105000,00', 'insättningsutrymme 60/40 och 80/50');
  await sk('.sk-deposit', { account: 'skog', amount: '40000' }, 'Bokför insättning');
  await owner.goto(SK + `/skog?ar=${YEAR}`);
  assert(nb(await owner.locator('.sk-room-skog').innerText()) === '40000,00' && nb(await owner.locator('.sk-room-skada').innerText()) === '52500,00', 'insättningen tar utrymme från båda kontona');
  assert((await sk('.sk-deposit', { account: 'skog', amount: '50000' }, 'Bokför insättning')).includes('Utrymmetförinsättning'), 'över utrymmet nekas');
  await sk('.sk-withdraw', { account: 'skog', amount: '10000' }, 'Bokför uttag');
  await sk('form:has(button:has-text("Spara")):has(input[name=acquisition_value])', { acquisition_value: '120000' }, 'Spara');
  assert((await sk('form:has(button:has-text("Spara skogsavdrag"))', { amount: '70000' }, 'Spara skogsavdrag')).includes('högst60000kr'), 'skogsavdraget begränsas av halva anskaffningsvärdet');
  await sk('form:has(button:has-text("Spara skogsavdrag"))', { amount: '60000' }, 'Spara skogsavdrag');
  await owner.goto(SK + `/skog?ar=${YEAR}`);
  assert(nb(await owner.locator('.sk-ne-deposit').innerText()) === '40000,00' && nb(await owner.locator('.sk-ne-withdrawn').innerText()) === '10000,00'
    && nb(await owner.locator('.sk-ne-ded').innerText()) === '60000,00' && nb(await owner.locator('.sk-bal-skog').innerText()) === '30000,00', 'NE-bilagans belopp och saldo');
  await owner.goto(IS + '/skog');
  assert(await owner.locator('.sk-not-ef').count() === 1, 'aktiebolag har inte skogskonto');
  log('skogsbruk: insättningsutrymme 60/40 och 80/50 delat mellan kontona, uttag som intäkt, skogsavdrag högst halva anskaffningsvärdet, bara enskild firma');

  // ================= Del 4: korttidsinventarier och inventarier av mindre värde =================
  const DA = await newCompany('Inventarieköparen AB', 559290000);
  const half = ({ 2024: 28650, 2025: 29400, 2026: 29600 })[YEAR] ?? 29600;
  await voucher(DA, 'Kontorsmöbler: skrivbord', [[5410, 18000], [1930, -18000]], `${YEAR}-05-10`);
  await voucher(DA, 'Kontorsmöbler: stolar', [[5410, 15000], [1930, -15000]], `${YEAR}-05-10`);
  await voucher(DA, 'Maskin svarv', [[5410, 40000], [1930, -40000]], `${YEAR}-06-01`);
  await voucher(DA, 'Pärmar', [[5410, 900], [1930, -900]], `${YEAR}-06-02`);
  await owner.goto(DA + `/anlaggningar/direktavdrag?ar=${YEAR}&price=20000&life=5`);
  assert((await owner.locator('.da-small_value').count()) === 1, 'under halvt prisbasbelopp: direktavdrag');
  await owner.goto(DA + `/anlaggningar/direktavdrag?ar=${YEAR}&price=20000&life=5&related=60000`);
  assert((await owner.locator('.da-asset').count()) === 1 && (await text(owner)).includes('större anskaffning'), 'naturligt samband över gränsen');
  await owner.goto(DA + `/anlaggningar/direktavdrag?ar=${YEAR}&price=40000&life=2`);
  assert((await owner.locator('.da-short_life').count()) === 1, 'korttidsinventarie');
  await owner.goto(DA + `/anlaggningar/direktavdrag?ar=${YEAR}`);
  assert(await owner.locator('.da-row').count() === 3 && !(await text(owner)).includes('Pärmar'), 'tre flaggade inköp (två hör ihop), pärmarna inte: ' + (await text(owner)).slice(0, 800));
  const row = (desc) => owner.locator(`.da-row:has-text("${desc}")`);
  await row('Maskin svarv').locator('select[name=category]').selectOption('maskiner');
  await row('Maskin svarv').locator('button:has-text("Aktivera och skriv av")').click();
  await owner.locator('text=Inventariet (40 000,00 kr) är aktiverat').waitFor();
  await row('skrivbord').locator('select[name=decision]').selectOption('keep');
  await row('skrivbord').locator('button:has-text("Spara bedömning")').click();
  await owner.locator('text=Motivera varför').waitFor();
  await owner.goto(DA + `/anlaggningar/direktavdrag?ar=${YEAR}`);
  await row('skrivbord').locator('input[name=note]').fill('Skrivbordet är fristående från stolarna');
  await row('skrivbord').locator('select[name=decision]').selectOption('keep');
  await row('skrivbord').locator('button:has-text("Spara bedömning")').click();
  await owner.locator('text=Direktavdraget behålls').waitFor();
  await owner.goto(DA + '/anlaggningar');
  t = await text(owner);
  assert(t.includes('Maskin svarv'), 'maskinen i anläggningsregistret: ' + t.slice(0, 800));
  await owner.goto(DA + `/anlaggningar/direktavdrag?ar=${YEAR}`);
  assert(await owner.locator('.da-row').count() === 1 && await owner.locator('.da-decided tr').count() === 2, 'en kvar att bedöma, två bedömda');
  log(`direktavdrag: halvt prisbasbelopp ${half} kr, korttidsinventarier, inköp som hör ihop flaggas, aktivering till anläggningsregistret och motiverat direktavdrag`);

  // ================= Del 5: sponsring och gåvor =================
  const SP = await newCompany('Sponsorn AB', 559300000);
  const spons = async (formSel, f, btn) => {
    await owner.goto(SP + '/sponsring');
    const fm = owner.locator(formSel);
    for (const [k, v] of Object.entries(f)) await fm.locator(`input[name=${k}]`).fill(v);
    await fm.locator(`button:has-text("${btn}")`).click();
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  assert((await spons('.sp-sponsor', { recipient: 'IFK Orten', amount: '20000', vat: '5000', counter_performance: 'Logotyp på matchtröjor' }, 'Bokför sponsring')).includes('avdragsgillkostnad'), 'sponsring med motprestation');
  assert((await spons('.sp-sponsor', { recipient: 'Välgörenhet', amount: '5000', vat: '0' }, 'Bokför sponsring')).includes('utanmotprestation'), 'sponsring utan motprestation är gåva');
  assert((await spons('.sp-gift', { recipient: 'Julgåvor till kunder', recipients: '10', amount: '2500', vat: '625' }, 'Bokför gåvor')).includes('avdragsgillkostnad'), 'gåvor 250 kr per mottagare');
  t = await spons('.sp-gift', { recipient: 'Vinflaskor', recipients: '4', amount: '2000', vat: '500' }, 'Bokför gåvor');
  assert(t.includes('500,00krpermottagare'), 'gåvor över 300 kr: ' + t);
  await owner.goto(SP + '/sponsring');
  assert(nb(await owner.locator('.sp-ded').innerText()) === '22500,00' && nb(await owner.locator('.sp-nonded').innerText()) === '7500,00', 'avdragsgillt och ej avdragsgillt');
  log('sponsring och gåvor: motprestation ger avdrag och moms, utan motprestation och gåvor över 300 kr per mottagare är ej avdragsgilla (6993)');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 25: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
