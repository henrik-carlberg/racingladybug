// E2E omgång 37: styrelsemöten, utbildning och behörigheter, fordonsregister, produktkalkyl, visselblåsarkanal
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

  // ================= Del 1: styrelsemöten och protokoll =================
  const BM = await newCompany('Styrelserummet AB', 559710000);
  for (const [name, pnr] of [['Anna Ordförande', '19' + orgnrFor('600101123')], ['Bertil Ledamot', '19' + orgnrFor('610202123')], ['Cecilia Ledamot', '19' + orgnrFor('620303123')]]) {
    await owner.goto(BM + '/lon/styrelsearvoden');
    const f = owner.locator('form:has(button:has-text("Registrera ledamot"))');
    await f.locator('input[name=name]').fill(name); await f.locator('input[name=id_number]').fill(pnr); await f.locator('input[name=agm_date]').fill(day(30));
    await f.locator('input[name=annual_fee]').fill('0'); await f.locator('select[name=mode]').selectOption('invoice');
    await f.locator('button').click(); await owner.locator('text=Ledamoten är registrerad').waitFor();
  }
  const meeting = async (kind) => {
    await owner.goto(BM + '/styrelsemoten');
    const f = owner.locator('form.bm-new');
    await f.locator('select[name=kind]').selectOption(kind); await f.locator('input[name=date]').fill(day(0)); await f.locator('input[name=place]').fill('Kontoret');
    await f.locator('button').click(); await owner.locator('text=Mötet är skapat').waitFor();
  };
  await meeting('board');
  const bm = () => owner.locator('.bm-meeting[data-kind="board"]');
  assert(nb(await bm().locator('.bm-quorum').innerText()).includes('3ledamöter–minst2'), 'beslutförhet');
  await bm().locator('select[name=template]').selectOption('investment'); await bm().locator('input[name=title]').fill('Ny CNC-maskin'); await bm().locator('button:has-text("Lägg till punkt")').click();
  await owner.locator('text=Punkten är tillagd').waitFor();
  await owner.goto(BM + '/styrelsemoten');
  t = nb(await bm().locator('.bm-items').innerText()); assert(t.indexOf('NyCNC-maskin') > 0 && t.indexOf('NyCNC-maskin') < t.indexOf('Mötetsavslutande'), 'punkten före avslutandet: ' + t);
  const inv = bm().locator('li:has-text("Ny CNC-maskin") form');
  await inv.locator('input[name=decision]').fill('Köp för 450 000 kr'); await inv.locator('input[name=owner]').fill('Bertil Ledamot'); await inv.locator('input[name=due_date]').fill(day(10));
  await inv.locator('button').click(); await owner.locator('text=Beslutet är sparat').waitFor();
  await owner.goto(BM + '/styrelsemoten');
  const hold = async (present) => {
    const f = bm().locator('form.bm-hold');
    await f.locator('input[name=present]').fill(present); await f.locator('input[name=chair]').fill('Anna Ordförande'); await f.locator('input[name=secretary]').fill('Bertil Ledamot');
    await f.locator('button').click(); await owner.waitForURL(/(ok|error)=/);
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await hold('Anna Ordförande'); assert(t.includes('intebeslutför:1av3') && t.includes('minst2'), 'inte beslutför: ' + t);
  await owner.goto(BM + '/styrelsemoten');
  t = await hold('Anna Ordförande, Bertil Ledamot'); assert(t.includes('Närvaronärregistrerad'), 'närvaro: ' + t);
  await owner.goto(BM + '/styrelsemoten');
  assert(nb(await bm().locator('.bm-quorum').innerText()).includes('2av3'), 'närvarande ledamöter');
  t = nb(await owner.locator('.bm-decision').innerText()); assert(t.includes('Köpför450000kr') && t.includes('BertilLedamot') && (await owner.locator('.bm-decision').getAttribute('data-overdue')) === '1', 'beslut att följa upp: ' + t);
  const sf = bm().locator('form.bm-send');
  await sf.locator('input[name=signer_email_0]').fill('anna@example.com'); await sf.locator('input[name=signer_name_1]').fill('Cecilia Ledamot'); await sf.locator('input[name=signer_email_1]').fill('cecilia@example.com');
  await sf.locator('button').click(); await owner.locator('text=Protokollet är skickat för justering').waitFor();
  await owner.goto(BM + '/styrelsemoten');
  assert((await bm().getAttribute('data-status')) === 'sent' && nb(await bm().locator('.bm-status').innerText()).includes('väntarpåjustering'), 'protokollet väntar på justering');
  assert(await bm().locator('form').count() === 0, 'inga ändringar efter att protokollet skickats');
  await bm().locator('a:has-text("protokollet")').click(); await owner.waitForURL(/dokument\/\d+/);
  t = nb(await text(owner)); assert(t.includes('Köpför450000kr') && t.includes('AnnaOrdförande') && t.includes('CeciliaLedamot'), 'protokollets innehåll: ' + t.slice(0, 600));
  await meeting('agm');
  const agm = owner.locator('.bm-meeting[data-kind="agm"]');
  t = nb(await agm.locator('.bm-items').innerText()); assert(t.includes('Fastställandeavresultaträkningochbalansräkning') && t.includes('Dispositionavbolagetsvinst') && t.includes('Ansvarsfrihet'), 'årsstämmans dagordning: ' + t);
  assert(await agm.locator('.bm-missing').count() === 0, 'inga obligatoriska punkter saknas');
  await owner.goto(BM + '/styrelsemoten');
  await owner.locator('.bm-decision button:has-text("Genomfört")').click(); await owner.locator('text=Beslutet är genomfört').waitFor();
  await owner.goto(BM + '/styrelsemoten');
  assert(await owner.locator('.bm-decision').count() === 0, 'inga beslut kvar att följa upp');
  log('styrelsemöten: standarddagordning, egna punkter, beslut med ansvarig och sista dag, beslutförhet, uppföljning av beslut, protokoll för e-signering, årsstämmans obligatoriska punkter');

  // ================= Del 2: utbildning och behörigheter =================
  const UT = await newCompany('Lagerkompetens AB', 559720000);
  for (const [fn, ln, pnr] of [['Kalle', 'Kran', '19' + orgnrFor('800101123')], ['Lisa', 'Lager', '19' + orgnrFor('810202123')]]) {
    await owner.goto(UT + '/lon/anstallda');
    await owner.fill('input[name=first_name]', fn); await owner.fill('input[name=last_name]', ln);
    await owner.fill('input[name=personal_number]', pnr); await owner.fill('input[name=monthly_salary]', '35000'); await owner.fill('input[name=tax_table]', '32');
    await owner.fill('input[name=employment_start]', `${YEAR - 6}-01-01`);
    await owner.click('form:has(input[name=first_name]) button:has-text("Spara")'); await owner.waitForURL(/ok=/);
  }
  const addMo = (d, m) => { const x = new Date(`${d}T00:00:00Z`); const dd = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + m); const max = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(dd, max)); return x.toISOString().slice(0, 10); };
  const train = async (who, f) => {
    await owner.goto(UT + '/lon/utbildning');
    const fm = owner.locator('form.tr-add');
    await fm.locator('select[name=employee_id]').selectOption({ label: who }); await fm.locator('select[name=kind]').selectOption(f.kind ?? 'certificate');
    await fm.locator('input[name=title]').fill(f.title); await fm.locator('input[name=completed_on]').fill(f.done);
    if (f.months) await fm.locator('input[name=valid_months]').fill(f.months); if (f.until) await fm.locator('input[name=valid_until]').fill(f.until);
    if (f.cost) await fm.locator('input[name=cost]').fill(f.cost); if (f.private) await fm.locator('select[name=work_related]').selectOption('no');
    if (f.book) await fm.locator('input[name=book]').check();
    await fm.locator('button').click(); await owner.locator('text=Utbildningen är registrerad').waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  const truckDone = day(1800);
  t = await train('Kalle Kran', { title: 'Truckkort', done: truckDone, months: '60' }); assert(t.includes('giltigtill' + addMo(truckDone, 60)), 'giltighet från månader: ' + t);
  await train('Lisa Lager', { title: 'Heta arbeten', done: day(2000), until: day(100) });
  await owner.goto(UT + '/lon/utbildning');
  assert((await owner.locator('.tr-alert[data-name="Kalle Kran"]').getAttribute('data-status')) === 'expiring', 'truckkortet går snart ut');
  assert((await owner.locator('.tr-alert[data-name="Lisa Lager"]').getAttribute('data-status')) === 'expired', 'heta arbeten har gått ut');
  t = await train('Lisa Lager', { title: 'Heta arbeten', done: day(5), months: '60', cost: '3500', book: true }); assert(t.includes('bokfördpå7610'), 'kostnaden bokförd: ' + t);
  t = await train('Kalle Kran', { kind: 'course', title: 'Spanska för nybörjare', done: day(5), cost: '2000', private: true, book: true }); assert(t.includes('2000,00krskatasuppsomskattepliktigförmån'), 'förmån: ' + t);
  await owner.goto(UT + '/lon/utbildning');
  assert(await owner.locator('.tr-alert[data-name="Lisa Lager"]').count() === 0 && (await owner.locator('.tr-cert[data-name="Lisa Lager"]').getAttribute('data-status')) === 'valid', 'förnyad behörighet ersätter den gamla');
  assert(nb(await owner.locator('.tr-costs tr[data-name="Kalle Kran"] .tr-benefit').innerText()) === '2000,00' && nb(await owner.locator('.tr-costs tr[data-name="Lisa Lager"] .tr-cost').innerText()) === '3500,00' && nb(await owner.locator('.tr-costs tr[data-name="Lisa Lager"] .tr-benefit').innerText()) === '0,00', 'kostnad och förmån per anställd');
  await owner.goto(UT + '/verifikationer');
  await owner.locator('tr:has-text("Utbildning Heta arbeten") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('7610') && t.includes('3500,00'), 'verifikation 7610: ' + t.slice(0, 500));
  log('utbildning och behörigheter: giltighet i månader eller datum, påminnelse före utgång, förnyelse ersätter, kostnad på 7610, ej arbetsrelaterad utbildning som förmån');

  // ================= Del 3: fordonsregister =================
  const FR = await newCompany('Servicebilen AB', 559730000);
  await owner.goto(FR + '/fordon');
  const vf = owner.locator('form.vr-add');
  await vf.locator('input[name=reg_no]').fill('frd 123'); await vf.locator('input[name=model]').fill('Volvo V60'); await vf.locator('input[name=model_year]').fill(String(YEAR - 3));
  await vf.locator('input[name=inspection_due]').fill(day(-20)); await vf.locator('input[name=insurance_until]').fill(day(-200)); await vf.locator('input[name=service_due_km]').fill('15000');
  await vf.locator('button').click(); await owner.locator('text=Fordonet är registrerat').waitFor();
  await owner.goto(FR + '/korjournal');
  await owner.selectOption('select[name=vehicle_id]', { label: 'FRD123' });
  await owner.fill('input[name=date]', day(3));
  for (const [k, v] of [['odo_start', '14000'], ['odo_end', '14500'], ['purpose', 'Servicebesök'], ['from_place', 'Verkstan'], ['to_place', 'Kunden']]) await owner.fill(`input[name=${k}]`, v);
  await owner.click('button:has-text("Spara resa")'); await owner.locator('text=Resan är sparad').waitFor();
  await owner.goto(FR + '/fordon');
  const car = owner.locator('.vr-vehicle[data-reg="FRD123"]');
  t = nb(await car.innerText()); assert(t.includes('VolvoV60'), 'modell: ' + t);
  assert(nb(await car.locator('.vr-reminder[data-kind="inspection"]').innerText()).includes('om20dagar'), 'besiktning inom 30 dagar');
  assert(nb(await car.locator('.vr-reminder[data-kind="service_km"]').innerText()).includes('500kmkvar'), 'service inom 1000 km');
  assert(await car.locator('.vr-reminder[data-kind="insurance"]').count() === 0 && nb(await car.locator('.vr-odo').innerText()) === '14500', 'försäkringen är inte aktuell och mätaren från körjournalen');
  const ev = async (kind, amount, vat, f = {}) => {
    await owner.goto(FR + '/fordon');
    const fm = owner.locator('.vr-vehicle[data-reg="FRD123"] form.vr-event');
    await fm.locator('select[name=kind]').selectOption(kind); await fm.locator('input[name=date]').fill(day(1)); await fm.locator('input[name=amount]').fill(amount); await fm.locator('input[name=vat]').fill(vat);
    if (f.odo) await fm.locator('input[name=odometer]').fill(f.odo); if (f.next) await fm.locator('input[name=next_date]').fill(f.next); if (f.nextKm) await fm.locator('input[name=next_km]').fill(f.nextKm);
    await fm.locator('button').click(); await owner.locator('text=Händelsen är registrerad').waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await ev('fuel', '800', '200'); assert(t.includes('1000,00krärbokförtpå5611'), 'drivmedel med moms: ' + t);
  t = await ev('tax', '1200', '300'); assert(t.includes('1200,00krärbokförtpå5612'), 'fordonsskatt utan moms: ' + t);
  await ev('inspection', '500', '125', { next: day(-385) });
  t = await ev('service', '3000', '750', { odo: '14600', nextKm: '30000' }); assert(t.includes('3750,00krärbokförtpå5613'), 'service: ' + t);
  await owner.goto(FR + '/fordon');
  assert(await car.locator('.vr-reminder').count() === 0, 'påminnelserna är åtgärdade: ' + nb(await car.innerText()));
  assert(nb(await car.locator('.vr-costs').innerText()) === '5500,00' && nb(await car.locator('.vr-per-mil').innerText()) === '110,00' && nb(await car.locator('.vr-odo').innerText()) === '14600', 'kostnad per mil: ' + nb(await car.locator('.vr-figures').innerText()));
  await owner.goto(FR + '/verifikationer');
  await owner.locator('tr:has-text("Service FRD123") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('5613') && t.includes('2641') && t.includes('750,00') && t.includes('3750,00'), 'verifikation service: ' + t.slice(0, 500));
  log('fordonsregister: fordon med besiktning, försäkring och service, mätarställning från körjournalen, påminnelser, kostnader på 561x med moms, nästa besiktning och service, kostnad per mil');

  // ================= Del 4: produktkalkyl =================
  const PK = await newCompany('Snickeriet AB', 559740000);
  await owner.goto(PK + '/leverantorer'); await owner.fill('input[name=name]', 'Trävaror AB'); await owner.click('button:has-text("Spara leverantör")'); await owner.waitForURL(/ok=/);
  await owner.goto(PK + '/moduler');
  await owner.locator('.card:has(h2:text-is("Inköp, lager och logistik")) button:has-text("Aktivera")').click(); await owner.waitForURL(/ok=/);
  for (const [sku, name, pp, sp] of [['BORD', 'Matbord', '0', '5000'], ['EK-1', 'Ekskiva', '1500', '0'], ['BEN-1', 'Bordsben', '100', '0']]) {
    await owner.goto(PK + '/m/lager/artiklar');
    await owner.fill('input[name=sku]', sku); await owner.fill('input[name=name]', name); await owner.fill('input[name=purchase_price]', pp); await owner.fill('input[name=sales_price]', sp);
    await owner.click('button:has-text("Lägg upp artikel")'); await owner.locator('text=Artikeln är upplagd').waitFor();
  }
  await owner.goto(PK + '/produktkalkyl');
  const pf = owner.locator('form.pc-add');
  await pf.locator('input[name=name]').fill('Matbord ek'); await pf.locator('select[name=product_id]').selectOption({ label: 'BORD Matbord' });
  await pf.locator('select[name=component_0]').selectOption({ label: 'EK-1 Ekskiva' }); await pf.locator('input[name=qty_0]').fill('1');
  await pf.locator('select[name=component_1]').selectOption({ label: 'BEN-1 Bordsben' }); await pf.locator('input[name=qty_1]').fill('4');
  await pf.locator('input[name=desc_2]').fill('Lack och skruv'); await pf.locator('input[name=qty_2]').fill('1'); await pf.locator('input[name=cost_2]').fill('100');
  for (const [k, v] of [['labour_minutes', '120'], ['labour_rate', '500'], ['mo_pct', '10'], ['to_pct', '50'], ['affo_pct', '10'], ['target_margin', '15']]) await pf.locator(`input[name=${k}]`).fill(v);
  await pf.locator('button').click(); await owner.locator('text=Kalkylen är sparad').waitFor();
  t = nb(await owner.locator('.flash').first().innerText()); assert(t.includes('självkostnad4070,00kr') && t.includes('marginal18,6%'), 'kalkyl: ' + t);
  const pc = owner.locator('.pc-row[data-name="Matbord ek"]');
  assert(nb(await pc.locator('.pc-tb').innerText()).startsWith('2000,0040%') && await owner.locator('.pc-warning').count() === 0, 'täckningsbidrag och ingen varning: ' + nb(await pc.innerText()));
  await owner.goto(PK + '/m/lager/inkop');
  await owner.selectOption('select[name=supplier_id]', { label: 'Trävaror AB' });
  await owner.selectOption('select[name=product_0]', await owner.locator('select[name=product_0] option:has-text("EK-1 ")').first().getAttribute('value'));
  await owner.fill('input[name=qty_0]', '10'); await owner.fill('input[name=price_0]', '2000');
  await owner.click('button:text-is("Skapa inköpsorder")'); await owner.locator('text=Inköpsordern är skapad').waitFor();
  await owner.click('button:has-text("Markera som skickad")'); await owner.locator('text=markerad som skickad').waitFor();
  await owner.click('button:has-text("Registrera inleverans")'); await owner.locator('text=Inleveransen är registrerad').waitFor();
  await owner.goto(PK + '/produktkalkyl');
  t = nb(await owner.locator('.pc-warning[data-name="Matbord ek"]').innerText());
  assert(t.includes('ökat14,9%') && t.includes('Marginalenär6,5%') && t.includes('föreslagetpris5500,00kr'), 'varning vid prishöjning: ' + t);
  assert(nb(await pc.locator('.pc-self').innerText()) === '4675,00', 'självkostnad med nytt inköpspris');
  await pc.locator('button:has-text("Använd")').click(); await owner.locator('text=Nytt pris 5').waitFor();
  await owner.goto(PK + '/produktkalkyl');
  assert(await owner.locator('.pc-warning').count() === 0 && nb(await pc.locator('.pc-price').innerText()) === '5500,00' && nb(await pc.locator('.pc-margin').innerText()) === '15%', 'nytt pris ger målmarginalen: ' + nb(await pc.innerText()));
  await owner.goto(PK + '/m/lager/artiklar');
  assert(nb(await owner.locator('tr:has-text("Matbord")').first().innerText()).includes('5500,00'), 'artikelns försäljningspris är uppdaterat');
  log('produktkalkyl: påläggskalkyl med MO, TO och AFFO, täckningsbidrag och marginal, inköpspris från lagret, varning när kostnaden stiger, prisförslag som uppdaterar artikeln');

  // ================= Del 5: visselblåsarkanal =================
  const VB = await newCompany('Rapportbolaget AB', 559750000);
  await owner.goto(VB + '/visselblasning');
  await owner.click('button:has-text("Öppna kanalen")'); await owner.locator('text=Visselblåsarkanalen är öppen').waitFor();
  const wbLink = (await owner.locator('.wb-link code').innerText()).trim();
  assert(/\/visselblasning\/[A-Za-z0-9_-]{20,}$/.test(wbLink), 'publik länk: ' + wbLink);
  const wbPath = wbLink.replace(/^https?:\/\/[^/]+/, '');
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(BASE + wbPath);
  await anon.selectOption('select[name=category]', 'accounting');
  await anon.fill('textarea[name=body]', 'Ekonomichefen bokför privata resor som tjänsteresor sedan i våras.');
  await anon.click('button:has-text("Skicka rapport")');
  const caseCode = (await anon.locator('.wb-code').innerText()).trim();
  assert(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(caseCode), 'ärendekod: ' + caseCode);
  assert(!anon.url().includes(caseCode.slice(0, 4) + '-'), 'koden finns inte i adressen');
  await owner.goto(VB + '/visselblasning');
  assert(nb(await owner.locator('.wb-restricted').innerText()).startsWith('1öppna') && !(await text(owner)).includes('Ekonomichefen'), 'ägaren som inte är handläggare kan inte läsa rapporten');
  await owner.locator('select[name=user_id]').selectOption({ index: 0 }); await owner.click('button:has-text("Utse handläggare")'); await owner.locator('text=Handläggaren är tillagd').waitFor();
  await owner.goto(VB + '/visselblasning');
  const rep = owner.locator('.wb-report').first();
  assert(nb(await rep.locator('.wb-body').innerText()).includes('privataresor') && (await rep.getAttribute('data-ack-overdue')) === '0' && nb(await rep.innerText()).includes('Bekräftasenast'), 'handläggaren ser rapporten och fristen');
  await rep.locator('button:has-text("Bekräfta mottagandet")').click(); await owner.locator('text=Mottagandet är bekräftat').waitFor();
  await anon.goto(BASE + wbPath + '/arende');
  await anon.fill('input[name=code]', 'AAAA-BBBB-CCCC-DDDD'); await anon.click('button:has-text("Visa ärendet")');
  await anon.locator('text=Hittar inget ärende med den koden').waitFor();
  await anon.goto(BASE + wbPath + '/arende');
  await anon.fill('input[name=code]', caseCode.toLowerCase()); await anon.click('button:has-text("Visa ärendet")');
  await anon.locator('.wb-thread').waitFor();
  assert(nb(await anon.locator('.wb-messages').innerText()).includes('Vihartagitemotdinrapport'), 'bekräftelsen syns för rapportören');
  await anon.fill('textarea[name=reply]', 'Det gäller resorna till Spanien i maj.'); await anon.click('button:has-text("Skicka")');
  await anon.locator('.wb-messages li[data-sender="reporter"]').waitFor();
  await owner.goto(VB + '/visselblasning');
  assert(nb(await rep.locator('.wb-messages').innerText()).includes('resornatillSpanien'), 'handläggaren ser svaret');
  await rep.locator('textarea[name=body]').fill('Vi har startat en utredning och tagit in en extern revisor.'); await rep.locator('input[name=feedback]').check();
  await rep.locator('form.wb-handler-reply button').click(); await owner.locator('text=Meddelandet är skickat').waitFor();
  await owner.goto(VB + '/visselblasning');
  assert(nb(await rep.innerText()).includes('Återkoppling' + day(0)), 'återkopplingen är registrerad');
  await rep.locator('input[name=outcome]').fill('Resorna har återbetalats och rutinerna för reseräkningar är skärpta.'); await rep.locator('button:has-text("Avsluta ärendet")').click(); await owner.locator('text=Ärendet är avslutat').waitFor();
  await anon.goto(BASE + wbPath + '/arende');
  await anon.fill('input[name=code]', caseCode); await anon.click('button:has-text("Visa ärendet")');
  await anon.locator('.wb-thread[data-status="closed"]').waitFor();
  assert(await anon.locator('form.wb-reply').count() === 0 && nb(await anon.locator('.wb-messages').innerText()).includes('externrevisor'), 'avslutat ärende utan svarsformulär');
  await owner.goto(VB + '/visselblasning');
  await owner.locator('.wb-handlers button:has-text("Ta bort")').click(); await owner.locator('text=Handläggaren är borttagen').waitFor();
  await owner.goto(VB + '/visselblasning');
  assert(await owner.locator('.wb-report').count() === 0 && !(await text(owner)).includes('Spanien'), 'utan handläggarroll syns inga rapporter');
  await owner.click('button:has-text("Stäng kanalen")'); await owner.locator('text=Visselblåsarkanalen är stängd').waitFor();
  const closedRes = await anon.goto(BASE + wbPath);
  assert(closedRes.status() === 404, 'stängd kanal ger 404');
  await anon.context().close();
  log('visselblåsarkanal: publik länk, anonym rapport med ärendekod, åtkomst bara för handläggare, bekräftelse och återkoppling inom fristerna, dialog med rapportören, avslut och stängd kanal');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 37: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
