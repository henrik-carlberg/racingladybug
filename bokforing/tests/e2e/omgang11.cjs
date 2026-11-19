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

// Kivra
const kv = { got: [], status: {} };
const kvServer = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const send = (c, j) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.url === '/v1/auth') return req.headers.authorization === 'Basic ' + Buffer.from('kivra:kivrasecret').toString('base64') ? send(200, { access_token: 'kv-token', expires_in: 3600 }) : send(401, {});
    if (req.headers.authorization !== 'Bearer kv-token') return send(401, {});
    const j = b ? JSON.parse(b) : {};
    if (req.url === '/v1/tenant/tenant1/usermatch/ssn') return send(200, { list: j.list.filter((x) => x === '198112189876') });
    if (req.url === '/v1/tenant/tenant1/usermatch/vatnumber') return send(200, { list: j.list.filter((x) => x === 'SE556677889901') });
    if (req.url === '/v1/tenant/tenant1/content') { const key = 'K' + (kv.got.length + 1); kv.got.push({ key, ...j }); kv.status[key] = 'delivered'; return send(201, { key }); }
    const m = /^\/v1\/tenant\/tenant1\/content\/(K\d+)\/status$/.exec(req.url);
    if (m) return send(200, { status: kv.status[m[1]] });
    send(404, {});
  });
}).listen(3315);

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

  // ================= Del 3: Kivra och digital post =================
  await owner.goto(B + '/kunder/6');
  await owner.fill('input[name=orgnr]', '556677-8899');
  await owner.click('form button:text-is("Spara")');
  await owner.locator('text=Kunden är sparad').waitFor();
  await owner.goto(B + '/fakturor/13');
  assert(await owner.locator('.best-channel').innerText() === 'Kivra', 'Kivra föreslås: ' + await owner.locator('.send-best').innerText());
  await owner.click('.send-best button:has-text("Skicka via Kivra")');
  await owner.locator('text=Fakturan är skickad till kundens Kivra').waitFor();
  const kc = kv.got[kv.got.length - 1];
  const pdfTxt = Buffer.from(kc.files[0].data, 'base64').toString('latin1');
  assert(kc.vat_number === 'SE556677889901' && kc.type === 'invoice' && kc.payment.total_owed === '5000.00' && kc.payment.method === 'BG' && kc.files[0].content_type === 'application/pdf'
    && pdfTxt.startsWith('%PDF-') && pdfTxt.includes('(Faktura 1007)'), 'innehållet till Kivra: ' + JSON.stringify({ ...kc, files: undefined }));
  assert((await owner.locator('.kivra-status').innerText()).includes('Skickad'), 'status skickad');
  kv.status[kc.key] = 'read';
  await owner.click('.kivra-status button:has-text("Hämta status")');
  await owner.locator('.kivra-status:has-text("Öppnad av kunden")').waitFor();
  log('fakturan går till kundens Kivra som PDF med betalinformation (bankgiro, OCR); status levererad och öppnad kommer tillbaka');

  await owner.goto(B + '/kunder/6');
  await owner.selectOption('select[name=delivery]', 'email');
  await owner.click('form button:text-is("Spara")');
  await owner.locator('text=Kunden är sparad').waitFor();
  await owner.goto(B + '/fakturor/14');
  assert(await owner.locator('.best-channel').innerText() === 'E-post med länk', 'kundens val gäller');
  await owner.goto(B + '/fakturor/22');
  assert(await owner.locator('.best-channel').innerText() === 'Utskrift (post)' && (await text(owner)).includes('ingen digital kanal'), 'utan komplett e-faktura, Kivra eller e-post blir det post');
  log('kanalen väljs automatiskt (e-faktura, Kivra, e-post, post) – kundens eget val går före');

  await owner.goto(B + '/lon/2');
  await owner.click('button:has-text("Skicka lönebesked till Kivra")');
  await owner.locator('text=/1 lönebesked skickade till Kivra\\. Utan Kivra/').waitFor();
  const ps = kv.got[kv.got.length - 1];
  assert(ps.ssn === '198112189876' && ps.type === 'salary' && Buffer.from(ps.files[0].data, 'base64').toString('latin1').includes('(Lönebesked 2026-12)'.replace('ö', '\xf6')), 'lönebeskedet: ' + JSON.stringify({ ...ps, files: undefined }));
  assert((await owner.locator('.kivra-slip').count()) === 1, 'status per anställd');
  log('lönebesked skickas till de anställdas Kivra; de som saknar Kivra listas');

  // ================= Del 4: inköp med matchning =================
  await owner.goto(B + '/installningar');
  await owner.check('input[name=auto_attest_matched]');
  await owner.click('form:has(input[name=auto_attest_matched]) button:has-text("Spara")');
  await owner.locator('.flash.ok').first().waitFor();
  const M = `${B}/m/lager`;
  const pick = async (sel, sku) => owner.selectOption(sel, await owner.locator(`${sel} option:has-text("${sku} ")`).first().getAttribute('value'));
  const po = async (qty, price) => {
    await owner.goto(M + '/inkop');
    await owner.selectOption('select[name=supplier_id]', { label: 'Hyresvärden AB' });
    await pick('select[name=product_0]', 'A-200');
    await owner.fill('input[name=qty_0]', qty);
    await owner.fill('input[name=price_0]', price);
    await owner.click('button:has-text("Skapa inköpsorder")');
    await owner.locator('text=Inköpsordern är skapad').waitFor();
    await owner.click('button:has-text("Markera som skickad")');
    await owner.locator('text=markerad som skickad').waitFor();
    await owner.click('button:has-text("Registrera inleverans")');
    await owner.locator('text=Inleveransen är registrerad').waitFor();
    return owner.url().split('?')[0];
  };
  await po('7', '150');
  await owner.fill('input[name=invoice_number]', 'LF-3V-1');
  await owner.click('button:has-text("Registrera leverantörsfaktura")');
  await owner.locator('text=registrerad från inköpsordern').waitFor();
  await owner.goto(owner.url().split('?')[0]);
  t = await text(owner);
  assert(t.includes('Stämmer mot order och inleverans') && t.includes('Automatiskt (trevägsmatchning)') && !(await owner.locator('button:has-text("Attestera")').count()), 'automatisk attest: ' + t.slice(0, 1500));
  log('fakturan som stämmer mot inköpsorder och inleverans attesteras automatiskt (trevägsmatchning)');

  await po('5', '100');
  await owner.goto(B + '/leverantorsfakturor/ny');
  await owner.selectOption('select[name=supplier_id]', { label: 'Hyresvärden AB' });
  await owner.fill('input[name=invoice_number]', 'LF-3V-2');
  await owner.fill('input[name=invoice_date]', day(2));
  await owner.fill('input[name=due_date]', day(-28));
  await owner.fill('input[name=total]', '800');
  await owner.click('button:has-text("25 % moms")');
  await owner.click('button:has-text("Registrera och bokför")');
  await owner.waitForURL(/leverantorsfakturor\/\d+\?ok/);
  await owner.click('.match-po button:has-text("Matcha mot order och inleverans")');
  await owner.locator('.match-status:has-text("Beloppet avviker från ordern")').waitFor();
  assert((await owner.locator('button:has-text("Attestera")').count()) === 1, 'avvikande faktura attesteras manuellt');
  log('en faktura som avviker från ordern kopplas manuellt och måste attesteras av en person');

  await owner.goto(B + '/leverantorsavtal');
  await owner.fill('input[name=name]', 'Hyra lokal ZQ');
  await owner.selectOption('select[name=supplier_id]', { label: 'Hyresvärden AB' });
  await owner.fill('input[name=end_date]', day(-50));
  await owner.fill('input[name=notice_months]', '1');
  await owner.uncheck('input[name=auto_renew]');
  await owner.fill('input[name=monthly_cost]', '12500');
  await owner.click('button:has-text("Spara avtal")');
  await owner.locator('text=Avtalet är sparat').waitFor();
  await owner.fill('input[name=name]', 'Leasing kopiator ZQ');
  await owner.fill('input[name=end_date]', day(400));
  await owner.fill('input[name=notice_months]', '3');
  await owner.fill('input[name=renew_months]', '12');
  await owner.fill('input[name=monthly_cost]', '800');
  await owner.click('button:has-text("Spara avtal")');
  await owner.locator('text=Avtalet är sparat').waitFor();
  t = await text(owner);
  assert(/Hyra lokal ZQ.*Säg upp snart/.test(t) && /Leasing kopiator ZQ.*förlängs 12 mån i taget.*Löper/.test(t) && t.includes('13 300,00'), 'avtalsregister: ' + t.slice(0, 1500));
  const cron = async () => (await (await owner.request.get(`${BASE}/api/cron/daily`, { headers: { authorization: 'Bearer testcron' } })).json()).leverantorsavtal;
  const c1 = await cron(), c2 = await cron();
  assert(c1 === 1 && c2 === 0, 'påminnelse en gång: ' + JSON.stringify([c1, c2]));
  log('avtalsregister: sista dag att säga upp räknas fram (även efter automatisk förlängning) och den ansvarige påminns');

  await owner.goto(B + '/leverantorer');
  await owner.fill('input[name=name]', 'Telebolaget ZQ');
  await owner.fill('input[name=bankgiro]', '5050-1055');
  await owner.click('button:has-text("Spara leverantör")');
  await owner.waitForURL(/ok=/);
  for (const [no, d, amt] of [['T-1', 90, '500'], ['T-2', 60, '500'], ['T-3', 30, '500'], ['T-4', 1, '560']]) {
    await owner.goto(B + '/leverantorsfakturor/ny');
    await owner.selectOption('select[name=supplier_id]', { label: 'Telebolaget ZQ' });
    await owner.fill('input[name=invoice_number]', no);
    await owner.fill('input[name=invoice_date]', day(d));
    await owner.fill('input[name=due_date]', day(d - 30));
    await owner.fill('input[name=total]', amt);
    await owner.click('button:has-text("25 % moms")');
    await owner.click('button:has-text("Registrera och bokför")');
    await owner.waitForURL(/leverantorsfakturor\/\d+\?ok/);
  }
  await owner.goto(B + '/leverantorsavtal');
  t = await text(owner);
  assert(/Telebolaget ZQ har höjt priset med 12 %/.test(t) && t.includes('Faktura T-4: 448 kr exkl. moms mot normalt 400 kr'), 'prisbevakning: ' + t.slice(0, 1500));
  log('prisbevakning: en återkommande faktura som plötsligt blir dyrare flaggas för granskning');

  // ================= Del 5: lön del 2 =================
  await owner.goto(B + '/lon');
  await owner.fill('input[name=period]', '2026-11');
  await owner.fill('input[name=payment_date]', '2026-11-25');
  await owner.click('button:has-text("Ny lönekörning")');
  await owner.waitForURL(/lon\/\d+\?ok/);
  const runUrl = owner.url().split('?')[0];

  await owner.goto(B + '/lon/formaner');
  await owner.selectOption('select[name=employee_id]', { label: 'Anna Andersson' });
  await owner.selectOption('select[name=kind]', 'wellness');
  await owner.fill('input[name=amount]', '3000');
  await owner.fill('input[name=description]', 'Gymkort');
  await owner.selectOption('select[name=run_id]', { label: '2026-11' });
  await owner.click('button:has-text("Lägg på lönen")');
  await owner.locator('text=/2[\\s ]000 kr kvar av taket i år/').waitFor();
  await owner.selectOption('select[name=employee_id]', { label: 'Anna Andersson' });
  await owner.selectOption('select[name=kind]', 'wellness');
  await owner.fill('input[name=amount]', '2500');
  await owner.selectOption('select[name=run_id]', { label: '2026-11' });
  await owner.click('button:has-text("Lägg på lönen")');
  await owner.locator('text=/Friskvårdsbidrag ryms inte inom det skattefria taket: 2[\\s ]000 kr kvar/').waitFor();
  t = await text(owner);
  assert(/Anna Andersson 3[\s ]000,00 kvar 2[\s ]000,00/.test(t), 'användning per anställd: ' + t.slice(0, 1200));
  log('friskvårdsbidrag betalas skattefritt med lönen och stoppas när taket (5 000 kr/år) skulle överskridas');

  await owner.goto(`${B}/schema`);
  await owner.selectOption('select[name=employee_id]', { label: 'Anna Andersson' });
  await owner.fill('input[name=date]', day(2));
  await owner.fill('input[name=start]', '08:00');
  await owner.fill('input[name=end]', '16:00');
  await owner.click('button:has-text("Lägg till pass")');
  await owner.locator('text=Passet är tillagt').waitFor();
  await owner.goto(B + '/lon/flex');
  await owner.selectOption('select[name=employee_id]', { label: 'Anna Andersson' });
  await owner.fill('input[name=start]', day(3));
  await owner.click('button:has-text("Slå på flextid")');
  await owner.locator('text=Flextiden räknas från startdatumet').waitFor();
  const bal = async () => (await owner.locator('.flex-detail-balance').innerText()).trim();
  const mins = (x) => { const m = /^([+−]?)(\d+):(\d\d)$/.exec(x); return (m[1] === '−' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])); };
  const b0 = mins(await bal());
  assert((await owner.locator(`.flex-days tr:has-text("${day(2)}")`).innerText()).replace(/\s+/g, ' ').includes('8:00 0:00 −8:00'), 'pass utan stämpling ger minus: ' + (await text(owner)).slice(0, 1000));
  await owner.selectOption('select[name=kind]', 'adjust');
  await owner.fill('form:has(select[name=kind]) input[name=hours]', '10');
  await owner.fill('input[name=note]', 'Glömde stämpla – arbetade enligt schema plus övertid');
  await owner.click('form:has(select[name=kind]) button:has-text("Spara")');
  await owner.locator('text=Tidbanken är uppdaterad').waitFor();
  assert(mins(await bal()) === b0 + 600, 'efter rättning: ' + await bal());
  await owner.selectOption('form:has-text("Betala ut sparad tid") select[name=run_id]', { label: '2026-11' });
  await owner.fill('form:has-text("Betala ut sparad tid") input[name=hours]', '2');
  await owner.click('button:has-text("Lägg på lönen")');
  await owner.locator('text=/Utbetalningen \\(.* kr\\) är lagd på lönen/').waitFor();
  assert(mins(await bal()) === b0 + 480, 'utbetald: ' + await bal());
  log('flextid: schemat mot stämplad tid, rättning och utbetalning av sparad tid med lönen');

  await owner.goto(runUrl);
  await owner.waitForLoadState('networkidle');
  assert(await owner.locator('input[value^="Friskvårdsbidrag"]').count() === 1 && await owner.locator('input[value="Utbetalning flextid 2 h"]').count() === 1 && (await text(owner)).includes('/ 3 000,00'), 'raderna på lönen');
  await owner.goto(B + '/periodiseringar');
  await owner.check('.vacation-auto input[name=auto]');
  await owner.click('.vacation-auto button:has-text("Spara")');
  await owner.locator('text=Semesterlöneskulden bokförs nu automatiskt').waitFor();
  await owner.goto(runUrl);
  await owner.click('button:text-is("Bokför lönekörning")');
  await owner.locator('text=Lönekörningen är bokförd').waitFor();
  assert(/Semesterlöneskulden är justerad med -?[\d\s ]+,\d\d kr/.test(await text(owner)), 'semesterlöneskulden justeras: ' + (await text(owner)).slice(0, 800));
  log('semesterlöneskulden bokförs automatiskt per månadens sista dag när lönen bokförs');

  //@@NEXT@@
  await browser.close(); bvServer.close(); mailServer.close(); kvServer.close();
  console.log('Omgång 11: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
