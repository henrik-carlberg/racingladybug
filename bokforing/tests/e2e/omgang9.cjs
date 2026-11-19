// End-to-end, omgång 9: årshjul, verifiering av firmatecknare, betalningar från appen, egna rapporter, revisorns arbetsyta.
const { chromium } = require('playwright');
const http = require('node:http');
const crypto = require('node:crypto');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const text = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); const sel = (await page.locator('main').count()) ? 'main' : 'body'; return (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').replace(/ /g, ' '); };
const iso = (d) => d.toISOString().slice(0, 10);
/** Samma dag i månaden n månader bakåt (sista dagen om månaden är kortare) */
const monthsAgo = (n) => { const t = new Date(); const y = t.getUTCFullYear(), m = t.getUTCMonth() - n; const len = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return iso(new Date(Date.UTC(y, m, Math.min(t.getUTCDate(), len)))); };

/** Organisationsnummer med rätt kontrollsiffra */
const orgnr = (base9) => { let sum = 0; [...base9].forEach((c, i) => { let d = Number(c) * (i % 2 === 0 ? 2 : 1); sum += d > 9 ? d - 9 : d; }); return base9 + ((10 - (sum % 10)) % 10); };

async function login(browser, email, password, opts = {}) {
  const p = await (await browser.newContext(opts)).newPage();
  p.setDefaultTimeout(20000);
  await p.goto(BASE + '/login');
  await p.fill('input[name=email]', email);
  await p.fill('input[name=password]', password);
  await p.click('form button:has-text("Logga in")');
  await p.waitForURL(BASE + '/');
  return p;
}


// Fejkad Bolagsverket: företrädare och firmateckning
const bv = { alone: false };
const bvServer = http.createServer((req, res) => {
  const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (req.headers.authorization !== 'Bearer bv-info') return send(401, {});
  if (req.url === '/foretag/5560269986/foretradare') return send(200, { namn: 'Testbolaget AB', firmateckning: { antalIForening: 2, text: 'Firman tecknas av styrelsen. Två ledamöter i förening.' }, foretradare: [
    { personnummer: '198001010019', namn: 'Ägare Testsson', roller: ['Styrelseledamot', 'Verkställande direktör'], ensamFirmatecknare: bv.alone },
    { personnummer: '197505050000', namn: 'Bo Delägare', roller: ['Styrelseledamot'] },
    { personnummer: '196001010000', namn: 'Revi Sor', roller: ['Revisor'] }] });
  send(404, {});
}).listen(3311);

// Fejkad Enable Banking: betalinitiering (banken skickar tillbaka användaren direkt, som efter godkännande med BankID)
const ebp = { got: [], status: {} };
const ebServer = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (!/^Bearer .+\..+\..+$/.test(req.headers.authorization || '')) return send(401, {});
    if (req.method === 'POST' && req.url === '/payments') { const j = JSON.parse(b); const id = 'PAY-' + (ebp.got.length + 1); ebp.got.push({ id, ...j }); ebp.status[id] = ebp.next || 'ACTC'; return send(201, { payment_id: id, url: `${j.redirect_url}?state=${encodeURIComponent(j.state)}` }); }
    const m = /^\/payments\/(.+)$/.exec(req.url);
    if (m && ebp.status[m[1]]) return send(200, { payment_id: m[1], status: ebp.status[m[1]] });
    send(404, {});
  });
}).listen(3301);

