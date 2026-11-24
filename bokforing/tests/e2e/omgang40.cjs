// E2E omgång 40: investeringskalkyl, nyckeltalslarm, styrelsepaket, valutaexponering, inköpsanalys
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

  // ================= Del 1: investeringskalkyl =================
  const IV = await newCompany('Maskinparken AB', 560010000);
  const ivf = async (f) => {
    await owner.goto(IV + '/investeringar');
    const fm = owner.locator('form.iv-add');
    for (const [k, v] of Object.entries(f)) { if (k === 'category') await fm.locator('select[name=category]').selectOption(v); else await fm.locator(`input[name=${k}]`).fill(v); }
    await fm.locator('button').click(); await owner.waitForURL(/(ok|error)=/);
    return nb(await owner.locator('.flash').first().innerText());
  };
  const flowsK = [300000, 300000, 300000, 300000, 400000];
  const npvK = flowsK.reduce((s, x, i) => s + x / Math.pow(1.08, i + 1), 0) - 1000000;
  const expNpv = (Math.round(npvK * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '');
  t = await ivf({ name: 'CNC-fräs', category: 'maskiner', investment: '1000000', life_years: '5', residual: '100000', annual_in: '400000', annual_out: '100000', rate_pct: '8', loan_rate_pct: '5', lease_monthly: '22000' });
  assert(t.includes('nuvärde' + expNpv.slice(0, -3)) && t.includes('internränta'), 'nuvärde: ' + t + ' väntat ' + expNpv);
  await owner.goto(IV + '/investeringar');
  const cnc = owner.locator('.ic-calc[data-name="CNC-fräs"]');
  assert((await cnc.getAttribute('data-profitable')) === '1' && nb(await cnc.locator('.iv-payback').innerText()) === '3,3år', 'återbetalningstid: ' + nb(await cnc.locator('.iv-result').innerText()));
  const irrV = Number(nb(await cnc.locator('.iv-irr').innerText()).replace('%', '').replace(',', '.'));
  assert(irrV > 15 && irrV < 20, 'internränta mellan 15 och 20 %: ' + irrV);
  t = nb(await cnc.locator('.iv-sens').innerText()); assert(t.includes('intäkter−20%→-') || t.includes('intäkter−20%→'), 'känslighet: ' + t);
  assert(['Köpkontant', 'Köpmedlån', 'Leasing'].includes(nb(await cnc.locator('.iv-best').innerText())), 'billigaste finansiering');
  t = await ivf({ name: 'Packmaskin', investment: '500000', life_years: '3', annual_in: '150000', annual_out: '50000', rate_pct: '10' });
  await owner.goto(IV + '/investeringar');
  const pack = owner.locator('.ic-calc[data-name="Packmaskin"]');
  assert((await pack.getAttribute('data-profitable')) === '0' && nb(await pack.locator('.iv-payback').innerText()).includes('nej'), 'olönsam investering');
  await pack.locator('button:has-text("Avslå")').click(); await owner.locator('text=Investeringen är avslagen').waitFor();
  await owner.goto(IV + '/investeringar');
  await cnc.locator('button:has-text("Godkänn")').click(); await owner.locator('text=upplagd i anläggningsregistret').waitFor();
  await owner.goto(IV + '/anlaggningar');
  t = await text(owner); assert(t.includes('CNC-fräs') && t.includes('1 000 000,00'), 'inventariet i anläggningsregistret');
  log('investeringskalkyl: nuvärde, internränta, återbetalningstid, känslighet, jämförelse av köp, lån och leasing, olönsam investering avslås, godkänd läggs i anläggningsregistret');

  // ================= Del 2: nyckeltalslarm =================
  const KL = await newCompany('Larmbolaget AB', 560020000);
  await voucher(KL, 'Aktiekapital insatt', [[1930, 50000], [2081, -50000]], day(2));
  const larm = async (metric, comparator, threshold, email) => {
    await owner.goto(KL + '/nyckeltal/larm');
    const f = owner.locator('form.ka-add');
    await f.locator('select[name=metric]').selectOption(metric); await f.locator('select[name=comparator]').selectOption(comparator); await f.locator('input[name=threshold]').fill(threshold);
    if (email) await f.locator('input[name=email]').check();
    await f.locator('button').click(); await owner.locator('text=Larmet är sparat').waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  await owner.goto(KL + '/nyckeltal/larm');
  assert(nb(await owner.locator('.ka-metrics tr[data-metric="cash"] .ka-value').innerText()) === '50000kr' && nb(await owner.locator('.ka-metrics tr[data-metric="solidity"] .ka-value').innerText()) === '100%', 'nuvarande värden: ' + nb(await owner.locator('.ka-metrics').innerText()));
  t = await larm('cash', 'below', '100000', true); assert(t.includes('redanutlösts'), 'kassalarmet utlöses: ' + t);
  t = await larm('solidity', 'below', '30'); assert(!t.includes('utlösts'), 'soliditeten är över gränsen: ' + t);
  await owner.goto(KL + '/nyckeltal/larm');
  assert((await owner.locator('.ka-alert[data-metric="cash"]').getAttribute('data-open')) === '1' && (await owner.locator('.ka-alert[data-metric="solidity"]').getAttribute('data-open')) === '0', 'larmstatus');
  await owner.goto(KL);
  assert((await text(owner)).includes('Nyckeltal utanför dina gränser'), 'larmet på översikten');
  await voucher(KL, 'Banklån', [[1930, 150000], [2350, -150000]], day(1));
  await owner.goto(KL + '/nyckeltal/larm');
  assert((await owner.locator('.ka-alert[data-metric="cash"]').getAttribute('data-open')) === '0', 'larmet hävs när kassan är över gränsen');
  assert(nb(await owner.locator('.ka-history').innerText()).includes('hävt'), 'historik: ' + nb(await owner.locator('.ka-history').innerText()));
  assert((await owner.locator('.ka-alert[data-metric="solidity"]').getAttribute('data-open')) === '1', 'soliditeten föll under 30 % med lånet');
  await owner.locator('.ka-alert[data-metric="solidity"] button:has-text("Stäng av")').click(); await owner.locator('text=Larmet är avstängt').waitFor();
  await owner.goto(KL);
  assert(!(await text(owner)).includes('Nyckeltal utanför dina gränser'), 'avstängt larm försvinner från översikten');
  log('nyckeltalslarm: nuvarande värden, kassalarm utlöses och hävs, soliditetslarm vid lån, larm på översikten, historik, avstängt larm');

  // ================= Del 3: styrelsepaket =================
  const SPK = await newCompany('Styrelsepaketet AB', 560030000);
  if (Number(day(10).slice(0, 4)) < YEAR) await addFy(SPK, YEAR - 1);
  await voucher(SPK, 'Försäljning', [[1930, 100000], [3001, -100000]], day(3));
  await voucher(SPK, 'Inköp av varor', [[4010, 40000], [1930, -40000]], day(3));
  await owner.goto(SPK + '/nyckeltal/larm');
  { const f = owner.locator('form.ka-add'); await f.locator('select[name=metric]').selectOption('cash'); await f.locator('input[name=threshold]').fill('1000000'); await f.locator('button').click(); await owner.locator('text=Larmet är sparat').waitFor(); }
  await owner.goto(SPK + '/internkontroll');
  { const f = owner.locator('form.ic-add-risk'); await f.locator('input[name=area]').fill('Betalningar'); await f.locator('input[name=description]').fill('Bedrägliga betalningar'); await f.locator('input[name=likelihood]').fill('4'); await f.locator('input[name=impact]').fill('4'); await f.locator('button').click(); await owner.locator('text=Risken är tillagd').waitFor(); }
  await owner.goto(SPK + '/styrelsemoten');
  { const f = owner.locator('form.bm-new'); await f.locator('select[name=kind]').selectOption('board'); await f.locator('button').click(); await owner.locator('text=Mötet är skapat').waitFor(); }
  await owner.goto(SPK + '/styrelsemoten');
  { const f = owner.locator('.bm-meeting li[data-template="report"] form'); await f.locator('input[name=decision]').fill('Ta fram en likviditetsplan'); await f.locator('input[name=owner]').fill('VD'); await f.locator('input[name=due_date]').fill(day(-30)); await f.locator('button').click(); await owner.locator('text=Beslutet är sparat').waitFor(); }
  await owner.goto(SPK + '/styrelsepaket');
  { const f = owner.locator('form.bp-new'); await f.locator('select[name=kind]').selectOption('custom'); await f.locator('input[name=from]').fill(day(10)); await f.locator('input[name=to]').fill(day(0)); await f.locator('input[name=comment]').fill('En stark månad');
    await f.locator('button').click(); await owner.locator('text=Styrelsepaketet för').waitFor(); }
  await owner.goto(SPK + '/styrelsepaket');
  const pk = owner.locator('.bp-package').first();
  assert(nb(await pk.locator('.bp-row-result').innerText()).includes('60000,00') && nb(await pk.locator('.bp-cash').innerText()) === '60000,00', 'resultat och kassa: ' + nb(await pk.innerText()).slice(0, 400));
  assert(nb(await pk.locator('.bp-alerts').innerText()).includes('Kassaochbank'), 'utlösta larm');
  assert(nb(await pk.locator('.bp-decisions').innerText()).includes('Taframenlikviditetsplan'), 'öppna beslut');
  assert(nb(await pk.locator('.bp-control').innerText()).includes('Bedrägligabetalningar'), 'höga risker');
  await pk.locator('input[name=body]').fill('Bra jobbat'); await pk.locator('button:has-text("Kommentera")').click(); await owner.locator('text=Kommentaren är sparad').waitFor();
  await owner.goto(SPK + '/styrelsepaket');
  await pk.locator('textarea[name=recipients]').fill('Anna'); await pk.locator('button:has-text("Skicka till styrelsen")').click(); await owner.waitForURL(/error=/);
  assert(nb(await owner.locator('.flash').first().innerText()).includes('enmottagareperrad'), 'ogiltig mottagare');
  await owner.goto(SPK + '/styrelsepaket');
  await pk.locator('textarea[name=recipients]').fill('Anna Ordförande anna@example.com\nBo Ledamot <bo@example.com>'); await pk.locator('button:has-text("Skicka till styrelsen")').click();
  await owner.locator('text=Styrelsepaketet är skickat till 2 ledamöter').waitFor();
  await owner.goto(SPK + '/styrelsepaket');
  assert(nb(await pk.locator('.bp-status').innerText()).includes('väntarpåkvittens') && nb(await pk.locator('.bp-comments').innerText()).includes('Brajobbat'), 'skickat och kommenterat');
  await pk.locator('a:has-text("dokumentet")').click(); await owner.waitForURL(/dokument\/\d+/);
  t = nb(await text(owner)); assert(t.includes('Styrelsepaket') && t.includes('Enstarkmånad') && t.includes('60000,00'), 'dokumentet: ' + t.slice(0, 500));
  log('styrelsepaket: resultat mot budget, kassa, nyckeltal och larm, öppna styrelsebeslut, höga risker, kommentarer och utskick till ledamöterna');

  // ================= Del 4: valutaexponering =================
  const FX = await newCompany('Exportören AB', 560040000);
  await owner.goto(FX + '/kunder');
  await owner.fill('input[name=name]', 'Berlin GmbH'); await owner.fill('input[name=country]', 'DE'); await owner.fill('input[name=vat_number]', 'DE123456789');
  await owner.check('input[name=reverse_charge]'); await owner.selectOption('select[name=currency]', 'EUR');
  await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await owner.goto(FX + '/fakturor/ny');
  await owner.selectOption('select[name=customer_id]', { label: 'Berlin GmbH' }); await owner.fill('input[name=invoice_date]', day(2)); await owner.fill('input[name=exchange_rate]', '11,50');
  { const row = owner.locator('tbody tr').first(); await row.locator('td:nth-child(1) input').fill('Konsult'); await row.locator('td:nth-child(2) input').fill('10'); await row.locator('td:nth-child(4) input').fill('100'); }
  await owner.click('button:has-text("Spara utkast")'); await owner.waitForURL(/fakturor\/\d+\?ok/);
  await owner.click('button:has-text("Bokför faktura")'); await owner.locator('text=Fakturan är bokförd').waitFor();
  await owner.goto(FX + '/valutaterminer');
  await owner.fill('input[name=amount]', '400'); await owner.fill('input[name=forward_rate]', '11,5'); await owner.fill('input[name=maturity]', `${YEAR + 1}-03-31`);
  await owner.click('button:has-text("Registrera termin")'); await owner.locator('text=Terminen är registrerad').waitFor();
  await owner.goto(FX + '/valutaexponering');
  const eur = owner.locator('.fx-row[data-currency="EUR"]');
  assert(nb(await eur.locator('.fx-net').innerText()) === '1000,00' && nb(await eur.locator('.fx-hedge').innerText()) === '400,0040%' && nb(await eur.locator('.fx-unhedged').innerText()) === '600,00', 'exponering: ' + nb(await eur.innerText()));
  assert(nb(await eur.locator('.fx-unhedged-sek').innerText()) === '6900,00', 'osäkrat till bokförd kurs');
  assert(await owner.locator('.fx-warning').count() === 0, 'ingen varning utan gräns');
  const sens = owner.locator('.fx-sens tr[data-currency="EUR"]');
  await sens.locator('input[name=rate]').fill('12'); await sens.locator('input[name=limit]').fill('5000'); await sens.locator('button').click(); await owner.locator('text=Kurs och gräns för EUR är sparade').waitFor();
  await owner.goto(FX + '/valutaexponering');
  assert(nb(await eur.locator('.fx-unhedged-sek').innerText()) === '7200,00' && nb(await owner.locator('.fx-warning').innerText()).includes('7200,00kr–övergränsen5000,00kr'), 'varning över gränsen');
  assert(nb(await sens.locator('td[data-pct="10"]').innerText()) === '720,00' && nb(await sens.locator('td[data-pct="-5"]').innerText()) === '-360,00', 'känslighet');
  log('valutaexponering: kundfordran i euro, såld termin säkrar 40 %, osäkrad exponering i kronor, egen kurs och gräns med varning, känslighet för ±5 och ±10 %');

  // ================= Del 5: inköpsanalys =================
  const IA = await newCompany('Inköparna AB', 560050000);
  if (Number(day(210).slice(0, 4)) < YEAR) await addFy(IA, YEAR - 1);
  const sups = ['Stora Grossisten AB', 'Lokalvärden AB', 'Liten Kontorsbutik AB', 'Kontorsjätten AB', 'Papperslagret AB'];
  for (const n of sups) { await owner.goto(IA + '/leverantorer'); await owner.fill('input[name=name]', n); await owner.click('button:has-text("Spara leverantör")'); await owner.waitForURL(/ok=/); }
  let invNo = 0;
  const si = async (sup, account, net, d) => {
    await owner.goto(IA + '/leverantorsfakturor/ny');
    await owner.selectOption('select[name=supplier_id]', { label: sup });
    await owner.fill('input[name=invoice_number]', 'IA-' + (++invNo)); await owner.fill('input[name=invoice_date]', d); await owner.fill('input[name=due_date]', day(-30));
    await owner.fill('input[name=total]', String(net * 1.25)); await owner.locator('input[name=total]').blur(); await owner.fill('input[name=vat]', String(net * 0.25));
    await owner.fill('input[name=account_0]', String(account)); await owner.fill('input[name=amount_0]', String(net));
    await owner.click('button:has-text("Registrera och bokför")'); await owner.waitForURL(/ok=/);
  };
  for (const [d, net] of [[210, 50000], [150, 50000], [90, 50000], [30, 56000]]) await si('Stora Grossisten AB', 4010, net, day(d));
  for (const d of [100, 70, 40]) await si('Lokalvärden AB', 5010, 20000, day(d));
  await si('Liten Kontorsbutik AB', 6110, 500, day(60));
  await si('Kontorsjätten AB', 6110, 3000, day(20));
  await si('Papperslagret AB', 6110, 800, day(10));
  await owner.goto(IA + '/leverantorer/inkopsanalys');
  assert(nb(await owner.locator('.sp-total').innerText()) === '270300,00' && nb(await owner.locator('.sp-top').innerText()) === '2', 'summa och pareto: ' + nb(await owner.locator('.sp-summary').innerText()));
  assert((await owner.locator('.sp-row[data-name="Stora Grossisten AB"]').getAttribute('data-top')) === '1' && (await owner.locator('.sp-row[data-name="Kontorsjätten AB"]').getAttribute('data-top')) === '0', 'paretolistan');
  assert(nb(await owner.locator('.sp-row[data-name="Stora Grossisten AB"] .sp-share').innerText()) === '76,2%', 'andel');
  t = nb(await owner.locator('.sp-increases').innerText()); assert(t.includes('StoraGrossistenAB') && t.includes('+12%') && !t.includes('Lokalvärden'), 'prishöjning: ' + t);
  t = nb(await owner.locator('.sp-new').innerText()); assert(t.includes('PapperslagretAB') && t.includes('KontorsjättenAB') && !t.includes('StoraGrossisten'), 'nya leverantörer: ' + t);
  t = nb(await owner.locator('.sp-consolidate').innerText()); assert(t.includes('LitenKontorsbutikAB') && t.includes('3leverantörerisammakategori'), 'samordning: ' + t);
  t = nb(await owner.locator('.sp-categories').innerText()); assert(t.includes('Varorochmaterial206000,00') && t.includes('Lokaler60000,00') && t.includes('Kontorochförbrukning4300,00'), 'kategorier: ' + t);
  log('inköpsanalys: inköp per leverantör och kategori, paretolista, prishöjning på återkommande faktura, nya leverantörer och små leverantörer som kan samordnas');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 40: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
