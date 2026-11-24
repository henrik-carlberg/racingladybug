// E2E omgång 36: försäkringsöversikt, leverantörsabonnemang, IT-utrustning, sanktionsavgifter, immateriella rättigheter
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

  // ================= Del 1: försäkringsöversikt =================
  const FO = await newCompany('Försäkrat AB', 559610000);
  const now = new Date();
  const pStart = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)));
  const pEnd = iso(new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth() - 2, 0)));
  if (Number(pStart.slice(0, 4)) < YEAR) await addFy(FO, YEAR - 1);
  await voucher(FO, 'Företagsförsäkring Trygg', [[6310, 12000], [1930, -12000]], pStart);
  const addPolicy = async (kind, insurer, premium, start, end, reclass) => {
    await owner.goto(FO + '/forsakringar');
    const f = owner.locator('form.ins-add');
    await f.locator('input[name=kind]').fill(kind); await f.locator('input[name=insurer]').fill(insurer); await f.locator('input[name=premium]').fill(premium);
    await f.locator('input[name=start_date]').fill(start); await f.locator('input[name=end_date]').fill(end); await f.locator('input[name=deductible]').fill('5000');
    if (reclass) await f.locator('input[name=reclass]').check();
    await f.locator('button').click(); await owner.locator('text=Försäkringen är registrerad').waitFor();
  };
  await addPolicy('Företagsförsäkring', 'Trygg Försäkring', '12000', pStart, pEnd, true);
  await addPolicy('Ansvarsförsäkring', 'Säker AB', '3000', day(330), day(-30), false);
  await owner.goto(FO + '/forsakringsskador');
  await owner.fill('input[name=description]', 'Vattenskada i lagret'); await owner.fill('input[name=insurer]', 'Trygg Försäkring');
  await owner.selectOption('select[name=kind]', 'other'); await owner.click('button:has-text("Anmäl skada")'); await owner.locator('text=Skadan är registrerad').waitFor();
  await owner.goto(FO + '/forsakringar');
  t = nb(await owner.locator('.ins-renewal').innerText()); assert(t.includes('AnsvarsförsäkringhosSäkerAB') && t.includes('om30dagar'), 'förnyelsepåminnelse: ' + t);
  assert(nb(await owner.locator('.ins-pending').innerText()) === '3000,00', 'att periodisera 3 av 12 månader');
  assert(nb(await owner.locator('.ins-row[data-kind="Företagsförsäkring"] .ins-claims').innerText()).includes('Vattenskadailagret'), 'skadeärendet kopplat');
  await owner.click('button:has-text("Periodisera premierna")'); await owner.locator('text=av premierna är kostnadsförda').waitFor();
  assert(nb(await owner.locator('.ins-row[data-kind="Företagsförsäkring"] .ins-recognized').innerText()) === '3000,00', 'kostnadsfört');
  await owner.goto(FO + '/verifikationer');
  await owner.locator('tr:has-text("Periodisering av försäkringspremier") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('6310') && t.includes('1790') && t.includes('3000,00'), 'periodisering 6310/1790: ' + t.slice(0, 600));
  await owner.goto(FO + '/forsakringar');
  const rf = owner.locator('.ins-row[data-kind="Ansvarsförsäkring"] form');
  await rf.locator('input[name=premium]').fill('3600'); await rf.locator('input[name=end_date]').fill(day(-395)); await rf.locator('button').click();
  await owner.locator('text=Försäkringen är förnyad').waitFor();
  assert(await owner.locator('.ins-renewal').count() === 0, 'påminnelsen försvinner efter förnyelse');
  assert(await owner.locator('.ins-row[data-kind="Ansvarsförsäkring"]').count() === 2, 'ny period');
  log('försäkringsöversikt: premie förs om till 1790 och periodiseras per månad, förnyelsepåminnelse, förnyelse med ny period, kopplade skadeärenden');

  // ================= Del 2: leverantörsabonnemang =================
  const AB = await newCompany('Licensbolaget AB', 559620000);
  if (Number(day(75).slice(0, 4)) < YEAR) await addFy(AB, YEAR - 1);
  for (const n of ['Molntjänst AB', 'Okänd SaaS AB']) {
    await owner.goto(AB + '/leverantorer'); await owner.fill('input[name=name]', n); await owner.click('button:has-text("Spara leverantör")'); await owner.waitForURL(/ok=/);
  }
  const sInv = async (sup, no, total, vat, d) => {
    await owner.goto(AB + '/leverantorsfakturor/ny');
    await owner.selectOption('select[name=supplier_id]', { label: sup });
    await owner.fill('input[name=invoice_number]', no); await owner.fill('input[name=invoice_date]', d); await owner.fill('input[name=due_date]', day(-25));
    await owner.fill('input[name=total]', total); await owner.locator('input[name=total]').blur(); await owner.fill('input[name=vat]', vat);
    await owner.fill('input[name=account_0]', '5420'); await owner.fill('input[name=amount_0]', String(Number(total) - Number(vat)));
    await owner.click('button:has-text("Registrera och bokför")'); await owner.waitForURL(/ok=/);
  };
  await sInv('Molntjänst AB', 'M-1', '1375', '275', day(5));
  for (const [i, d] of [[1, 5], [2, 40], [3, 75]]) await sInv('Okänd SaaS AB', 'O-' + i, '500', '100', day(d));
  const addSub = async (name, sup, cost, period, seats, used, renewal) => {
    await owner.goto(AB + '/leverantorer/abonnemang');
    const f = owner.locator('form.ss-add');
    await f.locator('input[name=name]').fill(name); if (sup) await f.locator('select[name=supplier_id]').selectOption({ label: sup });
    await f.locator('input[name=cost]').fill(cost); await f.locator('select[name=period_months]').selectOption(period);
    await f.locator('input[name=seats]').fill(seats); await f.locator('input[name=seats_used]').fill(used); await f.locator('input[name=renewal_date]').fill(renewal);
    await f.locator('button').click(); await owner.locator('text=Abonnemanget är registrerat').waitFor();
  };
  await addSub('Projektverktyg', 'Molntjänst AB', '1000', '1', '10', '7', day(-40));
  await addSub('Designlicens', '', '12000', '12', '2', '2', day(-20));
  await owner.goto(AB + '/leverantorer/abonnemang');
  assert(nb(await owner.locator('.ss-monthly').innerText()) === '2000,00' && nb(await owner.locator('.ss-unused').innerText()) === '300,00', 'kostnad per månad och oanvända licenser');
  t = nb(await owner.locator('.ss-notice').innerText()); assert(t.includes('Projektverktyg') && t.includes('10dagarkvar') && t.includes(day(-10)), 'uppsägningspåminnelse: ' + t);
  assert(await owner.locator('.ss-notice').count() === 1, 'bara en påminnelse (Designlicensens uppsägningstid har passerat)');
  t = nb(await owner.locator('.ss-row[data-name="Projektverktyg"] .ss-price').innerText()); assert(t.includes('1100,00') && t.includes('+10%'), 'prishöjning: ' + t);
  t = nb(await owner.locator('.ss-suggestions').innerText()); assert(t.includes('OkändSaaSAB:3månader') && !t.includes('Molntjänst'), 'förslag: ' + t);
  const seatsF = owner.locator('.ss-row[data-name="Projektverktyg"] form:has(input[name=seats])');
  await seatsF.locator('input[name=seats]').fill('7'); await seatsF.locator('button').click(); await owner.locator('text=Licenserna är uppdaterade').waitFor();
  assert(nb(await owner.locator('.ss-unused').innerText()) === '0,00', 'inga oanvända licenser efter nedskalning');
  const ends = (() => { const d = new Date(day(-20) + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString().slice(0, 10); })();
  await owner.locator('.ss-row[data-name="Designlicens"] button:has-text("Säg upp")').click(); await owner.locator('text=Abonnemanget är uppsagt och upphör ' + ends).waitFor();
  assert(nb(await owner.locator('.ss-row[data-name="Designlicens"] .ss-ends').innerText()).includes(ends), 'löper en period till när uppsägningstiden passerat');
  assert(nb(await owner.locator('.ss-monthly').innerText()) === '1000,00', 'uppsagt abonnemang räknas inte');
  log('leverantörsabonnemang: kostnad per månad, oanvända licenser, sista dag att säga upp, prishöjning på senaste fakturan, okända återkommande leverantörer, uppsägning efter passerad uppsägningstid');

  // ================= Del 3: IT-utrustning och inventarielista =================
  const IT = await newCompany('Datorparken AB', 559630000);
  for (const [fn, ln, pnr, start] of [['Anna', 'Andersson', '19' + orgnrFor('900101123'), `${YEAR - 2}-01-01`], ['Bo', 'Berg', '19' + orgnrFor('850202123'), `${YEAR - 3}-01-01`]]) {
    await owner.goto(IT + '/lon/anstallda');
    await owner.fill('input[name=first_name]', fn); await owner.fill('input[name=last_name]', ln);
    await owner.fill('input[name=personal_number]', pnr); await owner.fill('input[name=monthly_salary]', '40000'); await owner.fill('input[name=tax_table]', '32');
    await owner.fill('input[name=employment_start]', start);
    await owner.click('form:has(input[name=first_name]) button:has-text("Spara")'); await owner.waitForURL(/ok=/);
  }
  const addGear = async (kind, name, serial, holder, purchased, cost, warranty) => {
    await owner.goto(IT + '/it-utrustning');
    const f = owner.locator('form.it-add');
    await f.locator('select[name=kind]').selectOption(kind); await f.locator('input[name=name]').fill(name); await f.locator('input[name=serial]').fill(serial);
    if (holder) await f.locator('select[name=employee_id]').selectOption({ label: holder });
    if (purchased) await f.locator('input[name=purchased_on]').fill(purchased);
    await f.locator('input[name=cost]').fill(cost); if (warranty) await f.locator('input[name=warranty_until]').fill(warranty);
    await f.locator('button').click(); await owner.locator('text=Utrustningen är registrerad').waitFor();
  };
  await addGear('laptop', 'MacBook Pro 14', 'C02X1', 'Anna Andersson', `${YEAR - 4}-01-15`, '25000', day(-20));
  await addGear('phone', 'iPhone 15', 'F2LX9', 'Anna Andersson', day(100), '12000', '');
  await addGear('screen', 'Dell 27', 'CN-77', '', '', '3000', '');
  const it = (n) => owner.locator(`.it-row[data-name="${n}"]`);
  await it('Dell 27').locator('select[name=employee_id]').selectOption({ label: 'Bo Berg' }); await it('Dell 27').locator('button:has-text("Lämna ut")').click(); await owner.locator('text=Utrustningen är utlämnad').waitFor();
  await owner.goto(IT + '/it-utrustning');
  assert(nb(await it('MacBook Pro 14').innerText()).includes('dagsattbyta') && nb(await it('MacBook Pro 14').locator('.it-warranty').innerText()).includes('20dagar'), 'utbytesplan och garanti');
  assert(await it('iPhone 15').locator('.it-replace').count() === 0, 'ny telefon behöver inte bytas');
  t = nb(await owner.locator('.it-holders tr[data-name="Anna Andersson"]').innerText()); assert(t.includes('2st') && t.includes('37000,00'), 'per person: ' + t);
  assert(nb(await it('Dell 27').locator('.it-holder').innerText()).startsWith('BoBerg'), 'utlämnad till Bo');
  await owner.goto(IT + '/lon/uppsagning');
  const tf = owner.locator('form:has(button:has-text("Registrera uppsägning"))');
  await tf.locator('select[name=employee_id]').selectOption({ label: `Anna Andersson (anställd ${YEAR - 2}-01-01)` }); await tf.locator('select[name=initiated_by]').selectOption('employee');
  await tf.locator('button').click(); await owner.locator('text=Uppsägningen är registrerad').waitFor();
  await owner.goto(IT + '/lon/uppsagning');
  t = nb(await owner.locator('.tm-row[data-name="Anna Andersson"] .tm-equipment').innerText()); assert(t.includes('MacBookPro14(C02X1)') && t.includes('iPhone15'), 'återlämning vid uppsägningen: ' + t);
  await owner.goto(IT + '/it-utrustning');
  const ret = owner.locator('.it-return[data-name="Anna Andersson"]');
  assert((await ret.getAttribute('data-done')) === '0' && nb(await ret.innerText()).includes('MacBookPro14'), 'återlämningslista');
  await ret.locator('li:has-text("MacBook") button:has-text("Återlämnad")').click(); await owner.locator('text=MacBook Pro 14 är återlämnad').waitFor();
  await owner.goto(IT + '/it-utrustning');
  await owner.locator('.it-return[data-name="Anna Andersson"] li:has-text("iPhone") button:has-text("Saknas")').click(); await owner.locator('text=iPhone 15 är registrerad som förlorad').waitFor();
  await owner.goto(IT + '/it-utrustning');
  assert((await owner.locator('.it-return[data-name="Anna Andersson"]').getAttribute('data-done')) === '1', 'allt hanterat');
  assert((await it('MacBook Pro 14').getAttribute('data-status')) === 'in_stock' && (await it('iPhone 15').getAttribute('data-status')) === 'lost', 'status efter återlämning');
  log('IT-utrustning: inventarielista med innehavare, utbytesplan och garanti, utlämning, återlämningslista vid uppsägning, återlämnad och saknad utrustning');

  // ================= Del 4: sanktionsavgifter och böter =================
  const SA = await newCompany('Slarvigt AB', 559640000);
  await voucher(SA, 'Förseningsavgift Bolagsverket årsredovisning', [[6900, 5000], [1930, -5000]], day(3));
  await voucher(SA, 'Felparkeringsavgift Stockholms stad', [[5800, 500], [1930, -500]], day(3));
  await voucher(SA, 'Parkeringsavgift Q-Park', [[5800, 200], [1930, -200]], day(3));
  await voucher(SA, 'Robotdammsugare', [[5410, 3000], [1930, -3000]], day(3));
  const pen = async (kind, authority, amount, from) => {
    await owner.goto(SA + '/sanktionsavgifter');
    const f = owner.locator('form.pn-add');
    await f.locator('select[name=kind]').selectOption(kind); await f.locator('input[name=authority]').fill(authority); await f.locator('input[name=date]').fill(day(2));
    await f.locator('input[name=amount]').fill(amount); await f.locator('select[name=credit_account]').selectOption(from);
    await f.locator('button').click(); await owner.locator('text=(ej avdragsgill)').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await pen('tax_surcharge', 'Skatteverket', '10000', '1630'); assert(t.includes('10000,00kr') && t.includes('bokfördpå6992'), 'skattetillägg på 6992: ' + t);
  t = await pen('tax_interest', 'Skatteverket', '300', '1630'); assert(t.includes('bokfördpå8423'), 'kostnadsränta på 8423: ' + t);
  await owner.goto(SA + '/sanktionsavgifter');
  assert(nb(await owner.locator('.pn-total').innerText()) === '10300,00', 'ej avdragsgillt att lägga tillbaka');
  assert(await owner.locator('.pn-row').count() === 2, 'två misstänkta rader: ' + nb(await owner.locator('.pn-suspicious').innerText()));
  t = nb(await owner.locator('.pn-suspicious').innerText()); assert(t.includes('Förseningsavgift') && t.includes('Felparkeringsavgift') && !t.includes('Q-Park') && !t.includes('Robot'), 'rätt rader: ' + t);
  await owner.locator('.pn-row[data-account="6900"] button:has-text("För om till 6992")').click(); await owner.locator('text=är omfört till 6992').waitFor();
  await owner.goto(SA + '/sanktionsavgifter');
  assert(nb(await owner.locator('.pn-total').innerText()) === '15300,00', 'omförd avgift räknas med');
  await owner.locator('.pn-row[data-account="5800"] button:has-text("ignorera")').click(); await owner.locator('text=Raden är markerad som granskad').waitFor();
  await owner.goto(SA + '/sanktionsavgifter');
  assert(await owner.locator('.pn-warning').count() === 0 && await owner.locator('.pn-row').count() === 0, 'inga fler varningar');
  await owner.goto(SA + '/verifikationer');
  await owner.locator('tr:has-text("Omföring till ej avdragsgill kostnad") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('6992') && t.includes('6900') && t.includes('5000,00'), 'omföring 6992/6900: ' + t.slice(0, 600));
  log('sanktionsavgifter: skattetillägg på 6992, kostnadsränta på 8423, summa att lägga tillbaka i ruta 4.3c, varning för avgifter på avdragsgilla konton, omföring och granskning');

  // ================= Del 5: immateriella rättigheter =================
  const IP = await newCompany('Nordskog AB', 559650000);
  const addY = (d, y) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCFullYear(x.getUTCFullYear() + y); return iso(x); };
  const addRight = async (kind, name, f) => {
    await owner.goto(IP + '/immateriella-rattigheter');
    const fm = owner.locator('form.ip-add');
    await fm.locator('select[name=kind]').selectOption(kind); await fm.locator('input[name=name]').fill(name);
    if (f.no) await fm.locator('input[name=registration_no]').fill(f.no);
    if (f.registered) await fm.locator('input[name=registered_on]').fill(f.registered);
    if (f.renewal) await fm.locator('input[name=renewal_date]').fill(f.renewal);
    await fm.locator('button').click(); await owner.locator('text=Rättigheten är registrerad').waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  const tmRenewal = day(-100);
  t = await addRight('trademark', 'NORDSKOG', { no: '512345', registered: addY(tmRenewal, -10) }); assert(t.includes('förnyas' + tmRenewal), 'varumärket förnyas efter tio år: ' + t);
  await addRight('domain', 'nordskog.se', { renewal: day(-20) });
  await addRight('patent', 'Sågklinga', { no: 'SE 540001', renewal: day(-200) });
  await owner.goto(IP + '/immateriella-rattigheter');
  t = nb(await owner.locator('.ip-renewal[data-name="NORDSKOG"]').innerText()); assert(t.includes('om100dagar') && t.includes('kanförnyasfrån'), 'förnyelse av varumärket: ' + t);
  assert(await owner.locator('.ip-renewal[data-name="nordskog.se"]').count() === 1 && await owner.locator('.ip-renewal[data-name="Sågklinga"]').count() === 0, 'domänen påminns, patentet inte än');
  const cost = async (name, kind, amount, treatment = '') => {
    await owner.goto(IP + '/immateriella-rattigheter');
    const f = owner.locator(`.ip-row[data-name="${name}"] form:has(input[name=amount])`);
    await f.locator('select[name=kind]').selectOption(kind); await f.locator('input[name=amount]').fill(amount);
    if (treatment) await f.locator('select[name=treatment]').selectOption(treatment);
    await f.locator('button').click(); await owner.waitForURL(/(ok|error)=/);
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await cost('NORDSKOG', 'renewal', '2500'); assert(t.includes('kostnadsfördpå6900') && t.includes('Nästaförnyelse' + addY(tmRenewal, 10)), 'förnyelse kostnadsförs och flyttar fram datumet: ' + t);
  t = await cost('Sågklinga', 'acquisition', '150000'); assert(t.includes('aktiveradpå1030'), 'köpt patent aktiveras: ' + t);
  t = await cost('Sågklinga', 'legal', '8000'); assert(t.includes('kostnadsfördpå6550'), 'ombudskostnad på 6550: ' + t);
  t = await cost('nordskog.se', 'application', '300', 'capitalized'); assert(t.includes('Baraförvärvaderättigheter'), 'egna avgifter kan inte aktiveras: ' + t);
  t = await cost('nordskog.se', 'renewal', '200'); assert(t.includes('kostnadsfördpå6540') && t.includes('Nästaförnyelse' + addY(day(-20), 1)), 'domänen på 6540: ' + t);
  await owner.goto(IP + '/immateriella-rattigheter');
  assert(await owner.locator('.ip-renewal').count() === 0, 'inga förnyelser kvar');
  assert(nb(await owner.locator('.ip-row[data-name="Sågklinga"] .ip-capitalized').innerText()) === '150000,00' && nb(await owner.locator('.ip-row[data-name="Sågklinga"] .ip-expensed').innerText()) === '8000,00', 'aktiverat och kostnadsfört');
  await owner.goto(IP + '/anlaggningar');
  assert((await text(owner)).includes('Patent Sågklinga'), 'patentet finns i anläggningsregistret');
  await owner.goto(IP + '/immateriella-rattigheter');
  await owner.locator('.ip-row[data-name="Sågklinga"] button:has-text("Upphört")').click(); await owner.locator('text=Rättigheten är markerad som upphörd').waitFor();
  await owner.goto(IP + '/immateriella-rattigheter');
  assert((await owner.locator('.ip-row[data-name="Sågklinga"]').getAttribute('data-status')) === 'lapsed' && nb(await owner.locator('.ip-row[data-name="Sågklinga"]').innerText()).includes('Utrangeratillgången'), 'upphört patent ska utrangeras');
  log('immateriella rättigheter: varumärke med tioårig förnyelse, domän och patent, påminnelser, förnyelse kostnadsförs och flyttar fram datumet, köpt patent aktiveras i anläggningsregistret, egna avgifter kan inte aktiveras');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 36: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