(async () => {
  const browser = await chromium.launch();
  const owner = await login(browser, 'agare@example.com', 'hemligtlosen1');
  const B = `${BASE}/c/1`;
  let t;
  const today = iso(new Date()), year = today.slice(0, 4);
  const addDays = (d, n) => iso(new Date(Date.parse(d) + n * 864e5));

  // ================= Del 1: årshjul och månadshjul =================
  await owner.goto(B + '/arshjul');
  t = await text(owner);
  assert(await owner.locator('.wheel svg').count() === 1 && t.includes('Skatter och deklarationer') && t.includes('Lön') && t.includes(`${year}`), 'årshjulet visas: ' + t.slice(0, 600));
  assert(await owner.locator('.wheel-dot').count() > 5, 'aktiviteter som punkter i hjulet');
  assert((await owner.locator('.wheel svg title#wheel-title').textContent()).includes('aktiviteter'), 'hjulet har en beskrivning för skärmläsare');
  log('årshjulet visar modulernas återkommande aktiviteter i en ring per modul');

  const addAct = async (f) => {
    const form = owner.locator('form.new-activity');
    for (const [k, v] of Object.entries(f)) {
      const el = form.locator(`[name=${k}]`);
      if (await el.evaluate((e) => e.tagName) === 'SELECT') await el.selectOption(v); else await el.fill(v);
    }
    await form.locator('button:has-text("Lägg till i årshjulet")').click();
    await owner.locator(`table td:has-text("${f.title}")`).first().waitFor();
  };
  const nextYear = String(Number(year) + 1);
  await addAct({ title: 'Lönesamtal', module: 'lon', recurrence: 'yearly', day: '15', month: '3', start_date: today });
  await addAct({ title: 'Avstämning med banken', module: 'bokslut', recurrence: 'monthly', day: '5', start_date: today });
  await addAct({ title: 'Påminnelsetest', module: 'allmant', recurrence: 'once', start_date: addDays(today, 3), remind_days: '3' });
  t = await text(owner);
  assert(t.includes('Lönesamtal') && t.includes('Varje år, 15 mars') && t.includes('Avstämning med banken') && t.includes('Varje månad, dag 5'), 'egna aktiviteter listas: ' + t.slice(-1500));
  log('egna återkommande aktiviteter: varje år, varje månad och en gång, med ansvarig och påminnelse');

  await owner.goto(`${B}/arshjul?vy=lista&ar=${nextYear}`);
  t = await text(owner);
  assert(t.includes(`${nextYear}-03-15`) && t.includes('Lönesamtal') && (await owner.locator('tr.wheel-item:has-text("Avstämning med banken")').count()) === 12, 'nästa år: lönesamtal i mars och bankavstämning varje månad: ' + t.slice(0, 600));
  await owner.goto(`${B}/arshjul?vy=lista&ar=${nextYear}&m=lon`);
  t = await text(owner);
  assert(t.includes('Lönesamtal') && t.includes('Lönekörning') && (await owner.locator('tr.wheel-item:has-text("Avstämning med banken")').count()) === 0 && !t.includes('Momsdeklaration'), 'filter på modulen Lön: ' + t.slice(0, 800));
  log('listvy per år och filter per modul (bara Lön)');

  const dec = `${year}-12`;
  await owner.goto(`${B}/arshjul?vy=manad&ar=${year}&manad=12`);
  t = await text(owner);
  assert(await owner.locator('.wheel svg').count() === 1 && t.includes('december') && t.includes(`${dec}-05`), 'månadshjulet för december: ' + t.slice(0, 800));
  const row = owner.locator(`tr.wheel-item:has-text("Avstämning med banken")`).first();
  await row.locator('button:has-text("Markera klar")').click();
  await owner.locator(`tr.wheel-item.done:has-text("Avstämning med banken")`).waitFor();
  log('månadshjul med dagarna runt hjulet; ett tillfälle bockas av');

  await owner.goto(`${B}/arshjul?vy=lista&ar=${year}&m=skatt`);
  const vatRow = owner.locator('tr.wheel-item:not(.done):has-text("Momsdeklaration")').first();
  const vatTitle = (await vatRow.locator('td').nth(2).innerText()).trim();
  await vatRow.locator('button:has-text("Markera klar")').click();
  await owner.locator(`tr.wheel-item.done:has-text("${vatTitle}")`).first().waitFor();
  await owner.goto(B + '/deadlines?visa=alla');
  t = await text(owner);
  assert(!t.includes(vatTitle) || new RegExp(`Klara.*${vatTitle}`).test(t), 'samma deadline är klar i deadlinelistan');
  log('deadline som bockas av i årshjulet är också klar i deadlinelistan');

  await owner.goto(`${B}/arshjul?vy=lista`);
  await owner.click('button:has-text("kalenderlänk")');
  await owner.waitForURL(/kalender=/);
  const cal = (await owner.locator('code.calendar-url').textContent()).trim();
  const ics = await owner.request.get(cal);
  const icsText = await ics.text();
  assert(ics.status() === 200 && ics.headers()['content-type'].includes('text/calendar') && icsText.includes('BEGIN:VCALENDAR') && icsText.includes('SUMMARY:Lönesamtal (Lön)') && icsText.includes('DTSTART;VALUE=DATE:'), 'iCal: ' + icsText.slice(0, 400));
  assert((await owner.request.get(BASE + '/kalender?t=' + 'x'.repeat(32))).status() === 404, 'okänd kalenderlänk');
  await owner.click('button:has-text("Skapa ny kalenderlänk")');
  await owner.waitForFunction((old) => { const c = document.querySelector('code.calendar-url'); return c && c.textContent.trim() !== old; }, cal);
  assert((await owner.request.get(cal)).status() === 404, 'gamla länken slutar gälla');
  log('årshjulet som kalender (iCal) med personlig länk som kan bytas');

  const cron = async () => (await (await owner.request.get(`${BASE}/api/cron/daily`, { headers: { authorization: 'Bearer testcron' } })).json()).arshjul;
  assert(await cron() >= 1 && await cron() === 0, 'påminnelse skickas en gång tre dagar före');
  log('påminnelse till den ansvarige tre dagar före, bara en gång');

  // ================= Del 2: automatisk verifiering av firmatecknare =================
  await owner.goto(BASE + '/drift?bolag=556026-9986');
  await owner.click('#bolag tr:has-text("Testbolaget AB") button:has-text("Ta bort verifiering")');
  await owner.locator('#bolag tr:has-text("Testbolaget AB") .badge:has-text("Ej verifierat")').waitFor();
  await owner.goto(B + '/inlamning');
  assert((await text(owner)).includes('Verifiera bolaget med BankID'), 'länk till verifieringen när bolaget inte är verifierat');
  await owner.goto(B + '/installningar/verifiering');
  await owner.click('button:has-text("Bekräfta att jag är firmatecknare")');
  await owner.waitForURL((u) => decodeURIComponent(u.href.replace(/\+/g, ' ')).includes('Din bekräftelse är sparad'));
  t = await text(owner);
  assert(t.includes('kräver 1 till') && t.includes('Ägare Testsson (du)') && t.includes('Bo Delägare') && t.includes('Revi Sor') && t.includes('Två ledamöter i förening') && t.includes('Inte verifierat'), 'två i förening – en bekräftelse räcker inte: ' + t.slice(0, 1200));
  log('firmatecknare hämtas från Bolagsverket; när två ledamöter tecknar i förening räcker inte en bekräftelse');

  bv.alone = true;
  await owner.click('button:has-text("Bekräfta att jag är firmatecknare")');
  await owner.waitForURL((u) => decodeURIComponent(u.href.replace(/\+/g, ' ')).includes('Bolaget är verifierat'));
  t = await text(owner);
  assert(t.includes('Verifierat') && t.includes('med BankID av firmatecknare'), 'verifierat med BankID: ' + t.slice(0, 600));
  await owner.goto(BASE + '/drift?bolag=556026-9986');
  assert((await owner.locator('#bolag tr:has-text("Testbolaget AB") .badge').innerText()).includes('Verifierat'), 'syns som verifierat i driften');
  await owner.goto(B + '/inlamning');
  assert(!(await text(owner)).includes('Verifiera bolaget med BankID'), 'direktinlämning öppen igen');
  log('ensam firmatecknare som bekräftar med BankID verifierar bolaget direkt – Peppol och direktinlämning öppnas');

  await owner.goto(`${BASE}/c/2/installningar/verifiering`);
  await owner.click('button:has-text("Bekräfta att jag är innehavare")');
  await owner.waitForURL(/error=/);
  assert(decodeURIComponent(owner.url().replace(/\+/g, ' ')).includes('hör inte till innehavaren'), 'enskild firma: fel person nekas: ' + owner.url());
  log('enskild firma: bara innehavarens BankID (organisationsnumret) godtas');

  // ================= Del 3: betala direkt från appen =================
  await owner.goto(B + '/leverantorsfakturor/betalning');
  await owner.selectOption('select[name=pay_account]', { label: 'Företagskonto (1930)' });
  await owner.click('button:has-text("Betala valda via banken")');
  await owner.locator('text=Betalningen är godkänd i banken').first().waitFor();
  const req1 = ebp.got[0];
  const trs = req1.payment_request.credit_transfer_transaction;
  assert(req1.payment_type === 'BULK_DOMESTIC' && req1.aspsp.name === 'Testbanken' && req1.payment_request.debtor_account.iban === 'SE4550000000058398257466' && trs.length === 2
    && trs.some((x) => x.beneficiary.creditor_account.scheme_name === 'BGNR' && x.beneficiary.creditor_account.identification === '5551234' && x.instructed_amount.amount === '12500.00'), 'betalningen till banken: ' + JSON.stringify(req1).slice(0, 800));
  t = await text(owner);
  assert(t.includes('Betalningar via banken') && t.includes('Godkänd – genomförs') && t.includes('13 750,00'), 'betalningen listas: ' + t.slice(0, 1500));
  log('attesterade leverantörsfakturor skickas som en betalning till banken och godkänns med BankID');

  await owner.click('button:has-text("Betala valda via banken")');
  await owner.waitForURL(/error=/);
  assert(decodeURIComponent(owner.url().replace(/\+/g, ' ')).includes('ligger redan i en betalning'), 'samma faktura kan inte betalas två gånger: ' + owner.url());

  const camtOut = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
<Ntry><Amt Ccy="SEK">12500.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${today}</Dt></BookgDt><AcctSvcrRef>OUT-1</AcctSvcrRef><NtryDtls><TxDtls><RmtInf><Ustrd>BG 5551234 HYRA ZQ</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="SEK">1250.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${today}</Dt></BookgDt><AcctSvcrRef>OUT-2</AcctSvcrRef><NtryDtls><TxDtls><RmtInf><Ustrd>BG 50501055 GIRO ZQ</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`;
  await owner.goto(B + '/bank');
  const brow = owner.locator('tr:has-text("Företagskonto")').first();
  await brow.locator('input[type=file]').setInputFiles({ name: 'ut.xml', mimeType: 'application/xml', buffer: Buffer.from(camtOut) });
  await brow.locator('button:has-text("Importera")').click();
  await owner.waitForURL(/ok=/);
  ebp.status['PAY-1'] = 'ACSC';
  await owner.goto(B + '/leverantorsfakturor/betalning');
  await owner.click('button:has-text("Hämta status från banken")');
  await owner.locator('.bank-payments .badge:has-text("Genomförd och bokförd")').waitFor();
  t = await text(owner);
  assert(t.includes('Inga attesterade fakturor att betala'), 'fakturorna är betalda: ' + t.slice(0, 800));
  await owner.goto(B + '/bank/avstamning');
  t = await text(owner);
  assert(!t.includes('HYRA ZQ') && !t.includes('GIRO ZQ'), 'uttagen är avstämda mot betalningarna: ' + t.slice(0, 1500));
  log('när banken har genomfört betalningen bokförs fakturorna som betalda och uttagen stäms av automatiskt');

  await owner.goto(B + '/lon/2');
  await owner.click('button:has-text("Betala ut nettolönerna via banken")');
  await owner.waitForURL(/error=/);
  assert(decodeURIComponent(owner.url().replace(/\+/g, ' ')).includes('saknar clearing- och kontonummer'), 'anställd utan konto: ' + owner.url());
  for (const [eid, cl, acc] of [[1, '8327-9', '1234567890'], [2, '6000', '123456789'], [5, '5000', '12345678901'], [6, '3300', '1907011234']]) {
    await owner.goto(`${B}/lon/anstallda/${eid}`);
    await owner.fill('input[name=bank_clearing]', cl); await owner.fill('input[name=bank_account]', acc);
    await owner.click('form:has(input[name=first_name]) button:has-text("Spara")');
    await owner.waitForURL(/ok=/);
  }
  ebp.next = 'ACSC';
  await owner.goto(B + '/lon/2');
  await owner.click('button:has-text("Betala ut nettolönerna via banken")');
  await owner.locator('text=Betalningen är genomförd och bokförd').first().waitFor();
  const req2 = ebp.got[ebp.got.length - 1].payment_request.credit_transfer_transaction;
  assert(req2.length === 4 && req2.every((x) => x.beneficiary.creditor_account.scheme_name === 'BBAN') && req2.some((x) => x.beneficiary.creditor_account.identification === '832791234567890' && x.instructed_amount.amount === '30825.16'), 'lönerna till banken: ' + JSON.stringify(req2).slice(0, 600));
  await owner.goto(B + '/lon/2');
  assert(!(await owner.locator('button:has-text("Betala ut nettolönerna via banken")').count()) && (await text(owner)).includes('Genomförd och bokförd'), 'lönerna kan inte betalas två gånger');
  log('nettolönerna i en bokförd lönekörning betalas ut till de anställdas konton via banken');

  // ================= Del 4: egna rapporter och nyckeltal =================
  await owner.goto(B + '/rapporter/egna');
  await owner.selectOption('select[name=template]', 'kort');
  await owner.fill('input[name=name]', 'Styrelserapport');
  await owner.click('button:has-text("Skapa rapport")');
  await owner.waitForURL(/rapporter\/egna\/\d+/);
  const repUrl = owner.url().split('?')[0];
  t = await text(owner);
  assert(t.includes('Styrelserapport') && t.includes('Nettoomsättning') && t.includes('Bruttovinst') && t.includes('Rörelsemarginal %') && t.includes('samma period') && /\d+(,\d)? %/.test(t), 'rapport från mall: ' + t.slice(0, 1200));
  const cells = await owner.locator('table.report-table tr:has-text("Rörelseresultat") td.num').allInnerTexts();
  assert(cells.length === 4 && cells.every((c) => /^-?[\d ]+,\d{2}$|^–$/.test(c.replace(/\s/g, ' '))), 'rörelseresultat i år och i fjol: ' + cells.join(' | '));
  log('egen rapport från mall: kontointervall, formler, procent och jämförelse med i fjol');

  await owner.fill('input[name=label_8]', 'Kassa och bank');
  await owner.fill('input[name=value_8]', '1900-1999');
  await owner.fill('input[name=label_9]', 'Fel');
  await owner.selectOption('select[name=type_9]', 'formula');
  await owner.fill('input[name=value_9]', 'r20 + 1');
  await owner.click('button:has-text("Spara rapporten")');
  await owner.waitForURL(/error=/);
  assert(decodeURIComponent(owner.url().replace(/\+/g, ' ')).includes('Okänd rad "r20"'), 'formel mot okänd rad avvisas: ' + owner.url());
  await owner.goto(repUrl);
  await owner.fill('input[name=label_8]', 'Kassa och bank');
  await owner.fill('input[name=value_8]', '1900-1999');
  await owner.click('button:has-text("Spara rapporten")');
  await owner.locator('table.report-table tr:has-text("Kassa och bank")').waitFor();
  const x = await owner.request.get(repUrl + '/xlsx');
  assert(x.status() === 200 && x.headers()['content-type'].includes('spreadsheetml') && (await x.body()).slice(0, 2).toString() === 'PK', 'Excel');
  log('rader läggs till (saldo för balanskonton), felaktiga formler avvisas, export till Excel');

  await owner.fill('#dela input[name=label]', 'Banken');
  await owner.click('#dela button:has-text("Skapa delningslänk")');
  await owner.locator('code.share-url').waitFor();
  const shareUrl = (await owner.locator('code.share-url').textContent()).trim();
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(shareUrl);
  t = await text(anon);
  assert(t.includes('Testbolaget AB') && t.includes('Styrelserapport') && t.includes('Nettoomsättning') && t.includes('Länken gäller till') && !t.includes('Spara rapporten'), 'delad rapport utan inloggning: ' + t.slice(0, 600));
  await owner.goto(repUrl);
  await owner.click('#dela tr:has-text("Banken") button:has-text("Återkalla")');
  await owner.waitForURL(/ok=/);
  assert((await anon.goto(shareUrl)).status() === 404, 'återkallad länk fungerar inte');
  assert((await anon.goto(BASE + '/delad/' + 'x'.repeat(32))).status() === 404, 'okänd länk');
  log('rapporten delas med banken via en läsbar länk utan inloggning, som kan återkallas');

  await owner.goto(B + '/nyckeltal?roll=styrelse');
  t = await text(owner);
  assert(t.includes('Soliditet') && t.includes('Kassalikviditet') && t.includes('Rörelsemarginal') && t.includes('mot i fjol') && t.includes('procentenheter') && (await owner.locator('[data-kpi=dso]').count()) === 0, 'styrelsens nyckeltal: ' + t.slice(0, 800));
  await owner.goto(B + '/nyckeltal?roll=vd');
  assert((await owner.locator('[data-kpi=dso]').count()) === 1, 'vd:ns nyckeltal');
  await owner.goto(B + '/nyckeltal?roll=styrelse');
  await owner.click('#dela button:has-text("Skapa delningslänk")');
  await owner.locator('code.share-url').waitFor();
  await anon.goto((await owner.locator('code.share-url').textContent()).trim());
  assert((await text(anon)).includes('Soliditet'), 'delade nyckeltal');
  await owner.goto(BASE + '/nyckeltal');
  t = await text(owner);
  assert(t.includes('Testbolaget AB') && t.includes('Firma Test') && t.includes('Soliditet'), 'jämförelse mellan bolag: ' + t.slice(0, 600));
  log('nyckeltal per roll (vd, ekonomi, styrelse) med jämförelse mot i fjol, delning och jämförelse mellan bolag');

  // ================= Del 5: revisorns arbetsyta =================
  await owner.goto(B + '/revision');
  t = await text(owner);
  assert(t.includes('Ingen granskning än') && !(await owner.locator('button:has-text("Starta granskning")').count()), 'ägaren kan inte starta granskningen: ' + t.slice(0, 400));
  const rev = await login(browser, 'revisor.omg4@example.com', 'granskarlosen1');
  await rev.goto(B + '/revision');
  await rev.selectOption('select[name=fy]', { label: '2026-01-01 – 2026-12-31' });
  await rev.click('button:has-text("Starta granskning")');
  await rev.waitForURL(/revision\/\d+/);
  const revUrl = rev.url().split('?')[0];
  t = await text(rev);
  assert(t.includes('Kassa och bank') && t.includes('Kundfordringar') && t.includes('Löner och personalkostnader') && t.includes('Saldo på balansdagen'), 'kontrollpunkter per balanspost: ' + t.slice(0, 800));
  await rev.fill('input[name=materiality]', '10000');
  await rev.click('form:has(input[name=materiality]) button');
  await rev.waitForURL(/ok=/);
  const addSample = async (method, count) => {
    await rev.goto(revUrl);
    await rev.selectOption('form.new-sample select[name=method]', method);
    await rev.fill('form.new-sample input[name=count]', String(count));
    await rev.click('button:has-text("Lägg till i stickprovet")');
    await rev.waitForURL((u) => decodeURIComponent(u.href.replace(/\+/g, ' ')).includes('lades till'));
    return Number(/(\d+) verifikationer lades till/.exec(decodeURIComponent(rev.url().replace(/\+/g, ' ')))[1]);
  };
  const nAmount = await addSample('amount', 5);
  const nRandom = await addSample('random', 3);
  assert(nAmount >= 1 && nRandom >= 1, `stickprov: ${nAmount} över väsentlighet, ${nRandom} slumpmässigt`);
  assert(await addSample('random', 3) === 0, 'samma slumpmässiga urval igen ger inga dubbletter');
  t = await text(rev);
  assert(/Belopp [\d\s]+ kr ≥ 10\s000 kr/.test(t.replace(/\s/g, ' ')) && t.includes('Slumpmässigt urval'), 'urvalens orsaker: ' + t.slice(0, 1500));
  log('revisorn startar granskningen, sätter väsentlighet och tar stickprov över väsentlighet och slumpmässigt (reproducerbart)');

  const rows = rev.locator('table.samples tbody tr');
  const firstId = await rows.first().getAttribute('id');
  const firstLink = await rows.first().locator('a').first().getAttribute('href');
  await rows.first().locator('input[value=remark]').check();
  await rows.first().locator('input[name=comment]').fill('Underlag saknas för kostnaden');
  await rows.first().locator('button:has-text("Spara")').click();
  await rev.locator(`#${firstId} .badge:has-text("Anmärkning")`).waitFor();
  await rev.locator('table.samples tbody tr').nth(1).locator('input[value=ok]').check();
  await rev.locator('table.samples tbody tr').nth(1).locator('button:has-text("Spara")').click();
  await rev.locator('table.samples tbody tr').nth(1).locator('.badge:has-text("Utan anmärkning")').waitFor();
  const cp = (k) => rev.locator(`#k-${k}`);
  await cp('bank').locator('input[value=ok]').check(); await cp('bank').locator('button:has-text("Spara")').click();
  await rev.locator('#k-bank .badge:has-text("Utan anmärkning")').waitFor();
  await cp('kundfordringar').locator('input[value=remark]').check(); await cp('kundfordringar').locator('input[name=comment]').fill('Fordran på Kunden AB är äldre än ett år – bedöm som osäker');
  await cp('kundfordringar').locator('button:has-text("Spara")').click();
  await rev.locator('#k-kundfordringar .badge:has-text("Anmärkning")').waitFor();
  log('stickprov och kontrollpunkter granskas med status och kommentar');

  await rev.click('button:has-text("Skicka anmärkningar till bolaget")');
  await rev.waitForURL((u) => decodeURIComponent(u.href.replace(/\+/g, ' ')).includes('2 anmärkningar är skickade'));
  await rev.fill('textarea[name=conclusion]', 'Inga väsentliga fel.');
  await rev.click('button:has-text("Avsluta granskningen")');
  await rev.waitForURL(/error=/);
  assert(decodeURIComponent(rev.url().replace(/\+/g, ' ')).includes('Granska alla stickprov'), 'kan inte avslutas med ogranskade punkter');
  const ex = await rev.request.get(revUrl + '/export');
  assert(ex.status() === 200 && ex.headers()['content-type'].includes('spreadsheetml'), 'export till Excel');
  // Revisorn kan fortfarande inte ändra bokföringen
  await rev.goto(B + '/kunder');
  await rev.fill('input[name=name]', 'Revisorns kund');
  await rev.click('button:has-text("Spara kund")');
  await rev.waitForURL(/error=/);
  assert(decodeURIComponent(rev.url().replace(/\+/g, ' ')).includes('läsbehörighet'), 'revisorn kan inte ändra bokföringen');
  log('anmärkningar skickas till bolaget; granskningen kan inte avslutas förrän allt är granskat; export till Excel; revisorn ändrar inte bokföringen');

  await owner.goto(revUrl);
  t = await text(owner);
  assert(t.includes('Anmärkningar från revisorn') && t.includes('Underlag saknas för kostnaden') && t.includes('äldre än ett år') && !(await owner.locator('form.review').count()), 'bolaget ser anmärkningarna men kan inte granska: ' + t.slice(0, 1000));
  await owner.goto(BASE + firstLink);
  assert((await text(owner)).includes('Revisionsanmärkning: Underlag saknas för kostnaden'), 'anmärkningen syns som kommentar på verifikationen');
  const eid = revUrl.split('/').pop();
  const own = await owner.request.post(`${B}/revision/granska`, { form: { op: 'send', eid }, headers: { origin: BASE }, maxRedirects: 0 });
  assert(own.status() === 303 && decodeURIComponent(own.headers().location).includes('Bara revisorn'), 'ägaren kan inte granska: ' + own.status() + ' ' + own.headers().location);
  const forged = await rev.request.post(`${B}/revision/granska`, { form: { op: 'send', eid }, headers: { origin: 'https://evil.example' }, maxRedirects: 0 });
  assert(forged.status() === 403, 'formulär från annan webbplats avvisas: ' + forged.status());
  log('bolaget ser anmärkningarna på granskningen och som kommentar på verifikationen; bara revisorn granskar; förfalskade formulär avvisas');

  //@@NEXT@@
  await browser.close();
  bvServer.close(); ebServer.close();
  console.log('Omgång 9: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
