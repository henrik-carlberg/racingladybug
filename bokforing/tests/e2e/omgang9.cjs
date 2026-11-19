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

  //@@NEXT@@
  await browser.close();
  bvServer.close(); ebServer.close();
  console.log('Omgång 9: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
