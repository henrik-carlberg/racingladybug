// End-to-end, omgång 14: bostadsrättsföreningar, kreditkontroll, leasing, provisioner, utlandsbetalningar.
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

const mailServer = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"m1"}'); }); }).listen(3303);

// Kreditupplysningstjänst
const crypto = require('node:crypto');
const cr = { status: 'active', remarks: 0, score: 82, monitors: {} };
const creditServer = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const send = (c, j) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.headers.authorization !== 'Bearer credit-key') return send(401, {});
    if (req.method === 'POST' && req.url === '/reports') { const j = JSON.parse(b); return send(200, { id: 'R' + Date.now(), orgnr: j.orgnr, name: 'Risk AB', score: cr.score, rating: cr.score >= 70 ? 'AA' : 'B', payment_remarks: cr.remarks, status: cr.status, recommended_limit: 5000000 }); }
    if (req.method === 'POST' && req.url === '/monitors') { const id = 'M' + (Object.keys(cr.monitors).length + 1); cr.monitors[id] = JSON.parse(b); return send(201, { id }); }
    if (req.method === 'DELETE' && req.url.startsWith('/monitors/')) { delete cr.monitors[req.url.split('/')[2]]; return send(200, {}); }
    send(404, {});
  });
}).listen(3318);

(async () => {
  const browser = await chromium.launch();
  const owner = await login(browser, 'agare@example.com', 'hemligtlosen1');
  const B = `${BASE}/c/1`;
  let t;
  const nb = (s) => s.replace(/[\s  ]/g, '');
  const next = (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + 1, 1); return d.toISOString().slice(0, 7); })();

  // ================= Del 1: bostadsrättsföreningar =================
  await owner.goto(B + '/brf');
  await owner.click('button.enable-brf');
  await owner.locator('text=Bostadsrättsföreningsläget är på').waitFor();
  for (const [n, area, share, name] of [['1001', '60', '0,3', 'Anna Brf'], ['1002', '90', '0,45', 'Bo Brf'], ['1003', '50', '0,25', 'Cia Brf']]) {
    await owner.goto(B + '/brf');
    const f = owner.locator('form:has(button:has-text("Lägg till lägenhet"))');
    await f.locator('input[name=number]').fill(n); await f.locator('input[name=skv_number]').fill(n);
    await f.locator('input[name=area]').fill(area); await f.locator('input[name=share]').fill(share);
    await f.locator('input[name=owner]').fill(name); await f.locator('input[name=insats]').fill('50000'); await f.locator('input[name=granted_on]').fill('2020-01-01');
    await f.locator('button').click();
    await owner.locator('text=Lägenheten är införd i förteckningen').waitFor();
  }
  assert((await owner.locator('.apt-count').innerText()) === '3' && nb(await owner.locator('.share-sum').innerText()) === '1', 'förteckning');
  log('lägenhetsförteckning med Skatteverkets nummer, yta, andelstal, insats och bostadsrättshavare');

  await owner.fill('input[name=fee_budget]', '360000');
  await owner.click('form:has(input[name=fee_budget]) button:has-text("Spara")');
  await owner.locator('text=Årets avgifter är sparade').waitFor();
  await owner.goto(B + '/brf');
  const fee = async (n) => nb(await owner.locator(`tr.apartment:has(td:text-is("${n}")) .apt-fee`).innerText());
  assert((await fee('1001')) === '9000,00' && (await fee('1002')) === '13500,00' && (await fee('1003')) === '7500,00', 'avgift per andelstal');
  await owner.fill('form:has(button:has-text("Skapa avgiftsavier")) input[name=month]', next);
  await owner.click('button:has-text("Skapa avgiftsavier")');
  await owner.locator('text=3 avgiftsavier är skapade och bokförda').waitFor();
  assert(nb(await owner.locator(`tr.fee-period:has-text("${next}") td`).nth(2).innerText()) === '30000,00' && (await owner.locator(`tr.fee-period:has-text("${next}") td`).nth(1).innerText()) === '3', 'avierna');
  await owner.goto(B + '/brf');
  await owner.fill('form:has(button:has-text("Skapa avgiftsavier")) input[name=month]', next);
  await owner.click('button:has-text("Skapa avgiftsavier")');
  await owner.locator('.flash.error, .flash:has-text("inga avgifter att avisera")').first().waitFor();
  log('årsavgiften fördelas efter andelstal och aviseras per lägenhet med OCR – en gång per period');

  await owner.goto(B + '/brf');
  const row1 = owner.locator('tr.apartment:has(td:text-is("1001"))');
  await row1.locator('summary').click();
  await row1.locator('input[name=buyer]').fill('Dan Köpare');
  await row1.locator('input[name=price]').fill('2500000');
  await row1.locator('button:has-text("Registrera överlåtelse")').click();
  await owner.locator('text=Överlåtelsen är registrerad').waitFor();
  t = await text(owner);
  assert(/1001 1001 60 0,3 Dan Köpare/.test(t) && /lgh 1001 från Anna Brf till Dan Köpare för 2[\s ]500[\s ]000,00/.test(t), 'överlåtelse: ' + t.slice(0, 2500));
  await owner.goto(B + '/fakturor');
  assert((await text(owner)).includes('Dan Köpare'), 'överlåtelseavgift fakturerad');
  await owner.goto(B + '/brf');
  const row2 = owner.locator('tr.apartment:has(td:text-is("1002"))');
  await row2.locator('summary').click();
  await row2.locator('input[name=lender]').fill('Swedbank');
  await row2.locator('button:has-text("Notera pantsättning")').click();
  await owner.locator('text=Pantsättningen är noterad').waitFor();
  assert((await owner.locator('tr.apartment:has(td:text-is("1002")) .pledge').count()) === 1, 'pant');
  const reg = await (await owner.context().request.get(B + '/brf/forteckning')).text();
  assert(reg.includes('Lägenhetsförteckning') && reg.includes('Dan Köpare') && reg.includes('Swedbank'), 'förteckning för utskrift');
  await owner.locator('tr.apartment:has(td:text-is("1002")) .pledge button').click();
  await owner.locator('text=Pantsättningen är avregistrerad').waitFor();
  log('överlåtelse och pantsättning förs in i förteckningen och avgifterna (högst 2,5 % resp. 1 % av prisbasbeloppet) faktureras');

  await owner.goto(B + '/brf');
  await owner.fill('form:has(input[name=item]) input[name=item]', 'Takomläggning');
  await owner.fill('form:has(input[name=item]) input[name=amount]', '800000');
  await owner.click('form:has(input[name=item]) button:has-text("Lägg till")');
  await owner.locator('text=Åtgärden är införd i underhållsplanen').waitFor();
  await owner.fill('form:has(select[name=kind]) input[name=amount]', '50000');
  await owner.click('form:has(select[name=kind]) button:has-text("Bokför")');
  await owner.locator('text=Avsättningen till fonden är bokförd').waitFor();
  assert(nb(await owner.locator('.fund-balance').innerText()) === '50000,00', 'fond');
  await owner.goto(B + '/brf');
  await owner.selectOption('select[name=kind]', 'use');
  await owner.fill('form:has(select[name=kind]) input[name=amount]', '90000');
  await owner.click('form:has(select[name=kind]) button:has-text("Bokför")');
  await owner.locator('.flash.error, .flash:has-text("Fonden räcker inte")').first().waitFor();
  t = await text(owner);
  assert(t.includes('Årsavgift per kvm upplåten med bostadsrätt') && t.includes('Räntekänslighet') && t.includes('Energikostnad per kvm'), 'nyckeltal: ' + t.slice(-1500));
  log('underhållsplan, fond för yttre underhåll och nyckeltalen enligt BFNAR 2023:1');

  await owner.goto(B + '/brf');
  await owner.click('button:has-text("Stäng av bostadsrättsföreningsläget")');
  await owner.locator('text=Bostadsrättsföreningsläget är av').waitFor();

  // ================= Del 2: kreditkontroll och kundrisk =================
  await owner.goto(B + '/kunder');
  await owner.fill('input[name=name]', 'Risk AB');
  await owner.fill('input[name=orgnr]', '556677-8899');
  await owner.click('form button:has-text("Spara")');
  await owner.locator('text=Kunden är sparad').waitFor();
  await owner.goto(B + '/kundrisk');
  await owner.locator('tr.credit-row:has-text("Risk AB") button:has-text("Ta upplysning")').click();
  await owner.locator('text=Kreditupplysningen är hämtad: Låg risk – föreslagen kreditgräns 50').waitFor();
  const crow = owner.locator('tr.credit-row:has-text("Risk AB")');
  assert((await crow.locator('.risk').innerText()) === 'Låg risk' && (await crow.innerText()).includes('AA'), 'upplysning');
  await crow.locator('input[name=credit_limit]').fill('10000');
  await crow.locator('select[name=credit_policy]').selectOption('block');
  await crow.locator('button:has-text("Spara")').click();
  await owner.locator('text=Kreditgränsen är sparad').waitFor();
  log('kreditupplysning på organisationsnummer ger riskklass och förslag till kreditgräns');

  await owner.goto(B + '/fakturor/ny');
  await owner.selectOption('select[name=customer_id]', { label: 'Risk AB' });
  const rr = owner.locator('tbody tr').first();
  await rr.locator('td:nth-child(1) input').fill('Konsulttjänst'); await rr.locator('td:nth-child(2) input').fill('1');
  await rr.locator('td:nth-child(3) input').fill('st'); await rr.locator('td:nth-child(4) input').fill('10000');
  await owner.click('button:has-text("Spara utkast")');
  await owner.waitForURL(/fakturor\/\d+\?ok/);
  const invUrl = owner.url().split('?')[0];
  assert((await owner.locator('.credit-warning').innerText()).includes('Fakturan kan inte bokföras'), 'varning på utkastet');
  await owner.click('button:has-text("Bokför faktura")');
  await owner.locator('.flash.error, .flash:has-text("Kreditkontroll")').first().waitFor();
  assert((await text(owner)).includes('kreditgränsen 10 000 kr överskrids'), 'stoppad');
  await owner.goto(B + '/kundrisk');
  await owner.locator('tr.credit-row:has-text("Risk AB") select[name=credit_policy]').selectOption('warn');
  await owner.locator('tr.credit-row:has-text("Risk AB") button:has-text("Spara")').click();
  await owner.locator('text=Kreditgränsen är sparad').waitFor();
  await owner.goto(invUrl);
  assert((await owner.locator('.credit-warning').innerText()).includes('Kreditvarning'), 'varning');
  await owner.click('button:has-text("Bokför faktura")');
  await owner.locator('text=klar att skicka').first().waitFor();
  await owner.goto(B + '/kundrisk');
  assert(nb(await owner.locator('tr.credit-row:has-text("Risk AB") .util').innerText()) === '125%avgränsen', 'utnyttjande');
  t = await text(owner);
  assert(t.includes('Faktura till Risk AB stoppad'), 'händelse om stoppad faktura');
  log('kreditgräns per kund: fakturan stoppas eller varnar vid bokföringen och utnyttjandet visas');

  await owner.locator('tr.credit-row:has-text("Risk AB") button:has-text("Bevaka")').click();
  await owner.locator('text=Kunden bevakas').waitFor();
  cr.status = 'bankruptcy';
  const hook = JSON.stringify({ monitor_id: 'M1', event: 'bankruptcy', orgnr: '556677-8899' });
  const bad = await owner.context().request.post(BASE + '/api/credit/webhook', { data: hook, headers: { 'content-type': 'application/json', 'x-credit-signature': 'sha256=00' } });
  assert(bad.status() === 401, 'osignerad webhook nekas');
  const sig = crypto.createHmac('sha256', 'creditsecret').update(hook).digest('hex');
  const ok = await owner.context().request.post(BASE + '/api/credit/webhook', { data: hook, headers: { 'content-type': 'application/json', 'x-credit-signature': `sha256=${sig}` } });
  assert(ok.status() === 200 && (await ok.json()).customers === 1, 'webhook');
  await owner.goto(B + '/kundrisk');
  t = await text(owner);
  assert((await owner.locator('tr.credit-row:has-text("Risk AB") .risk').innerText()) === 'Stoppa kredit' && t.includes('status bankruptcy hos kreditupplysningen') && t.includes('Låg risk → Stoppa kredit'), 'bevakning: ' + t.slice(-1500));
  await owner.locator('tr.credit-row:has-text("Risk AB") button:has-text("Sluta bevaka")').click();
  await owner.locator('text=Bevakningen är avslutad').waitFor();
  log('bevakning: konkurs hos kunden hämtas om från upplysningstjänsten och ger riskklass Stoppa kredit');

  // ================= Del 3: leasing =================
  const addLease = async (f) => {
    await owner.goto(B + '/leasing');
    const form = owner.locator('form:has(button:has-text("Lägg upp avtalet"))');
    await form.locator('input[name=name]').fill(f.name); await form.locator('select[name=kind]').selectOption(f.kind);
    await form.locator('input[name=start_date]').fill(f.start); await form.locator('input[name=months]').fill(String(f.months));
    await form.locator('input[name=fee]').fill(f.fee);
    if (f.rate) await form.locator('input[name=rate_pct]').fill(f.rate);
    if (f.life) await form.locator('input[name=life_months]').fill(f.life);
    if (f.treatment) await form.locator('select[name=treatment]').selectOption(f.treatment);
    await form.locator('button').click();
    await owner.locator(`text=${f.treatment === 'financial' ? 'tillgång och leasingskuld är bokförda' : 'Leasingavtalet är upplagt'}`).waitFor();
  };
  await addLease({ name: 'Volvo XC60 ABC123', kind: 'car', start: `${YEAR}-01-15`, months: 36, fee: '4000' });
  assert((await owner.locator('select[name=treatment] option').count()) === 1, 'finansiell leasing bara enligt K3');
  await addLease({ name: 'Grävmaskin', kind: 'machine', start: `${YEAR}-01-10`, months: 48, fee: '10000', life: '60' });
  assert((await owner.locator('tr.lease-row:has-text("Grävmaskin") .treatment').innerText()).includes('Kan vara finansiell: löptiden är 80 %'), 'klassningsförslag');
  await owner.fill('input[name=upto]', `${YEAR}-${String(MONTH).padStart(2, '0')}`);
  await owner.click('button:has-text("Bokför förfallna avgifter")');
  await owner.locator(`text=${2 * MONTH} leasingavgifter är bokförda`).waitFor();
  await owner.goto(B + '/leasing');
  await owner.click('button:has-text("Bokför förfallna avgifter")');
  await owner.locator('text=0 leasingavgifter är bokförda').waitFor();
  assert((await owner.locator('tr.lease-row:has-text("Volvo") .booked').innerText()) === `${MONTH} av 36`, 'bokförda');
  assert(nb(await owner.locator('.lease-cost').innerText()) === nb(((4500 + 10000) * MONTH).toLocaleString('sv-SE') + ',00'), 'årets kostnad');
  const left = (months, start) => { let w1 = 0, w5 = 0; for (let n = 1; n <= months; n++) { const ahead = (start - 1 + n - 1) - (MONTH - 1); if (ahead <= 0) continue; if (ahead <= 12) w1++; else if (ahead <= 60) w5++; } return [w1, w5]; };
  const [c1, c5] = left(36, 1), [g1, g5] = left(48, 1);
  assert(nb(await owner.locator('.lease-within1').innerText()) === nb((c1 * 4000 + g1 * 10000).toLocaleString('sv-SE') + ',00') && nb(await owner.locator('.lease-1to5').innerText()) === nb((c5 * 4000 + g5 * 10000).toLocaleString('sv-SE') + ',00'), 'förfallotider');
  await owner.goto(B + '/rapporter/huvudbok?account=5615');
  t = await text(owner);
  assert(t.includes('Leasingavgift Volvo XC60') && t.includes('4 500,00'), 'personbil: halva momsen blir kostnad: ' + t.slice(0, 1200));
  log('operationell leasing bokförs varje månad (personbil med halv moms), klassningsförslag enligt K3 och framtida avgifter per förfallotid');

  await owner.goto(B + '/bokslut');
  await owner.locator(`tr:has-text("${YEAR}-01-01") a:has-text("Öppna")`).click();
  await owner.waitForURL(/\/bokslut\/\d+$/);
  const FY = owner.url().replace(/.*\/bokslut\//, '');
  await owner.goto(`${B}/bokslut/${FY}/k3`);
  await owner.check('input[name=confirm]'); await owner.click('button:has-text("Byt till K3")');
  await owner.locator('text=Bolaget tillämpar nu K3').waitFor();
  await addLease({ name: 'Svarv CNC', kind: 'machine', start: `${YEAR}-01-05`, months: 24, fee: '20000', rate: '6', treatment: 'financial' });
  t = await text(owner);
  assert(/Svarv CNC.*Finansiell.*i anläggningsregistret/.test(t), 'finansiell: ' + t.slice(0, 2000));
  await owner.click('button:has-text("Bokför förfallna avgifter")');
  await owner.locator(`text=${MONTH} leasingavgifter är bokförda`).waitFor();
  await owner.goto(B + '/rapporter/huvudbok?account=2355');
  t = await text(owner);
  assert(t.includes('Finansiell leasing: Svarv CNC') && t.includes('Leasingavgift Svarv CNC'), 'leasingskuld: ' + t.slice(0, 1500));
  await owner.goto(B + '/anlaggningar');
  assert((await text(owner)).includes('Leasad: Svarv CNC'), 'tillgång i registret');
  await owner.goto(`${B}/bokslut/${FY}/arsredovisning`);
  t = await text(owner);
  assert(t.includes('Leasingavtal') && t.includes('Inom ett år') && t.includes('Senare än ett år men inom fem år'), 'not i årsredovisningen');
  await owner.goto(`${B}/bokslut/${FY}/k3`);
  await owner.click('button:has-text("Byt tillbaka till K2")');
  await owner.locator('text=Bolaget tillämpar nu K2').waitFor();
  log('finansiell leasing enligt K3: tillgång i anläggningsregistret, leasingskuld som amorteras med ränta och not i årsredovisningen');

  //@@NEXT@@
  await browser.close(); mailServer.close(); creditServer.close();
  console.log('Omgång 14: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
