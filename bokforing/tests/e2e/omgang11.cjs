// End-to-end, omgång 11: kundkännedom, bedrägeriskydd, Kivra, inköp med matchning, lön del 2.
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

// Bolagsverket: verkliga huvudmän
const bvServer = http.createServer((req, res) => {
  const send = (c, j) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (req.headers.authorization !== 'Bearer bv-info') return send(401, {});
  if (req.url === '/foretag/5560269986/verkliga-huvudman') return send(200, { huvudman: [{ namn: 'Ägare Testsson', fodelsear: 1980, omfattning: 'Mer än 75 %', grund: 'Ägande' }] });
  send(404, {});
}).listen(3311);

// E-post (Resend)
const mails = [];
const mailServer = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { mails.push(JSON.parse(b)); } catch {} res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"m1"}'); }); }).listen(3303);

(async () => {
  const browser = await chromium.launch();
  const owner = await login(browser, 'agare@example.com', 'hemligtlosen1');
  const byra = await login(browser, 'bo.byra.omg7@example.com', 'byralosen123');
  const B = `${BASE}/c/1`;
  let t;

  // ================= Del 1: byrån och penningtvättslagen =================
  await byra.goto(BASE + '/byra');
  t = await text(byra);
  assert(t.includes('saknar aktuell kundkännedom') && t.includes('Kundkännedom'), 'byrån ser att kundkännedom saknas: ' + t.slice(0, 1200));
  await byra.click('tr:has-text("Testbolaget AB") .kyc-cell a');
  await byra.locator('.kyc-status:has-text("Saknas")').waitFor();
  await byra.click('button:has-text("Spara bedömning")');
  await byra.selectOption('select[name=pep]', 'no');
  await byra.selectOption('select[name=identified]', 'bankid');
  await byra.fill('input[name=purpose]', 'Löpande bokföring och bokslut');
  await byra.click('button:has-text("Spara bedömning")');
  await byra.locator('text=Hämta verkliga huvudmän från Bolagsverket först').waitFor();
  await byra.click('button:has-text("Hämta från Bolagsverket")');
  await byra.locator('text=1 verkliga huvudmän hämtade från Bolagsverket').waitFor();
  assert((await text(byra)).includes('Mer än 75 %'), 'huvudmännen visas');
  log('verkliga huvudmän hämtas från Bolagsverkets register; bedömning kräver dem');

  await byra.check('input[name=factor][value=cash]');
  await byra.selectOption('select[name=pep]', 'no');
  await byra.selectOption('select[name=identified]', 'bankid');
  await byra.fill('input[name=purpose]', 'Löpande bokföring och bokslut');
  await byra.click('button:has-text("Spara bedömning")');
  await byra.locator('text=/normal risk, görs om senast \\d{4}-\\d{2}-\\d{2}/').waitFor();
  t = await text(byra);
  assert(t.includes('Aktuell') && /Risk Normal/.test(t), 'bedömd: ' + t.slice(0, 800));
  await byra.selectOption('select[name=pep]', 'yes');
  await byra.fill('input[name=pep_details]', 'Styrelseledamot är kommunalråd');
  await byra.click('button:has-text("Spara bedömning")');
  await byra.locator('text=/hög risk/').waitFor();
  assert((await byra.locator('.owners').count()) === 1 && (await text(byra)).includes('Historik'), 'historik');
  log('riskbedömning med faktorer och PEP (alltid hög risk) ger datum för ny bedömning; historiken sparas');

  await byra.goto(`${BASE}/byra/kyc?f=2&c=1`);
  await byra.fill('input[name=fee]', '2 500 kr per månad exkl. moms');
  await byra.check('input[name=service][value=payroll]');
  await byra.click('button:has-text("Skicka uppdragsbrev för e-signering")');
  await byra.locator('.flash.error, .flash:has-text("Uppdragsbrevet är skickat")').first().waitFor();
  assert((await text(byra)).includes('Uppdragsbrevet är skickat för signering'), 'uppdragsbrev: ' + (await text(byra)).slice(0, 600));
  assert((await text(byra)).includes('Väntar på signering'), 'uppdragsbrevet väntar');
  await owner.goto(B + '/dokument');
  t = await text(owner);
  assert(t.includes('Uppdragsbrev Byråsson Redovisning – Testbolaget AB'), 'kunden ser uppdragsbrevet: ' + t.slice(0, 1200));
  await byra.goto(BASE + '/byra');
  assert(!(await byra.locator('.kyc-banner').count()) && (await byra.locator('tr:has-text("Testbolaget AB") .kyc-cell .badge:has-text("Aktuell")').count()) === 1, 'översikten aktuell');
  const other = await login(browser, 'kim.byra@example.com', 'konsultlosen12');
  const r = await other.goto(`${BASE}/byra/kyc?f=2&c=1`);
  assert(r.status() === 404, 'annan byrå kommer inte åt kundkännedomen');
  log('uppdragsbrev skickas för e-signering till kundens ägare; översikten visar status; andra byråer kommer inte åt uppgifterna');

  // ================= Del 2: bedrägeri- och felskydd =================
  const att = await login(browser, 'attest1.omg4@example.com', 'attestlosen11');
  await owner.goto(B + '/leverantorer/5');
  await owner.fill('input[name=bankgiro]', '5402-9999');
  await owner.click('form button:text-is("Spara")');
  await owner.locator('text=De nya bankuppgifterna gäller först när en annan person har godkänt dem').waitFor();
  await owner.goto(B + '/leverantorer/5');
  assert(await owner.inputValue('input[name=bankgiro]') === '5402-9616', 'gamla bankgirot gäller tills vidare');
  await owner.goto(B + '/kontroll');
  await owner.locator('.bank-change:has-text("Kontorsvaror Norden AB")').waitFor();
  t = await text(owner);
  assert(t.includes('5402-9616') && t.includes('5402-9999') && t.includes('Ring leverantören'), 'ändringen visas: ' + t.slice(0, 1200));
  await owner.check('.bank-change input[name=verified]');
  await owner.click('.bank-change button:has-text("Godkänn")');
  await owner.locator('text=En annan person än den som ändrade bankuppgifterna måste godkänna').waitFor();
  log('nya bankuppgifter hos en leverantör gäller inte direkt; den som ändrade får inte själv godkänna');

  await owner.goto(B + '/leverantorsfakturor/ny');
  const regSI = async (no, total) => {
    await owner.goto(B + '/leverantorsfakturor/ny');
    await owner.selectOption('select[name=supplier_id]', { label: 'Kontorsvaror Norden AB' });
    await owner.fill('input[name=invoice_number]', no);
    await owner.fill('input[name=invoice_date]', day(3));
    await owner.fill('input[name=due_date]', day(-20));
    await owner.fill('input[name=total]', total);
    await owner.click('button:has-text("25 % moms")');
    await owner.click('button:has-text("Registrera och bokför")');
    await owner.waitForURL(/leverantorsfakturor\/\d+\?ok/);
    return owner.url().match(/leverantorsfakturor\/(\d+)/)[1];
  };
  const si1 = await regSI('K-777', '3125');
  const si2 = await regSI('0K777', '3125');
  await att.goto(`${B}/leverantorsfakturor/${si2}`);
  await att.click('button:has-text("Attestera")');
  await att.locator('text=Fakturan kan inte attesteras: kan vara en dubblett').waitFor();
  await att.goto(`${B}/leverantorsfakturor/${si1}`);
  await att.click('button:has-text("Attestera")');
  await att.locator('text=attesterad').first().waitFor();
  log('en möjlig dubblett (samma fakturanummer med annan formatering) spärras från attest och betalning');

  await att.goto(B + '/kontroll');
  await att.fill('.bank-change input[name=comment]', 'Ringde Kontorsvaror på 08-555 00 00, bekräftat');
  await att.click('.bank-change button:has-text("Godkänn")');
  await att.locator('text=De nya bankuppgifterna är godkända').waitFor();
  await att.goto(B + '/leverantorer/5');
  assert(await att.inputValue('input[name=bankgiro]') === '5402-9999', 'nya bankgirot gäller efter godkännande');
  await att.goto(B + '/kontroll');
  const dup = att.locator('.alert[data-kind=duplicate]:has-text("0K777")');
  await dup.locator('input[name=comment]').fill('Kontrollerat: leverantören har skickat samma faktura två gånger');
  await dup.locator('button:has-text("Det är ett fel")').click();
  await att.locator('text=Varningen är markerad som ett verkligt problem').waitFor();
  t = await text(att);
  assert(t.includes('Hanterade') && t.includes('Kontrollerad (Anna Attest)') && t.includes('Fel/avslagen'), 'historik: ' + t.slice(0, 2000));
  await att.goto(`${B}/leverantorsfakturor/${si2}`);
  await att.click('button:has-text("Attestera")');
  await att.locator('text=Fakturan kan inte attesteras: kan vara en dubblett').waitFor();
  log('en annan person med attesträtt godkänner bankbytet efter kontroll; granskade varningar sparas med kommentar');

  const camt = (rows) => `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>${rows.map(([amt, d, ref, txt]) =>
    `<Ntry><Amt Ccy="SEK">${amt}</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${d}</Dt></BookgDt><AcctSvcrRef>${ref}</AcctSvcrRef><NtryDtls><TxDtls><RmtInf><Ustrd>${txt}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`).join('')}</Stmt></BkToCstmrStmt></Document>`;
  await owner.goto(B + '/bank');
  const brow = owner.locator('tr:has-text("Företagskonto")').first();
  await brow.locator('input[type=file]').setInputFiles({ name: 'ut.xml', mimeType: 'application/xml', buffer: Buffer.from(camt([
    ['1000.00', day(9), 'U-1', 'STADBOLAGET XK'], ['1000.00', day(8), 'U-2', 'STADBOLAGET XK'], ['1000.00', day(7), 'U-3', 'STADBOLAGET XK'],
    ['9000.00', day(6), 'U-4', 'STADBOLAGET XK'], ['15000.00', day(5), 'U-5', 'OKAND MOTTAGARE XK']])) });
  await brow.locator('button:has-text("Importera")').click();
  await owner.locator('.flash.ok').first().waitFor();
  await owner.goto(B + '/kontroll');
  t = await text(owner);
  assert(/Ovanligt stort belopp 9[\s ]000 kr till STADBOLAGET XK/.test(t) && t.includes('9 gånger det vanliga beloppet') && /Ny mottagare 15[\s ]000 kr till OKAND MOTTAGARE XK/.test(t), 'ovanliga utbetalningar: ' + t.slice(0, 2500));
  log('ovanliga utbetalningar flaggas: mycket större belopp än vanligt till samma mottagare och större belopp till en ny mottagare');

  //@@NEXT@@
  await browser.close(); bvServer.close(); mailServer.close();
  console.log('Omgång 11: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
