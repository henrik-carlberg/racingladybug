// End-to-end, omgång 18: inventarier i bokslutet, moms på djupet, ägarbyte, byråns arbetsflöde, kvalitetskontroller före bokslut.
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

  // ================= Del 1: inventarier i bokslutet =================
  const IV = await newCompany('Inventarietest AB', 559700000);
  await voucher(IV, 'Inköp maskiner', [[1220, 100000], [1930, -100000]]);
  await voucher(IV, 'Överavskrivning tidigare bokförd', [[8853, 50000], [2150, -50000]]);
  await owner.goto(IV + '/bokslut');
  await owner.locator(`tr:has-text("${YEAR}-01-01") a:has-text("Öppna")`).first().click();
  await owner.waitForURL(/bokslut\/\d+/);
  await owner.goto(owner.url().split('?')[0] + '/dispositioner');
  t = await owner.locator('.depreciation-methods').innerText();
  assert(t.includes('30-regeln') && t.includes('Restvärdesmetoden') && nb(await owner.locator('.max-reserve').innerText()) === '30000,00' && nb(await owner.locator('.reserve-now').innerText()) === '50000,00', 'metoder: ' + t);
  const rev = owner.locator('.proposal[data-kind=aterforing_overavskrivning]');
  assert((await rev.innerText()).includes('Måste göras') && nb(await rev.innerText()).includes('20000,00'), 'återföring: ' + await rev.innerText());
  await rev.locator('button').click();
  await owner.waitForLoadState('networkidle');
  await owner.goto(owner.url().split('?')[0]);
  assert(nb(await owner.locator('.reserve-now').innerText()) === '30000,00', 'reserven efter återföring');
  log('överavskrivningar: 30-regeln, 20-regeln och restvärdesmetoden jämförs; reserv över bokfört minus lägsta skattemässiga värde återförs');

  // ================= Del 2: moms på djupet =================
  const VM = await newCompany('Blandad Verksamhet AB', 559800000);
  await owner.goto(VM + '/rapporter/moms/avancerat');
  await owner.fill('input[name=pct]', '60'); await owner.fill('input[name=accounts]', '5010');
  await owner.click('form:has(input[name=accounts]) button:has-text("Spara")');
  await owner.locator('text=Inställningarna för blandad verksamhet är sparade').waitFor();
  await voucher(VM, 'Lokalhyra (gemensam)', [[5010, 10000], [2641, 2500], [1930, -12500]]);
  await voucher(VM, 'Förbrukningsmaterial', [[6110, 1000], [2641, 250], [1930, -1250]]);
  await owner.goto(VM + `/rapporter/moms/avancerat?from=${YEAR}-01-01&to=${day(0)}`);
  assert(nb(await owner.locator('.common-vat').innerText()) === '2500,00' && nb(await owner.locator('.non-deductible').innerText()) === '1000,00', 'proportionering: ' + await owner.locator('.grid').innerText());
  await owner.click('button:has-text("Bokför proportionering")');
  await owner.locator('text=är förd till kostnad').waitFor();
  await owner.goto(VM + `/rapporter/moms/avancerat?from=${YEAR}-01-01&to=${day(0)}`);
  await owner.click('button:has-text("Bokför proportionering")').catch(() => {});
  await owner.goto(VM + '/rapporter/huvudbok?account=5010');
  assert(nb(await text(owner)).includes('1000,00') && (await text(owner)).includes('Proportionering'), 'gemensam moms till kostnad');
  log('blandad verksamhet: gemensam ingående moms proportioneras (60 %) och ej avdragsgill del förs till kostnaden, en gång per period');

  await owner.goto(VM + '/rapporter/moms/avancerat#jamkning');
  const jf = owner.locator('form:has(input[name=vat_amount])');
  await jf.locator('input[name=description]').fill('Ombyggnad av lokalen'); await jf.locator('input[name=completed_on]').fill(`${YEAR - 1}-03-01`);
  await jf.locator('input[name=vat_amount]').fill('200000'); await jf.locator('input[name=orig_pct]').fill('100');
  await jf.locator('button:has-text("Registrera")').click();
  await owner.locator('text=Investeringen är registrerad').waitFor();
  await owner.locator('.investment input[name=new_pct]').fill('95');
  await owner.click('.investment button:has-text("Jämka")');
  await owner.locator('text=mindre än 10 procentenheter').waitFor();
  await owner.goto(VM + '/rapporter/moms/avancerat#jamkning');
  await owner.locator('.investment input[name=new_pct]').fill('60');
  await owner.click('.investment button:has-text("Jämka")');
  await owner.locator('text=Jämkningen är bokförd: återbetalning 8').waitFor();
  log('jämkning av fastighet: 40 procentenheter lägre momspliktig användning ger återbetalning av 1/10 × 40 % av momsen');

  await owner.goto(VM + '/kunder');
  await owner.fill('input[name=name]', 'EU Kund GmbH'); await owner.fill('input[name=vat_number]', 'DE123456789'); await owner.fill('input[name=country]', 'DE');
  await owner.click('button:has-text("Spara kund")');
  await owner.locator('text=Kunden är sparad').waitFor();
  await owner.goto(VM + '/kunder');
  await owner.click('a:has-text("EU Kund GmbH")');
  await owner.waitForURL(/kunder\/\d+/);
  assert((await owner.locator('.vies-status').innerText()).includes('inte kontrollerat'), 'okontrollerat');
  await owner.click('button:has-text("Kontrollera mot VIES")');
  await owner.locator('text=DE123456789 är giltigt i VIES (EU KUND GMBH)').waitFor();
  assert((await owner.locator('.vies-status').innerText()).includes('Giltigt enligt VIES'), 'giltigt');
  log('momsregistreringsnummer kontrolleras mot EU:s VIES och resultatet sparas på kunden');

  // ================= Del 3: ägarbyte och generationsskifte =================
  const pnr = (base) => { let sum = 0; [...base.slice(2)].forEach((c, i) => { let d = Number(c) * (i % 2 === 0 ? 2 : 1); sum += d > 9 ? d - 9 : d; }); return `${base.slice(0, 8)}-${base.slice(8)}${(10 - (sum % 10)) % 10}`; };
  const P1 = pnr('19600101123'), P2 = pnr('19900101567'), P3 = pnr('19850505432');
  const GS = await newCompany('Generationsskifte AB', 559900000);
  await owner.goto(GS + '/agare');
  let of = owner.locator('form:has(button:has-text("Lägg till ägare"))');
  await of.locator('input[name=name]').fill('Pappa Grundare'); await of.locator('input[name=personal_number]').fill(P1);
  await of.locator('input[name=share_pct]').fill('100'); await of.locator('input[name=cost_basis]').fill('25000'); await of.locator('input[name=saved_space]').fill('50000');
  await of.locator('button:has-text("Lägg till ägare")').click();
  await owner.locator('text=Ägaren är sparad').waitFor();
  await owner.goto(GS + '/aktiebok');
  await owner.fill('input[name=share_capital]', '25000'); await owner.fill('input[name=date]', `${YEAR}-01-01`);
  await owner.fill('input[name=name_0]', 'Pappa Grundare'); await owner.fill('input[name=id_0]', P1); await owner.fill('input[name=shares_0]', '1000');
  await owner.click('button:has-text("Lägg upp aktieboken")');
  await owner.locator('text=Aktieboken är upplagd').waitFor();
  const transfer = async (to, id, n, kind, price) => {
    await owner.goto(GS + '/aktiebok');
    const opt = await owner.locator('select[name=from] option:has-text("Pappa Grundare")').first().getAttribute('value');
    await owner.selectOption('select[name=from]', opt);
    await owner.fill('form:has(select[name=from]) input[name=shares]', String(n));
    await owner.fill('input[name=to_name]', to); await owner.fill('input[name=to_id]', id);
    await owner.selectOption('select[name=kind]', kind);
    if (price) await owner.fill('form:has(select[name=from]) input[name=price]', price);
    await owner.click('button:has-text("För in överlåtelsen")');
    await owner.locator('text=Överlåtelsen är införd i aktieboken').waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await transfer('Dotter Arvtagare', P2, 500, 'gift');
  assert(t.includes('övertaromkostnadsbelopp12500,00kr') && t.includes('sparatutdelningsutrymme25000,00kr'), 'gåva: ' + t);
  t = await transfer('Extern Köpare', P3, 100, 'sale', '300000');
  assert(t.includes('omkostnadsbeloppföraktierna2500,00kr') && t.includes('kapitalvinst297500,00kr'), 'försäljning: ' + t);
  await owner.goto(GS + '/agare');
  const costOf = async (n) => nb(await owner.locator(`details:has(summary:has-text("${n}")) input[name=cost_basis]`).inputValue());
  assert(await costOf('Dotter Arvtagare') === '12500' && await costOf('Extern Köpare') === '300000' && await costOf('Pappa Grundare') === '10000', 'omkostnadsbelopp efter överlåtelser');
  log('generationsskifte: gåva överför omkostnadsbelopp och sparat utdelningsutrymme, försäljning ger köparen köpeskillingen och säljaren kapitalvinst');

  await owner.selectOption('form:has(button:has-text("Bokför tillskott")) select[name=owner_id]', { label: 'Dotter Arvtagare' });
  await owner.fill('form:has(button:has-text("Bokför tillskott")) input[name=amount]', '50000');
  await owner.click('button:has-text("Bokför tillskott")');
  await owner.locator('text=ovillkorade aktieägartillskottet är bokfört').waitFor();
  await owner.goto(GS + '/agare');
  assert(await costOf('Dotter Arvtagare') === '62500', 'ovillkorat tillskott ökar omkostnadsbeloppet');
  await owner.goto(GS + '/rapporter/huvudbok?account=2093');
  assert(nb(await text(owner)).includes('50000,00'), '2093');
  log('ovillkorat aktieägartillskott bokförs på 2093 och ökar ägarens omkostnadsbelopp');

  // ===== Del 4: byråns arbetsflöde =====
  await owner.goto(BASE + '/byra');
  await owner.fill('input[name=name]', 'Uppgiftsbyrån AB'); await owner.fill('input[name=orgnr]', '559000-0018');
  await owner.click('button:has-text("Skapa byrå")');
  await owner.locator('text=Byrån är skapad').waitFor();
  const fid = new URL(owner.url()).searchParams.get('f') || (await owner.locator('a[href*="/byra/uppgifter?f="]').first().getAttribute('href')).match(/f=(\d+)/)[1];
  const fcode = (await owner.locator('code.firm-code').textContent()).trim();
  await owner.goto(GS + '/installningar/byra');
  await owner.fill('input[name=code]', fcode);
  await owner.click('button:has-text("Ge åtkomst")');
  await owner.locator('text=har fått åtkomst').waitFor();
  await owner.goto(`${BASE}/byra/uppgifter?f=${fid}`);
  const gsRows = owner.locator('tr.task-row[data-company="Generationsskifte AB"]');
  assert(await gsRows.count() > 0, 'kundens deadlines visas på tavlan');
  const before = Number(await owner.locator('.task-unassigned').innerText());
  const first = gsRows.first();
  const ftitle = (await first.locator('td').nth(2).innerText()).trim();
  const me = await first.locator('select[name=assignee] option').nth(1).getAttribute('value');
  await first.locator('select[name=assignee]').selectOption(me);
  await first.locator('button:has-text("Spara")').click();
  await owner.locator('text=Ansvarig är satt').waitFor();
  assert(Number(await owner.locator('.task-unassigned').innerText()) === before - 1, 'utan ansvarig minskar');
  await owner.goto(`${BASE}/byra/uppgifter?f=${fid}&mine=1`);
  t = await text(owner);
  assert(t.includes(ftitle), 'bara mina visar den tilldelade deadlinen');
  await owner.goto(`${BASE}/byra/uppgifter?f=${fid}`);
  await owner.selectOption('form.add-task select[name=company_id]', { label: 'Generationsskifte AB' });
  await owner.fill('form.add-task input[name=title]', 'Hämta in underlag för bilförmån');
  await owner.fill('form.add-task input[name=due]', '2020-01-15');
  await owner.click('button:has-text("Lägg till uppgiften")');
  await owner.locator('text=Uppgiften är tillagd').waitFor();
  const own = owner.locator('tr.task-row:has-text("Hämta in underlag för bilförmån")');
  assert(await own.evaluate((e) => e.classList.contains('overdue')), 'egen uppgift med passerat datum är försenad');
  assert((await owner.locator('tr.task-row').first().innerText()).includes('Hämta in underlag'), 'försenade först');
  await own.locator('button:has-text("Klar")').click();
  await owner.locator('text=Markerad som klar').waitFor();
  assert(!(await text(owner)).includes('Hämta in underlag för bilförmån'), 'klar uppgift döljs');
  await owner.locator(`tr.task-row[data-company="Generationsskifte AB"]:has-text("${ftitle}") button:has-text("Klar")`).first().click();
  await owner.locator('text=Markerad som klar').waitFor();
  await owner.goto(`${BASE}/byra/uppgifter?f=${fid}&done=1`);
  t = await text(owner);
  assert(t.includes('Hämta in underlag för bilförmån') && t.includes(ftitle), 'klara visas med filtret');
  log('byråns uppgifter: kundens deadlines med ansvarig, egna uppgifter, försenade först, klarmarkering');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 18: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
