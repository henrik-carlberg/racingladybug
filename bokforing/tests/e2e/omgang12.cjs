// End-to-end, omgång 12: aktiebok, klimatbokföring, lån och finansiering, moms för e-handel inom EU, koncerninterna flöden.
const { chromium } = require('playwright');
const http = require('node:http');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const text = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); const sel = (await page.locator('main').count()) ? 'main' : 'body'; return (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').replace(/ /g, ' '); };
const iso = (d) => d.toISOString().slice(0, 10);
const day = (n) => iso(new Date(Date.now() - n * 864e5));

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

// Finansiär (factoring)
const fin = { offers: {} };
const finServer = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const send = (c, j) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.headers.authorization !== 'Bearer fact-key') return send(401, {});
    if (req.method === 'POST' && req.url === '/offers') { const j = JSON.parse(b); const id = 'F' + (Object.keys(fin.offers).length + 1); const fee = Math.round(j.invoice.amount * 0.03);
      fin.offers[id] = { id, status: 'offered', advance: j.invoice.amount - fee, fee, req: j }; return send(201, fin.offers[id]); }
    const m = /^\/offers\/(F\d+)(\/accept)?$/.exec(req.url);
    if (m && fin.offers[m[1]]) { if (m[2]) fin.offers[m[1]].status = 'accepted'; return send(200, fin.offers[m[1]]); }
    send(404, {});
  });
}).listen(3316);

