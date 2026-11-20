// End-to-end, omgång 17: koncernredovisning, fåmansföretag och 3:12, hotell och restaurang, tid till lön och faktura, bokslutspärm.
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

  // ================= Del 1: koncernredovisning =================
  const MO = await newCompany('Koncerntest Moder AB', 559500000);
  const DO = await newCompany('Koncerntest Dotter AB', 559600000);
  const idOf = (u) => u.split('/c/')[1];
  const KQ = `/koncern?c=${idOf(MO)}&c=${idOf(DO)}&moder=${idOf(MO)}&from=${YEAR}-01-01&to=${YEAR}-12-31`;
  await owner.goto(BASE + KQ);
  const gl = owner.locator('form.group-link');
  await gl.locator('input[name=ownership]').fill('80');
  await gl.locator('input[name=acquisition_cost]').fill('1000000');
  await gl.locator('input[name=acquired_equity]').fill('500000');
  await gl.locator('input[name=acquired_on]').fill(`${YEAR - 1}-01-01`);
  await gl.locator('input[name=surplus]').fill('200000'); await gl.locator('input[name=surplus_years]').fill('20');
  await gl.locator('input[name=goodwill_years]').fill('5');
  await gl.locator('input[name=intra_inventory]').fill('100000'); await gl.locator('input[name=intra_inventory_opening]').fill('40000'); await gl.locator('input[name=intra_margin]').fill('25');
  await gl.locator('button:has-text("Koppla som dotterbolag")').click();
  await owner.locator('text=Koncernuppgifterna är sparade').waitFor();
  const acq = owner.locator('tr.acq-row');
  assert(nb(await acq.locator('.acq-gw').innerText()) === '472960,00', 'goodwill: ' + await acq.innerText());
  const dep = Number(nb(await acq.locator('.acq-dep').innerText()).replace(',', '.'));
  assert(dep > 100000 && dep < 106000, 'periodens avskrivning ≈ 472 960/5 + 200 000/20: ' + dep);
  t = await owner.locator('.elims').innerText();
  assert(t.includes('Övervärde Koncerntest Dotter AB') && t.includes('Internvinst i lager Koncerntest Dotter AB') && nb(t).includes('25000,00') && t.includes('Avskrivning goodwill och övervärden'), 'elimineringar: ' + t);
  log('förvärvsanalys: övervärde med uppskjuten skatt, goodwill 472 960 kr som skrivs av från förvärvsdagen, minoritet 20 % och internvinst i lager');

  // ================= Del 2: fåmansföretag och 3:12 =================
  for (const [n, sh, sv] of [['Anna Ägare', '60', '10000'], ['Bertil Ägare', '40', '0']]) {
    await owner.goto(MO + '/agare');
    const f = owner.locator('form:has(button:has-text("Lägg till ägare"))');
    await f.locator('input[name=name]').fill(n); await f.locator('input[name=share_pct]').fill(sh); await f.locator('input[name=saved_space]').fill(sv);
    await f.locator('button:has-text("Lägg till ägare")').click();
    await owner.locator('text=Ägaren är sparad').waitFor();
  }
  await owner.goto(MO + `/agare?year=${YEAR}&plan=400000`);
  const ibb = { 2025: 80600, 2026: 83400 }[YEAR - 1] ?? 83400;
  const limA = Math.round(4 * ibb * 0.6) + 10000, limB = Math.round(4 * ibb * 0.4);
  const maxW = Math.floor(Math.min(limA / 0.6, limB / 0.4));
  assert(nb(await owner.locator('.max-within').innerText()).startsWith(String(maxW)), 'största utdelning inom gränsbeloppen: ' + await owner.locator('.max-within').innerText() + ' ≠ ' + maxW);
  const bRow = owner.locator('tr.plan-row:has-text("Bertil Ägare")');
  assert(nb(await bRow.locator('.above').innerText()) === `${160000 - limB},00`, 'Bertil över gränsbeloppet: ' + await bRow.innerText());
  log('utdelningsplan för flera ägare: fördelning efter andel, del över gränsbeloppet och största utdelning inom allas gränsbelopp');
  await owner.click(`button:has-text("Spara K10 för ${YEAR}")`);
  await owner.locator(`text=K10 för ${YEAR} är sparad för 2 ägare`).waitFor();
  await owner.goto(MO + `/agare?year=${YEAR + 1}`);
  const annaK10 = owner.locator('section.k10:has(h3:text-is("Anna Ägare"))');
  t = await annaK10.innerText();
  assert(t.includes(`från sparad K10 ${YEAR}`) && nb(await annaK10.locator('.saved-in').innerText()) === `${limA},00` && (await annaK10.locator('.k10-history').count()) === 1, 'sparat utrymme förs vidare: ' + t);
  log('K10 sparas per ägare och år och sparat utdelningsutrymme förs automatiskt till nästa år');

  await owner.goto(MO + '/agare#kapitalforsakring');
  const nf = owner.locator('form:has(button:has-text("Ny kapitalförsäkring"))');
  await nf.locator('input[name=name]').fill('Pensionsförsäkring Anna'); await nf.locator('input[name=insurer]').fill('Testförsäkring AB'); await nf.locator('input[name=pledged]').fill('Pensionsutfästelse Anna Ägare');
  await nf.locator('button:has-text("Ny kapitalförsäkring")').click();
  await owner.locator('text=Kapitalförsäkringen är registrerad').waitFor();
  await owner.locator('section.insurance input[name=amount]').fill('50000');
  await owner.click('section.insurance button:has-text("Bokför premie")');
  await owner.locator('text=Premien är bokförd på 1385').waitFor();
  await owner.goto(MO + '/agare#kapitalforsakring');
  await owner.locator('section.insurance input[name=value]').fill('45000');
  await owner.check('section.insurance input[name=writedown]');
  await owner.click('section.insurance button:has-text("Registrera värde")');
  await owner.locator('text=nedskrivningen bokförd').waitFor();
  await owner.goto(MO + '/agare#kapitalforsakring');
  assert(nb(await owner.locator('.ins-booked').innerText()) === '45000,00', 'bokfört efter nedskrivning');
  await owner.goto(MO + '/rapporter/huvudbok?account=8270');
  assert(nb(await text(owner)).includes('5000,00'), 'nedskrivning 8270');
  log('kapitalförsäkring: premier på 1385, avkastningsskatt beräknad och nedskrivning vid bestående värdenedgång');

  // ================= Del 3: hotell och restaurang =================
  const R = `${BASE}/c/1`;
  const zno = 'Z' + (Date.now() % 1000000);
  await owner.goto(R + '/restaurang');
  const zf = owner.locator('form:has(button:has-text("Bokför dagskassan"))');
  await zf.locator('input[name=z_number]').fill(zno);
  await zf.locator('input[name=food]').fill('11200'); await zf.locator('input[name=alcohol]').fill('2500'); await zf.locator('input[name=tips]').fill('300');
  await zf.locator('input[name=pay_card]').fill('9000');
  await zf.locator('button:has-text("Bokför dagskassan")').click();
  await owner.locator('text=ska vara försäljningen').waitFor();
  await owner.goto(R + '/restaurang');
  const before = Number(nb(await owner.locator('.tips-liability').innerText()).replace(',', '.'));
  await zf.locator('input[name=z_number]').fill(zno);
  await zf.locator('input[name=food]').fill('11200'); await zf.locator('input[name=alcohol]').fill('2500'); await zf.locator('input[name=tips]').fill('300');
  await zf.locator('input[name=pay_card]').fill('10000'); await zf.locator('input[name=pay_cash]').fill('4000');
  await zf.locator('button:has-text("Bokför dagskassan")').click();
  await owner.locator('text=Dagskassan är bokförd').waitFor();
  await owner.goto(R + '/restaurang');
  assert(Math.abs(Number(nb(await owner.locator('.tips-liability').innerText()).replace(',', '.')) - before - 300) < 0.01, 'dricks som skuld 2897');
  assert((await owner.locator('table.z-reports').innerText()).includes(zno), 'Z-rapporten listas');
  log('restaurangkassa: mat 12 %, alkohol 25 % och kortdricks som skuld till personalen – betalningarna ska gå ihop');

  const mf = owner.locator('form:has(button:has-text("Registrera"))').filter({ has: owner.locator('input[name=lunches]') });
  await mf.locator('input[name=lunches]').fill('10'); await mf.locator('input[name=paid]').fill('300');
  await mf.locator('input[name=v_lunch]').fill('130');
  await mf.locator('button:has-text("Registrera")').click();
  await owner.locator('text=Personalmaten är registrerad').waitFor();
  t = nb(await owner.locator('.flash').first().innerText());
  assert(t.includes('förmånsvärde1300,00') && t.includes('skattepliktigt1000,00'), 'kostförmån: ' + t);
  await owner.click('button:has-text("Bokför uttagsmoms")');
  await owner.locator('text=är bokförd för').waitFor();
  assert(nb(await owner.locator('.flash').first().innerText()).includes('139,29'), 'uttagsmoms 12/112 av 1 300');
  log('personalmat: kostförmån enligt schablon minus egen betalning till lönen, uttagsmoms 12 % bokförd per månad');

  await owner.goto(R + '/restaurang#representation');
  const rf = owner.locator('form:has(button:has-text("Bokför representation"))');
  await rf.locator('input[name=food]').fill('1120'); await rf.locator('input[name=drinks]').fill('500'); await rf.locator('input[name=persons]').fill('2');
  await rf.locator('input[name=purpose]').fill('Förhandling med leverantör, två deltagare');
  await rf.locator('button:has-text("Bokför representation")').click();
  await owner.locator('text=Representationen är bokförd').waitFor();
  t = nb(await owner.locator('.flash').first().innerText());
  assert(t.includes('avdragsgillmoms94,29krav220,00'), 'moms med tak 300 kr/person: ' + t);
  log('representation med mat och vin: ej avdragsgill kostnad, moms avdragsgill på högst 300 kr per person fördelat på momssatserna');

  // ================= Del 4: tid till lön och faktura =================
  const pnr = (base) => { let sum = 0; [...base.slice(2)].forEach((c, i) => { let d = Number(c) * (i % 2 === 0 ? 2 : 1); sum += d > 9 ? d - 9 : d; }); return `${base.slice(0, 8)}-${base.slice(8)}${(10 - (sum % 10)) % 10}`; };
  await owner.goto(MO + '/lon/avtal');
  const af = owner.locator('form:has(button:has-text("Lägg till avtal"))');
  await af.locator('input[name=name]').fill('Hotell- och restaurangavtalet');
  await af.locator('input[name=ob_evening]').fill('25'); await af.locator('input[name=ob_night]').fill('50'); await af.locator('input[name=ob_weekend]').fill('60');
  await af.locator('input[name=travel_divisor]').fill('200');
  await af.locator('button:has-text("Lägg till avtal")').click();
  await owner.waitForURL(/ok=/);
  await owner.goto(MO + '/lon/anstallda');
  const ef = owner.locator('form:has(input[name=first_name])');
  await ef.locator('input[name=first_name]').fill('Tina'); await ef.locator('input[name=last_name]').fill('Tidrapport');
  await ef.locator('input[name=personal_number]').fill(pnr('19900101123')); await ef.locator('input[name=monthly_salary]').fill('30000');
  await ef.locator('input[name=tax_table]').fill('32');
  await ef.locator('select[name=agreement_id]').selectOption({ label: 'Hotell- och restaurangavtalet' });
  await ef.locator('button:has-text("Spara")').click();
  await owner.waitForURL(/ok=/);
  await owner.goto(MO + '/installningar');
  const tinaMail = `tina${Date.now() % 100000}@example.com`;
  await owner.fill('form:has(button:has-text("Skapa inbjudan")) input[name=email]', tinaMail);
  await owner.selectOption('select[name=role]', 'employee');
  await owner.selectOption('select[name=employee_id]', { label: 'Tina Tidrapport' });
  await owner.click('button:has-text("Skapa inbjudan")');
  const tlink = (await owner.locator('.flash.ok code').textContent({ timeout: 10000 })).trim();
  const tina = await (await browser.newContext()).newPage();
  tina.setDefaultTimeout(20000);
  await tina.goto(tlink);
  await tina.fill('input[name=name]', 'Tina Tidrapport'); await tina.fill('input[name=password]', 'tinaslosen123');
  await tina.click('button:has-text("Acceptera")');
  await tina.waitForURL(BASE + '/');
  // Uppdrag med timpris
  await owner.goto(MO + '/kunder');
  await owner.fill('input[name=name]', 'Konferenskund AB');
  await owner.click('button:has-text("Spara kund")');
  await owner.locator('text=Kunden är sparad').waitFor();
  await owner.goto(MO + '/uppdrag');
  await owner.fill('input[name=name]', 'Konferens'); await owner.selectOption('select[name=billing]', 'hourly');
  await owner.fill('input[name=hourly_rate]', '500'); await owner.fill('textarea[name=activities]', 'Servering');
  await owner.click('button:has-text("Skapa uppdrag")');
  await owner.waitForURL(/uppdrag\/\d+/);
  const PU = owner.url().split('?')[0];
  // Förra månaden: sista onsdagen och sista lördagen
  const now = new Date(); const pm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const last = (wd) => { const d = new Date(pm); while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
  const wed = last(3), sat = last(6), period = pm.toISOString().slice(0, 7);
  const logTime = async (d, start, end, kind, desc) => {
    await tina.goto(`${MO}/tid?week=${d}`);
    await tina.fill('input[name=date]', d);
    await tina.selectOption('select[name=activity_id]', { label: 'Konferens – Servering' });
    await tina.fill('input[name=start_time]', start); await tina.fill('input[name=end_time]', end);
    await tina.selectOption('select[name=kind]', kind);
    await tina.fill('input[name=description]', desc);
    if (kind === 'travel') await tina.uncheck('input[name=billable]');
    await tina.click('button:has-text("Spara tid")');
    await tina.locator('text=Tiden är sparad').waitFor();
  };
  await logTime(wed, '16:00', '23:00', 'work', 'Middagsservering');
  await logTime(wed, '23:00', '00:00', 'travel', 'Resa hem från konferensen');
  await logTime(sat, '10:00', '20:00', 'work', 'Konferensdag');
  log('tid med klockslag och restid rapporteras av den anställda');

  await owner.goto(MO + '/tid/attest');
  await owner.click('button:has-text("Kräv attest innan fakturering")');
  await owner.locator('text=Attest krävs nu').waitFor();
  await owner.goto(PU);
  await owner.fill('input[name=to]', day(0));
  await owner.click('button:has-text("Skapa fakturaunderlag")');
  await owner.locator('.flash.error').first().waitFor();
  await owner.goto(MO + `/tid/attest?from=${period}-01&to=${day(0)}`);
  await owner.locator('tr.time-person:has-text("Tina Tidrapport") button:has-text("Attestera")').click();
  await owner.locator('text=3 tidrader är attesterade').waitFor();
  t = (await owner.locator('tr.time-person:has-text("Tina Tidrapport") .hours').innerText()).replace(/\s+/g, ' ');
  assert(t.includes('OB kväll 4 h') && t.includes('OB natt 1 h') && t.includes('OB helg 10 h') && t.includes('Enkel övertid 2 h') && t.includes('Restid 1 h'), 'klassning: ' + t);
  log('attesterad tid klassas: OB kväll 18–22, natt 22–06, helg, övertid över 8 h per dag och restid');

  await owner.goto(PU);
  await owner.fill('input[name=to]', day(0));
  await owner.click('button:has-text("Skapa fakturaunderlag")');
  await owner.locator('text=Fakturaunderlaget är skapat').waitFor();
  assert(nb(await text(owner)).includes('8500,00'), 'fakturan: 17 h arbete à 500 kr (restiden debiteras inte): ' + (await text(owner)).slice(0, 800));
  await owner.goto(MO + '/lon');
  await owner.fill('input[name=period]', period); await owner.fill('input[name=payment_date]', `${period}-25`);
  await owner.click('button:has-text("Ny lönekörning")');
  await owner.waitForURL(/lon\/\d+\?ok/);
  const RUN = owner.url().split('?')[0];
  await owner.goto(MO + `/tid/attest?from=${period}-01&to=${day(0)}`);
  await owner.selectOption('select[name=run_id]', { label: period });
  await owner.click('button:has-text("För attesterad tid till lönespecarna")');
  await owner.locator('text=3 tidrader är förda till lönekörningen').waitFor();
  await owner.goto(RUN);
  t = (await owner.$$eval('main input', (els) => els.map((e) => e.value).join(' | '))).replace(/\s+/g, ' ');
  assert(nb(await text(owner)).includes('Bruttolön31538,30'), 'bruttolön 30 000 + 100 + 50 + 600 + 638,30 + 150');
  assert(t.includes('OB kväll 4 h à 25,00 kr') && t.includes('OB helg 10 h à 60,00 kr') && t.includes('Enkel övertid 2 h') && t.includes('Restid 1 h à 150,00 kr'), 'lönespec: ' + t.slice(0, 2500));
  await owner.goto(MO + `/tid/attest?from=${period}-01&to=${day(0)}`);
  await owner.selectOption('select[name=run_id]', { label: period });
  await owner.click('button:has-text("För attesterad tid till lönespecarna")');
  await owner.locator('text=ingen attesterad tid').waitFor();
  log('samma attesterade tid blir kundfaktura och lönerader (OB, övertid, restid) enligt kollektivavtalet – en gång');

  //@@NEXT@@
  await browser.close(); mailServer.close();
  console.log('Omgång 17: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
