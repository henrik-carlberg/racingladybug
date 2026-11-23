// End-to-end, omgång 34: tidsbokning, service- och garantiärenden, konvertibler och teckningsoptioner, underkonsulter, remburser och bankgarantier.
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

  // ================= Del 1: tidsbokning =================
  const TB = await newCompany('Salong Saxen AB', 559900000);
  await owner.goto(TB + '/tidsbokning');
  await owner.fill('input[name=weekdays]', '1,2,3,4,5,6,7'); await owner.fill('input[name=no_show_pct]', '50');
  await owner.click('button:has-text("Aktivera tidsbokning")'); await owner.locator('text=Inställningarna är sparade').waitFor();
  for (const [n, m, p] of [['Klippning', '45', '500'], ['Konsultation', '30', '300']]) {
    await owner.goto(TB + '/tidsbokning');
    await owner.fill('form:has(button:has-text("Lägg upp tjänst")) input[name=name]', n); await owner.fill('input[name=minutes]', m); await owner.fill('form:has(button:has-text("Lägg upp tjänst")) input[name=price]', p);
    await owner.click('button:has-text("Lägg upp tjänst")'); await owner.locator('text=Tjänsten är upplagd').waitFor();
  }
  await owner.goto(TB + '/tidsbokning');
  const link = (await owner.locator('.bk-link code').innerText()).trim();
  const D = day(-3);
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(BASE + link + `?date=${D}`);
  const kl = guest.locator('.pb-service[data-name="Klippning"]');
  await kl.locator('select[name=time]').selectOption('10:00');
  await kl.locator('input[name=customer_name]').fill('Anna Kund'); await kl.locator('input[name=customer_email]').fill('anna@example.com');
  await kl.locator('button:has-text("Boka")').click(); await guest.locator('text=Klippning är bokad').waitFor();
  const opts = await guest.locator('.pb-service[data-name="Klippning"] select[name=time] option').allInnerTexts();
  assert(!opts.includes('10:00') && !opts.includes('10:30') && opts.includes('10:45') && opts.includes('09:15') && !opts.includes('09:30'), 'lediga tider utan krock: ' + opts.slice(0, 12).join(','));
  await guest.close();
  const staffBook = async (service, d, time, name) => {
    await owner.goto(TB + `/tidsbokning?date=${d}`);
    const f = owner.locator('form:has(button:text-is("Boka"))');
    await f.locator('select[name=service_id]').selectOption({ label: service }); await f.locator('input[name=date]').fill(d); await f.locator('input[name=time]').fill(time);
    await f.locator('input[name=customer_name]').fill(name); await f.locator('button').click();
  };
  await staffBook('Konsultation (30 min)', D, '10:15', 'Krock'); await owner.locator('text=Tiden är redan bokad').waitFor();
  await staffBook('Klippning (45 min)', day(-5), '13:00', 'Bertil Kund'); await owner.locator('text=Klippning är bokad').waitFor();
  await staffBook('Klippning (45 min)', D, '14:00', 'Cecilia Kund'); await owner.locator('text=Klippning är bokad').waitFor();
  const bk = (n) => owner.locator(`.bk-row[data-customer="${n}"]`);
  for (const n of ['Anna Kund', 'Bertil Kund', 'Cecilia Kund']) {
    await owner.goto(TB + `/tidsbokning?date=${D}`);
    await bk(n).locator('button:has-text("Förskott betalt")').click(); await owner.locator('text=är bokfört som förutbetald intäkt').waitFor();
  }
  assert(nb(await owner.locator('.bk-advance').innerText()) === '1200,00', 'tre förskott à 400 kr exkl. moms på 2420');
  await bk('Bertil Kund').locator('button:has-text("Avboka")').click(); await owner.locator('text=0,00 kr behålls, 500,00 kr betalas tillbaka').waitFor();
  await owner.goto(TB + `/tidsbokning?date=${D}`);
  await bk('Cecilia Kund').locator('button:has-text("Uteblev")').click(); await owner.locator('text=250,00 kr behålls, 250,00 kr betalas tillbaka').waitFor();
  await owner.goto(TB + `/tidsbokning?date=${D}`);
  await bk('Anna Kund').locator('button:has-text("Utförd")').click(); await owner.locator('text=Tjänsten är utförd och intäktsförd').waitFor();
  assert(nb(await owner.locator('.bk-advance').innerText()) === '0,00', 'förskotten är upplösta');
  assert(nb(await owner.locator('.bk-stats tr[data-service="Klippning"]').innerText()) === 'Klippning11750,00', 'statistik: ' + await owner.locator('.bk-stats').innerText());
  await owner.goto(TB + '/verifikationer');
  await owner.locator('tr:has-text("Uteblivet besök") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('2420') && t.includes('400,00') && t.includes('2611') && t.includes('50,00') && t.includes('200,00'), 'behållen avgift och återbetalning: ' + t.slice(0, 700));
  log('tidsbokning: publik bokningslänk med lediga tider utan krock, förskott som förutbetald intäkt med moms vid betalning, avbokning i tid, uteblivet besök med avgift, intäkt vid utförd tjänst');

  // ================= Del 2: service- och garantiärenden =================
  const SG = await newCompany('Maskinservice AB', 559910000);
  if (Number(day(10).slice(0, 4)) !== YEAR) await addFy(SG, YEAR - 1);
  await owner.goto(SG + '/kunder');
  await owner.fill('input[name=name]', 'Verkstaden AB'); await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await invoice(SG, 'Verkstaden AB', 100000, day(10));
  await owner.goto(SG + '/bokslut');
  await owner.locator(`tr:has-text("${day(10).slice(0, 4)}-01-01") a:has-text("Öppna")`).first().click(); await owner.waitForURL(/bokslut\/\d+/);
  const SGF = owner.url().split('?')[0];
  await owner.goto(SGF + '/avsattningar');
  await owner.fill('.add-provision input[name=description]', 'Garanti maskiner');
  await owner.click('button:has-text("Lägg upp avsättning")'); await owner.locator('text=Avsättningen är upplagd').waitFor();
  const gp = owner.locator('details.provision[data-desc="Garanti maskiner"]');
  await gp.locator('summary').click(); await gp.locator('.warranty input[name=rate_pct]').fill('2');
  await gp.locator('.warranty button').click(); await owner.locator('text=Garantiavsättningen är ökad till 2 000,00 kr').waitFor();
  const openCase = async (item, months) => {
    await owner.goto(SG + '/service');
    await owner.selectOption('form:has(button:has-text("Registrera ärende")) select[name=customer_id]', { label: 'Verkstaden AB' });
    await owner.selectOption('select[name=invoice_id]', { index: 1 });
    await owner.fill('input[name=item]', item); await owner.fill('input[name=warranty_months]', months); await owner.fill('input[name=fault]', 'Läcker olja');
    await owner.selectOption('select[name=cause]', 'material');
    await owner.click('button:has-text("Registrera ärende")'); await owner.locator(`text=Ärende`).first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await openCase('Hydraulpump', '12'); assert(t.includes('inomgarantin'), 'inom garantin: ' + t);
  const sc = (item) => owner.locator(`.sc-row[data-item="${item}"][data-status="open"]`);
  for (const [k, d, q, p] of [['labor', 'Felsökning och byte', '2', '600'], ['material', 'Packning', '1', '300']]) {
    await owner.goto(SG + '/service');
    const f = sc('Hydraulpump').locator('form:has(button:has-text("Lägg till"))');
    await f.locator('select[name=kind]').selectOption(k); await f.locator('input[name=description]').fill(d); await f.locator('input[name=quantity]').fill(q); await f.locator('input[name=unit_price]').fill(p);
    await f.locator('button').click(); await owner.locator('text=Raden är tillagd').waitFor();
  }
  await owner.goto(SG + '/service');
  await sc('Hydraulpump').locator('button:has-text("Avsluta ärendet")').click(); await owner.locator('text=Garantiärendet är avslutat').waitFor();
  t = nb(await owner.locator('.flash').first().innerText()); assert(t.includes('kostnad1500,00kr') && t.includes('1500,00krurgarantiavsättningen'), 'garantikostnad ur avsättningen: ' + t);
  t = await openCase('Kompressor', '0'); assert(t.includes('utanförgarantin'), 'utanför garantin: ' + t);
  await owner.goto(SG + '/service');
  const f2 = sc('Kompressor').locator('form:has(button:has-text("Lägg till"))');
  await f2.locator('input[name=description]').fill('Service'); await f2.locator('input[name=unit_price]').fill('800'); await f2.locator('button').click(); await owner.locator('text=Raden är tillagd').waitFor();
  await owner.goto(SG + '/service');
  await sc('Kompressor').locator('button:has-text("Avsluta ärendet")').click(); await owner.waitForURL(/fakturor\/\d+\?ok/);
  t = nb(await text(owner)); assert(t.includes('Arbete:Service') && t.includes('1000,00'), 'servicefaktura: ' + t.slice(0, 900));
  await owner.goto(SG + '/service');
  assert(nb(await owner.locator('.sc-rate').innerText()) === '1,5%', 'förslag 1 500 / 100 000: ' + await owner.locator('.sc-rate').innerText());
  assert(nb(await owner.locator('.sc-items tr[data-item="Hydraulpump"]').innerText()) === 'Hydraulpump111500,00Materialfel', 'per vara');
  await owner.goto(SGF + '/avsattningar');
  assert(nb(await owner.locator('.prov-balance').first().innerText()) === '500,00', 'kvar i garantiavsättningen');
  log('service och garanti: garanti från fakturadatum, arbete och material ur garantiavsättningen 2220, service utanför garantin som faktura, förslag till avsättning och statistik per vara');

  // ================= Del 3: konvertibler och teckningsoptioner =================
  const KV = await newCompany('Tillväxtbolaget AB', 559920000);
  if (Number(day(73).slice(0, 4)) !== YEAR) await addFy(KV, YEAR - 1);
  await owner.goto(KV + '/aktiebok');
  await owner.fill('input[name=share_capital]', '25000'); await owner.fill('input[name=date]', day(200));
  await owner.fill('input[name=name_0]', 'Grundare Gun'); await owner.fill('input[name=id_0]', '19800101-0019'); await owner.fill('input[name=shares_0]', '1000');
  await owner.click('button:has-text("Lägg upp aktieboken")'); await owner.locator('text=Aktieboken är upplagd').waitFor();
  const inst = async (f) => {
    await owner.goto(KV + '/aktiebok/instrument');
    await owner.selectOption('select[name=kind]', f.kind);
    for (const k of ['holder_name', 'amount', 'strike', 'shares', 'interest_pct', 'issued_on', 'expires_on']) await owner.fill(`input[name=${k}]`, f[k] ?? '');
    await owner.click('button:has-text("Registrera")'); await owner.locator('text=Instrumentet är registrerat').waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await inst({ kind: 'convertible', holder_name: 'Investor AB', amount: '100000', strike: '50', interest_pct: '5', issued_on: day(73), expires_on: `${YEAR + 3}-12-31` });
  assert(t.includes('2000aktier'), 'konvertibel 100 000 / 50 kr: ' + t);
  t = await inst({ kind: 'warrant', holder_name: 'VD Vera', amount: '2000', strike: '40', shares: '100', issued_on: day(10), expires_on: `${YEAR + 3}-06-30` });
  assert(t.includes('100aktier'), 'optioner');
  assert(nb(await owner.locator('.si-dilution tr[data-name="Grundare Gun"] .si-diluted').innerText()) === '32,3%', 'utspädning före konvertering: ' + await owner.locator('.si-dilution').innerText());
  const si = (h) => owner.locator(`.si-row[data-holder="${h}"]`);
  await si('Investor AB').locator('button:has-text("Periodisera ränta")').click(); await owner.locator('text=Upplupen ränta 1 000,00 kr är bokförd').waitFor();
  await si('Investor AB').locator('button:has-text("Konvertera till aktier")').click(); await owner.locator('text=2000 nya aktier (nr 1001–3000)').waitFor();
  t = nb(await owner.locator('.flash').first().innerText()); assert(t.includes('ökatmed50000,00kr'), 'aktiekapital 2 000 × 25 kr: ' + t);
  await si('VD Vera').locator('button:has-text("Teckna aktier")').click(); await owner.locator('text=100 nya aktier (nr 3001–3100)').waitFor();
  assert(nb(await owner.locator('.si-dilution tr[data-name="Investor AB"]').innerText()).includes('64,5%') && nb(await owner.locator('.si-dilution tr[data-name="VD Vera"]').innerText()).includes('3,2%'), 'ägarandelar efter konvertering och teckning');
  await owner.goto(KV + '/aktiebok');
  t = nb(await text(owner)); assert(t.includes('77500,00') && t.includes('InvestorAB') && t.includes('1001–3000'), 'aktiebok: ' + t.slice(0, 1200));
  await owner.goto(KV + '/verifikationer');
  await owner.locator('tr:has-text("Konvertering: 2000 aktier") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('2320') && t.includes('100000,00') && t.includes('2081') && t.includes('2097'), 'konvertering 2320/2081/2097: ' + t.slice(0, 700));
  log('konvertibler och optioner: konvertibelt lån 2320 med periodiserad ränta, optionspremie till fritt eget kapital, konvertering och teckning till nya aktier i aktieboken, utspädning');

  // ================= Del 4: underkonsulter =================
  const UK = await newCompany('Konsultmäklaren AB', 559930000);
  await owner.goto(UK + '/leverantorer');
  await owner.fill('input[name=name]', 'Saras Konsult AB'); await owner.click('button:has-text("Spara leverantör")'); await owner.waitForURL(/ok=/);
  await owner.goto(UK + '/kunder');
  await owner.fill('input[name=name]', 'Storkund AB'); await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  await owner.goto(UK + '/underkonsulter');
  await owner.fill('input[name=consultant]', 'Sara Konsult'); await owner.fill('form:has(button:has-text("Lägg upp uppdrag")) input[name=name]', 'Systemutveckling');
  await owner.fill('input[name=cost_rate]', '800'); await owner.fill('input[name=markup_pct]', '25');
  await owner.click('button:has-text("Lägg upp uppdrag")'); await owner.locator('text=Uppdraget är upplagt').waitFor();
  const ua = () => owner.locator('.sk-assignment[data-consultant="Sara Konsult"]');
  assert((await ua().innerText()).includes('kund 1 000,00 kr/tim (påslag 25 %)') || nb(await ua().innerText()).includes('kund1000,00kr/tim(påslag25%)'), 'kundpris med påslag');
  for (const [p, hrs] of [[`${YEAR}-01`, '100'], [`${YEAR}-02`, '80']]) {
    await owner.goto(UK + '/underkonsulter');
    await ua().locator('input[name=period]').fill(p); await ua().locator('input[name=hours]').fill(hrs);
    await ua().locator('button:has-text("Registrera tid")').click(); await owner.locator('text=Tiden är registrerad').waitFor();
  }
  await owner.goto(UK + '/underkonsulter');
  await ua().locator(`.sk-period[data-period="${YEAR}-01"] button:has-text("Vidarefakturera")`).click(); await owner.waitForURL(/fakturor\/\d+\?ok/);
  t = nb(await text(owner)); assert(t.includes('Systemutveckling–SaraKonsult') && t.includes('100000,00') && t.includes('125000,00'), 'vidarefakturering 100 tim × 1 000 kr: ' + t.slice(0, 900));
  await owner.click('button:has-text("Bokför faktura")'); await owner.locator('text=Fakturan är bokförd').waitFor();
  await owner.goto(UK + '/leverantorsfakturor/ny');
  await owner.selectOption('select[name=supplier_id]', { label: 'Saras Konsult AB' });
  await owner.fill('input[name=invoice_number]', 'SK-1'); await owner.fill('input[name=invoice_date]', day(3)); await owner.fill('input[name=due_date]', day(-27));
  await owner.fill('input[name=total]', '105000'); await owner.locator('input[name=total]').blur(); await owner.fill('input[name=vat]', '21000');
  await owner.fill('input[name=account_0]', '4600'); await owner.fill('input[name=amount_0]', '84000');
  await owner.click('button:has-text("Registrera och bokför")'); await owner.waitForURL(/ok=/);
  await owner.goto(UK + '/underkonsulter');
  await ua().locator(`.sk-period[data-period="${YEAR}-01"] button:has-text("Stäm av")`).click(); await owner.locator('text=Fakturan motsvarar 105 timmar – 5 timmar mer än rapporterat').waitFor();
  assert(nb(await ua().locator('.sk-revenue').innerText()) === '100000,00' && nb(await ua().locator('.sk-cost').innerText()) === '84000,00' && nb(await ua().locator('.sk-margin').innerText()) === '16000,00', 'marginal per uppdrag');
  assert(nb(await ua().locator('.sk-warning').innerText()).includes('5timmarmer'), 'varning för mer fakturerad tid');
  log('underkonsulter: kundpris med påslag, vidarefakturering av rapporterad tid, avstämning mot underkonsultens faktura, marginal och varning för ofakturerad tid');

  // ================= Del 5: remburser och bankgarantier =================
  const RB = await newCompany('Importören AB', 559940000);
  const tf = async (f) => {
    await owner.goto(RB + '/remburser');
    const cf = owner.locator('form:has(button:text-is("Registrera"))');
    await cf.locator('select[name=kind]').selectOption(f.kind);
    for (const k of ['counterparty', 'reference', 'amount', 'currency', 'amount_sek', 'blocked', 'expires_on']) await cf.locator(`input[name=${k}]`).fill(f[k] ?? (k === 'currency' ? 'SEK' : ''));
    await cf.locator('button:text-is("Registrera")').click(); await owner.locator('text=Registrerat').waitFor().catch(async () => { throw new Error('remburs: ' + (await text(owner)).slice(0, 400)); });
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await tf({ kind: 'lc_import', counterparty: 'Exportören GmbH', reference: 'LC-77', amount: '50000', currency: 'EUR', amount_sek: '575000', blocked: '100000', expires_on: day(-20) });
  assert(t.includes('100000,00krspärrademedelsomställdsäkerhet'), 'spärrade medel: ' + t);
  t = await tf({ kind: 'guarantee_given', counterparty: 'Hyresvärden AB', reference: 'BG-1', amount: '200000', expires_on: `${YEAR + 2}-06-30` });
  assert(t.includes('200000,00krsomeventualförpliktelse'), 'ställd garanti: ' + t);
  assert(nb(await owner.locator('.tf-guarantees').innerText()) === '200000,00' && nb(await owner.locator('.tf-blocked').innerText()) === '100000,00' && nb(await owner.locator('.tf-expiring').innerText()) === '1', 'översikt');
  const lc = () => owner.locator('.tf-row[data-counterparty="Exportören GmbH"]');
  assert(await lc().locator('.tf-doc').count() === 5 && (await lc().locator('.tf-soon').innerText()).includes('20 dagar kvar'), 'dokumentkrav och påminnelse');
  await lc().locator('button:has-text("Utnyttjad")').click(); await owner.locator('text=Alla dokument enligt rembursvillkoren är inte klara').waitFor();
  for (let i = 0; i < 5; i++) { await owner.goto(RB + '/remburser'); await lc().locator('.tf-doc').nth(i).click(); await owner.waitForURL(/ok=/); }
  await owner.locator('text=Alla dokument är klara').waitFor();
  await lc().locator('input[name=amount]').fill('1500'); await lc().locator('button:has-text("Bokför avgift")').click(); await owner.locator('text=Bankavgiften 1 500,00 kr är bokförd').waitFor();
  await lc().locator('button:has-text("Utnyttjad")').click(); await owner.locator('text=Utnyttjad – åtagandet har upphört').waitFor();
  assert(nb(await owner.locator('.tf-blocked').innerText()) === '0,00' && await owner.locator('.tf-row[data-status="utilized"]').count() === 1, 'spärren upphör');
  await owner.goto(RB + '/bokslut');
  await owner.locator(`tr:has-text("${YEAR}-01-01") a:has-text("Öppna")`).first().click(); await owner.waitForURL(/bokslut\/\d+/);
  await owner.goto(owner.url().split('?')[0] + '/avsattningar');
  t = nb(await text(owner)); assert(t.includes('BankgarantiBG-1tillHyresvärdenAB') && t.includes('200000,00'), 'eventualförpliktelse i bokslutet: ' + t.slice(0, 1500));
  await owner.goto(RB + '/verifikationer');
  await owner.locator('tr:has-text("Bankavgift importremburs") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('6570') && t.includes('1500,00'), 'bankavgift 6570: ' + t.slice(0, 500));
  log('remburser och bankgarantier: dokumentkrav som checklista, påminnelse före utgång, bankavgifter, spärrade medel som ställd säkerhet och ställd garanti som eventualförpliktelse');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 34: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