(async () => {
  const browser = await chromium.launch();
  const owner = await login(browser, 'agare@example.com', 'hemligtlosen1');
  const B = `${BASE}/c/1`;
  let t;

  // ================= Del 1: aktiebok och ägarfrågor =================
  await owner.goto(B + '/aktiebok');
  await owner.fill('input[name=share_capital]', '25000');
  await owner.fill('input[name=date]', '2026-01-01');
  await owner.fill('input[name=name_0]', 'Ägare Testsson'); await owner.fill('input[name=id_0]', '19800101-0019'); await owner.fill('input[name=shares_0]', '600');
  await owner.fill('input[name=name_1]', 'Bo Delägare'); await owner.fill('input[name=id_1]', '19770303-0408'); await owner.fill('input[name=shares_1]', '400');
  await owner.click('button:has-text("Lägg upp aktieboken")');
  await owner.locator('text=Aktieboken är upplagd').waitFor();
  t = await text(owner);
  assert(t.includes('25 000,00') && /Ägare Testsson.*1–600.*600.*60 %/.test(t) && /Bo Delägare.*601–1000.*400.*40 %/.test(t) && t.includes('Kvotvärde 25,00'), 'aktiebok: ' + t.slice(0, 1500));
  log('aktiebok med aktienummer, kapital- och röstandel och kvotvärde');

  await owner.selectOption('select[name=from]', { label: 'Ägare Testsson (600 st)' });
  await owner.fill('form:has(select[name=from]) input[name=shares]', '100');
  await owner.fill('input[name=to_name]', 'Investerare Ida');
  await owner.fill('input[name=to_id]', '19900101-1239');
  await owner.fill('input[name=price]', '50000');
  await owner.click('button:has-text("För in överlåtelsen")');
  await owner.locator('text=Överlåtelsen är införd i aktieboken').waitFor();
  t = await text(owner);
  assert(/Ägare Testsson.*101–600.*500.*50 %/.test(t) && /Investerare Ida.*1–100.*100.*10 %/.test(t) && t.includes('Ägare Testsson överlät 100 B-aktier (nr 1–100) till Investerare Ida för 50 000,00 kr'), 'överlåtelse: ' + t.slice(0, 2000));
  await owner.goto(B + '/agare');
  assert(/Ägare Testsson · 50 %/.test(await text(owner)), 'K10-ägarnas andel följer aktieboken: ' + (await text(owner)).slice(0, 1200));
  log('överlåtelse flyttar aktienummer till köparen och ägarandelen för K10 uppdateras');

  await owner.goto(B + '/aktiebok');
  await owner.fill('input[name=new_shares]', '100');
  await owner.fill('form:has(input[name=new_shares]) input[name=price]', '500');
  await owner.click('button:has-text("Besluta om nyemission")');
  await owner.locator('text=Beslutet om nyemission är skickat för signering').waitFor();
  const issue = owner.locator('.issue[data-status=decided]');
  assert((await issue.innerText()).replace(/\s+/g, ' ').includes('Totalt 50 000,00 kr: aktiekapital 2 500,00 kr, överkurs 47 500,00 kr'), 'emissionen: ' + await issue.innerText());
  for (const [n, id, c] of [['Investerare Ida', '19900101-1239', '60'], ['Ny Ägare AB', '556677-8899', '40']]) {
    await owner.fill('.issue input[name=name]', n); await owner.fill('.issue input[name=holder_id]', id); await owner.fill('.issue input[name=shares]', c);
    await owner.click('.issue button:has-text("För in teckning")');
    await owner.locator('text=Teckningen är införd').waitFor();
  }
  await owner.click('.issue button:has-text("Bokför inbetalningen")');
  await owner.locator('text=Inbetalningen är bokförd').waitFor();
  t = await text(owner);
  assert(t.includes('Underlag till Bolagsverket') && t.includes('ökar från 25 000,00 kr till 27 500,00 kr') && t.includes('från 1000 till 1100'), 'underlag: ' + t.slice(0, 2500));
  await owner.click('.issue button:has-text("Registrerad – uppdatera aktieboken")');
  await owner.locator('text=Emissionen är registrerad').waitFor();
  t = await text(owner);
  assert(t.includes('27 500,00') && /1[\s ]100/.test(t) && /Ny Ägare AB.*1061–1100.*40/.test(t) && /Investerare Ida.*1–100, 1001–1060.*160/.test(t), 'efter registrering: ' + t.slice(0, 2500));
  await owner.goto(B + '/dokument');
  assert((await text(owner)).includes('Beslut om nyemission'), 'protokollet finns för signering');
  log('nyemission: beslut med protokoll för e-signering, teckning, inbetalning bokförd (2082/2097), underlag till Bolagsverket och registrering (2081, nya aktienummer)');

  await owner.goto(B + '/aktiebok');
  await owner.fill('input[name=present]', 'Ägare Testsson, Bo Delägare');
  await owner.fill('textarea[name=items]', 'Mötet öppnades\nStyrelsen beslutade att teckna leasingavtal för bil\nMötet avslutades');
  await owner.fill('input[name=sname_0]', 'Bo Delägare'); await owner.fill('input[name=semail_0]', 'bo.delagare@example.com');
  await owner.click('button:has-text("Skicka för e-signering")');
  await owner.locator('text=Protokollet är skickat för e-signering').waitFor();
  log('styrelseprotokoll skickas för e-signering');

  // ================= Del 2: klimatbokföring =================
  await owner.goto(B + '/klimat');
  const ton = async (sel) => Number((await owner.locator(sel).innerText()).replace(/\s| /g, '').replace('ton', '').replace(',', '.'));
  const tot0 = await ton('.climate-total');
  const s1 = await ton('[data-scope="1"]'), s2 = await ton('[data-scope="2"]'), s3 = await ton('[data-scope="3"]');
  assert(tot0 > 0 && Math.abs(tot0 - (s1 + s2 + s3)) < 0.21, 'totalt = scope 1+2+3: ' + [tot0, s1, s2, s3]);
  t = await text(owner);
  assert(t.includes('Största källorna') && /Schablon på [\d\s ]+ kr/.test(t) && t.includes('Per månad'), 'rapport: ' + t.slice(0, 1500));
  log('utsläpp räknas fram ur bokföringen per kategori och scope 1–3, med trend per månad');

  await owner.selectOption('select[name=kind]', 'diesel_l');
  await owner.fill('input[name=quantity]', '500');
  await owner.fill('input[name=note]', 'Tankning enligt kort');
  await owner.click('form:has(select[name=kind]) button:has-text("Spara")');
  await owner.locator('text=Mängden är sparad').waitFor();
  t = await text(owner);
  assert(/Diesel 1 Mängd 1[\s ]300/.test(t), 'exakt mängd: ' + t.slice(0, 2000));
  assert(!t.includes('Drivmedel till egna fordon 1 Schablon'), 'schablonen för drivmedel ersatt');
  const tot1 = await ton('.climate-total');
  const csv = await (await owner.request.get(`${B}/klimat/csv?ar=${day(0).slice(0, 4)}`)).text();
  assert(csv.includes('Kategori;Scope;Källa;Kostnad (kr);kg CO2e') && csv.includes('"Diesel";1;Mängd;0,00;1300'), 'csv: ' + csv.slice(0, 600));
  await owner.click('summary:has-text("Faktorer per kategori")');
  await owner.fill('input[aria-label="Faktor Inköp av varor och material"]', '0');
  await owner.click('form:has(input[aria-label="Faktor Inköp av varor och material"]) button');
  await owner.locator('text=Faktorn är sparad').waitFor();
  assert(await ton('.climate-total') <= tot1, 'egen faktor används');
  log('exakta mängder (liter, kWh) ersätter schablonen, egna faktorer per kategori och underlag som CSV');

  // ================= Del 3: lån och finansiering =================
  const camt = (rows) => `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>${rows.map(([amt, d, ref, txt]) =>
    `<Ntry><Amt Ccy="SEK">${amt}</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${d}</Dt></BookgDt><AcctSvcrRef>${ref}</AcctSvcrRef><NtryDtls><TxDtls><RmtInf><Ustrd>${txt}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`).join('')}</Stmt></BkToCstmrStmt></Document>`;
  await owner.goto(B + '/bank');
  const brow = owner.locator('tr:has-text("Företagskonto")').first();
  await brow.locator('input[type=file]').setInputFiles({ name: 'lan.xml', mimeType: 'application/xml', buffer: Buffer.from(camt([['10600.00', day(40), 'LAN-1', 'LAN ZQ AMORTERING']])) });
  await brow.locator('button:has-text("Importera")').click();
  await owner.locator('.flash.ok').first().waitFor();
  await owner.goto(B + '/finansiering');
  await owner.fill('input[name=name]', 'Företagslån ZQ');
  await owner.fill('input[name=lender]', 'Banken');
  await owner.fill('input[name=principal]', '120000');
  await owner.fill('form:has(input[name=principal]) input[name=rate_pct]', '6');
  await owner.fill('input[name=months]', '12');
  await owner.fill('input[name=first_date]', day(40));
  await owner.fill('input[name=loan_account]', '2355');
  await owner.fill('input[name=disbursed_on]', day(70));
  await owner.click('button:has-text("Lägg upp lånet")');
  await owner.locator('text=Lånet är upplagt med amorteringsplan').waitFor();
  t = await text(owner);
  assert(/Företagslån ZQ.*6 %.*120[\s ]000,00/.test(t) && t.includes('10 600,00') && t.includes('Det finns förfallna betalningar'), 'lånet och planen: ' + t.slice(0, 2000));
  await owner.click('button:has-text("Bokför nu")');
  await owner.locator('text=/[12] betalningar bokförda/').waitFor();
  t = await text(owner);
  assert(/Konto 2355: bokfört [\d\s ]+,00, enligt lånen [\d\s ]+,00 ✅ stämmer/.test(t), 'avstämning mot lånekontot: ' + t.slice(0, 2000));
  await owner.goto(B + '/bank/avstamning');
  assert(!(await text(owner)).includes('LAN ZQ AMORTERING'), 'uttaget är avstämt mot lånebetalningen');
  log('lån med amorteringsplan: betalningar bokförs automatiskt (ränta 8410, amortering), kopplas till banken och stäms av mot lånekontot');

  await owner.goto(B + '/finansiering');
  await owner.fill('form:has(button:has-text("Ändra räntan")) input[name=rate_pct]', '3');
  await owner.click('button:has-text("Ändra räntan")');
  await owner.locator('text=Räntan är ändrad').waitFor();
  const open = owner.locator('.loan-rows tbody tr:not(:has(a))').first();
  assert((await open.innerText()).replace(/\s+/g, ' ').includes(' 250,00 10 000,00 10 250,00'), 'ny ränta på resten av planen: ' + await open.innerText());
  await owner.fill('form:has(input[name=credit_limit]) input[name=name]', 'Checkräkning ZQ');
  await owner.selectOption('select[name=bank_account_id]', { label: 'Företagskonto' });
  await owner.fill('input[name=credit_limit]', '50000');
  await owner.click('form:has(input[name=credit_limit]) button:has-text("Lägg till")');
  await owner.locator('text=Krediten är tillagd').waitFor();
  assert(/Checkräkning ZQ.*gräns 50 000,00.*utnyttjat/.test(await text(owner)), 'kreditöversikt');
  log('räntan ändras för resten av planen; krediter med gräns och utnyttjande');

  await owner.click('tr.fact-row[data-invoice="1007"] button:has-text("Begär erbjudande")');
  await owner.locator('text=/Erbjudande: 4[\\s ]850,00 kr utbetalt, avgift 150,00 kr/').waitFor();
  await owner.click('tr.fact-row[data-invoice="1007"] button:has-text("Sälj fakturan")');
  await owner.locator('text=Erbjudandet är accepterat').waitFor();
  const fo = Object.values(fin.offers).find((o) => o.req.invoice.number === 1007);
  assert(fo && fo.req.debtor.name === 'Lind Design AB' && fo.req.invoice.amount === 500000, 'begäran till finansiären: ' + JSON.stringify(fo && fo.req));
  fo.status = 'funded';
  const crypto = require('node:crypto');
  const body = JSON.stringify({ id: fo.id });
  assert((await owner.request.post(BASE + '/api/factoring/webhook', { data: body, headers: { 'content-type': 'application/json', 'x-factoring-signature': 'sha256=bad' } })).status() === 401, 'osignerad');
  assert((await owner.request.post(BASE + '/api/factoring/webhook', { data: body, headers: { 'content-type': 'application/json', 'x-factoring-signature': 'sha256=' + crypto.createHmac('sha256', 'factsecret').update(body).digest('hex') } })).status() === 200, 'signerad');
  await owner.goto(B + '/finansiering');
  assert((await owner.locator('tr.fact-row[data-invoice="1007"]').innerText()).includes('Såld och utbetald'), 'såld');
  await owner.goto(B + '/fakturor/13');
  assert(/Betald/.test(await text(owner)), 'kundfakturan är betald via finansiären');
  log('factoring: erbjudande från finansiären, försäljning och utbetalning bokförd (1689, 6064) när finansiären bekräftar');

  // ================= Del 4: moms för e-handel inom EU =================
  await owner.goto(B + '/kunder');
  await owner.fill('input[name=name]', 'Privatkund i Tyskland ZQ');
  await owner.fill('input[name=country]', 'DE');
  await owner.fill('input[name=email]', 'kunde@example.de');
  await owner.click('form button:has-text("Spara")');
  await owner.locator('text=Kunden är sparad').waitFor();
  await owner.goto(B + '/rapporter/eu');
  await owner.check('.oss-setting input[name=oss]');
  await owner.click('.oss-setting button:has-text("Spara")');
  await owner.locator('text=Bolaget är registrerat för OSS').waitFor();
  await owner.goto(B + '/fakturor/ny');
  await owner.selectOption('select[name=customer_id]', { label: 'Privatkund i Tyskland ZQ' });
  await owner.fill('input[name=invoice_date]', day(1));
  const row = owner.locator('tbody tr').first();
  await row.locator('td:nth-child(1) input').fill('Webbshop: vara');
  await row.locator('td:nth-child(2) input').fill('2');
  await row.locator('td:nth-child(3) input').fill('st');
  await row.locator('td:nth-child(4) input').fill('500');
  await owner.click('button:has-text("Spara utkast")');
  await owner.waitForURL(/fakturor\/\d+\?ok/);
  await owner.click('button:has-text("Bokför faktura")');
  await owner.locator('text=klar att skicka').first().waitFor();
  const doc = (await owner.locator('.doc').innerText()).replace(/\s+/g, ' ');
  assert(doc.includes('19 %') && doc.includes('190,00') && doc.includes('1 190,00'), 'fakturan har tysk moms: ' + doc.slice(0, 1200));
  await owner.goto(BASE + await owner.locator('main a[href*="/verifikationer/"]').first().getAttribute('href'));
  await owner.waitForURL(/verifikationer\/\d+/);
  t = await text(owner);
  assert(t.includes('2670') && t.includes('3109') && !t.includes('2611'), 'bokförd på OSS-konton: ' + t.slice(0, 1200));
  log('faktura till privatperson i annat EU-land får köparlandets moms (19 % i Tyskland) och bokförs på OSS-konton, inte i den svenska momsen');

  const yq = `${day(1).slice(0, 4)}-Q${Math.floor((Number(day(1).slice(5, 7)) - 1) / 3) + 1}`;
  await owner.goto(`${B}/rapporter/eu?period=${yq}`);
  t = await text(owner);
  assert(/DE 19 % 1[\s ]000,00 190,00/.test(t) && /Lämna och betala senast \d{4}-\d{2}-\d{2}/.test(t), 'OSS-deklarationen: ' + t.slice(0, 2500));
  const oc = await (await owner.request.get(`${B}/rapporter/eu/oss?period=${yq}`)).text();
  assert(oc.includes('DE;19;1000,00;190,00'), 'OSS-underlag: ' + oc);
  const ps = await (await owner.request.get(`${B}/rapporter/eu/skv?period=${yq}`)).text();
  assert(ps.startsWith('SKV574008;\r\nSE556026998601;') , 'PS-fil: ' + ps.slice(0, 200));
  await owner.goto(`${B}/rapporter/moms?from=${day(1)}&to=${day(1)}`);
  assert(!(await text(owner)).includes('190'), 'OSS-momsen ingår inte i den svenska momsdeklarationen');
  log('OSS-deklaration per land och skattesats med förfallodag och underlag; periodisk sammanställning som fil till Skatteverket');

  // ================= Del 5: koncerninterna flöden =================
  await owner.goto(B + '/kunder');
  await owner.fill('input[name=name]', 'Firma Test (koncern)');
  await owner.fill('input[name=orgnr]', '811218-9876');
  await owner.click('form button:has-text("Spara")');
  await owner.locator('text=Kunden är sparad').waitFor();
  await owner.goto(B + '/fakturor/ny');
  await owner.selectOption('select[name=customer_id]', { label: 'Firma Test (koncern)' });
  await owner.fill('input[name=invoice_date]', day(1));
  const ir = owner.locator('tbody tr').first();
  await ir.locator('td:nth-child(1) input').fill('Konsulttjänster inom koncernen');
  await ir.locator('td:nth-child(2) input').fill('1');
  await ir.locator('td:nth-child(3) input').fill('st');
  await ir.locator('td:nth-child(4) input').fill('2000');
  await owner.click('button:has-text("Spara utkast")');
  await owner.waitForURL(/fakturor\/\d+\?ok/);
  await owner.click('button:has-text("Bokför faktura")');
  await owner.locator('text=klar att skicka').first().waitFor();
  const icNo = ((await owner.locator('h1').first().innerText()).match(/\d{3,}/) || [])[0];
  await owner.goto(`${BASE}/c/2/leverantorsfakturor`);
  t = await text(owner);
  assert(t.includes('Testbolaget AB') && t.includes(icNo) && t.includes('2 500,00'), 'speglad hos mottagaren: ' + icNo + ' ' + t.slice(0, 1500));
  log('kundfaktura till ett koncernbolag blir automatiskt en leverantörsfaktura hos mottagaren');

  await owner.goto(B + '/koncerninternt');
  t = await text(owner);
  assert(/Firma Test.*2[\s ]500,00 2[\s ]500,00.*Stämmer/.test(t), 'mellanhavanden: ' + t.slice(0, 1500));
  assert((await owner.locator('.ic-elim tr:has-text("Speglad")').count()) >= 1 && /Att eliminera \(koncernintern försäljning\) 2[\s ]000,00/.test(t), 'elimineringsunderlag: ' + t.slice(0, 2500));
  log('mellanhavanden stäms av åt båda håll och elimineringsunderlaget visar den koncerninterna försäljningen');

  const addCh = async (kind, f) => {
    await owner.selectOption('select[name=target_company_id]', { label: 'Firma Test' });
    await owner.selectOption('select[name=kind]', kind);
    for (const [k, v] of Object.entries(f)) await owner.fill(`form:has(select[name=kind]) input[name=${k}]`, v);
    await owner.click('button:has-text("Lägg upp avgift")');
    await owner.locator('text=Koncernavgiften är upplagd').waitFor();
  };
  await addCh('management_fee', { amount: '1000' });
  await addCh('interest', { principal: '1200000', rate_pct: '5' });
  await owner.click('button:has-text("Fakturera förfallna månader nu")');
  await owner.locator('text=2 koncernfakturor är skapade och speglade hos mottagarna').waitFor();
  t = await text(owner);
  assert(/Firma Test.*8[\s ]750,00 8[\s ]750,00.*Stämmer/.test(t), 'mellanhavanden efter avgifter (2 500 + 1 250 + 5 000): ' + t.slice(0, 1500));
  await owner.click('button:has-text("Fakturera förfallna månader nu")');
  await owner.locator('text=0 koncernfakturor är skapade').waitFor();
  log('management fee och koncernränta faktureras varje månad och speglas hos mottagaren – en gång per månad');

  //@@NEXT@@
  await browser.close(); mailServer.close(); finServer.close();
  console.log('Omgång 12: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
