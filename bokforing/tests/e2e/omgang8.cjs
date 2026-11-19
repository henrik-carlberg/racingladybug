// End-to-end, omgång 8: inlämning till myndigheter, Peppol, lön på djupet, kassor och utbetalningar, valuta och koncern.
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


// Fejkad Skatteverket: OAuth-token, inlämning och status
const skv = { got: [] };
const skvServer = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.url === '/oauth/token') return req.headers.authorization === 'Basic ' + Buffer.from('skv-test:skv-secret').toString('base64') ? send(200, { access_token: 'tok-1' }) : send(401, {});
    if (req.headers.authorization !== 'Bearer tok-1') return send(401, {});
    if (req.method === 'POST' && req.url === '/moms/v1/deklarationer') { skv.got.push({ kind: 'moms', ...JSON.parse(b) }); return send(201, { id: 'M-77', status: 'mottagen' }); }
    if (req.method === 'GET' && req.url === '/moms/v1/deklarationer/M-77') return send(200, { id: 'M-77', status: 'godkänd', kvittensnummer: 'SKV-MOMS-4711' });
    if (req.method === 'POST' && req.url === '/agi/v1/deklarationer') { skv.got.push({ kind: 'agi', ...JSON.parse(b) }); return send(201, { id: 'A-9', status: 'godkänd', kvittensnummer: 'SKV-AGI-0815' }); }
    send(404, {});
  });
}).listen(3308);

// Fejkad Peppol-åtkomstpunkt: SMP-uppslag, skicka, status
const ap = { sent: [], status: {} };
const apServer = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.headers.authorization !== 'Bearer ap-test') return send(401, {});
    const u = decodeURIComponent(req.url);
    if (u === '/participants/0007:5567071234') return send(200, { name: 'Regionen AB', documentTypes: ['urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1'] });
    if (u.startsWith('/participants/')) return send(404, {});
    if (req.method === 'POST' && u === '/documents') { const j = JSON.parse(b); const id = 'D-' + (ap.sent.length + 1); ap.sent.push({ id, ...j }); ap.status[id] = 'in_transit'; return send(202, { id, status: 'accepted_for_transport' }); }
    const m = /^\/documents\/(.+)$/.exec(u);
    if (m && ap.status[m[1]]) return send(200, { status: ap.status[m[1]] });
    send(404, {});
  });
}).listen(3309);
const apHook = (event) => { const body = JSON.stringify(event); const ts = String(Math.floor(Date.now() / 1000));
  return fetch(BASE + '/api/peppol/inbound', { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-peppol-timestamp': ts, 'x-peppol-signature': crypto.createHmac('sha256', 'apsecret').update(`${ts}.${body}`).digest('hex') } }); };

// Fejkade kortterminaler och betalleverantörer
const todayIso = new Date().toISOString().slice(0, 10), yIso = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const pp = { calls: [] };
const ppServer = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); pp.calls.push(u.pathname);
  const send = (j, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (u.pathname === '/zettle/token') return send({ access_token: 'zt' });
  if (u.pathname.startsWith('/zettle/') && req.headers.authorization !== 'Bearer zt') return send({}, 401);
  if (u.pathname === '/zettle/purchases/v2') return send({ purchases: u.searchParams.get('startDate').startsWith(yIso) ? [
    { amount: 25000, products: [{ unitPrice: 12500, quantity: '2', vatPercentage: 25 }] }, { amount: 11200, products: [{ unitPrice: 11200, quantity: '1', vatPercentage: 12 }] }] : [] });
  if (u.pathname === '/zettle/v2/accounts/liquid/transactions') return send({ data: [{ timestamp: todayIso + 'T05:00:00Z', amount: -35548, originatorTransactionType: 'PAYOUT' }, { timestamp: todayIso + 'T01:00:00Z', amount: -652, originatorTransactionType: 'PAYMENT_FEE' }] });
  if (u.pathname.startsWith('/stripe/') && req.headers.authorization !== 'Bearer sk_live_kund') return send({}, 401);
  if (u.pathname === '/stripe/v1/payouts') return send({ data: [{ id: 'po_77', amount: 94000, arrival_date: Math.floor(Date.parse(todayIso) / 1000) + 3600, currency: 'sek', status: 'paid' }] });
  if (u.pathname === '/stripe/v1/balance_transactions') return send({ data: [{ type: 'charge', amount: 100000, fee: 3000 }, { type: 'refund', amount: -3000, fee: 0 }, { type: 'payout', amount: -94000, fee: 0 }] });
  if (u.pathname === '/klarna/settlements/v1/payouts') return send({ payouts: [{ payout_date: todayIso + 'T00:00:00Z', payment_reference: 'KL-1', currency_code: 'SEK', totals: { sale_amount: 50000, fee_amount: 1500, settlement_amount: 49000 } }] });
  send({}, 404);
}).listen(3310);

(async () => {
  const browser = await chromium.launch();
  const owner = await login(browser, 'agare@example.com', 'hemligtlosen1');
  const B = `${BASE}/c/1`;
  let t;
  const flash = async (p) => { await p.locator('.flash, [role=status], [role=alert]').first().waitFor(); return text(p); };

  // Senast avslutade kvartal (deadlinen syns då som kommande eller försenad)
  const now = new Date(); let qy = now.getUTCFullYear(), qn = Math.floor(now.getUTCMonth() / 3); if (qn === 0) { qn = 4; qy--; }
  const qFrom = `${qy}-${String(qn * 3 - 2).padStart(2, '0')}-01`, qTo = iso(new Date(Date.UTC(qy, qn * 3, 0)));
  // ================= Del 1: inlämning till Skatteverket och Bolagsverket =================
  await owner.goto(`${B}/rapporter/moms?from=${qFrom}&to=${qTo}`);
  await owner.click('button:has-text("Förbered momsdeklaration")');
  await owner.waitForURL(/\/inlamning\?/);
  t = await flash(owner);
  assert(t.includes('Momsdeklaration') && t.includes('Förberedd') && t.includes('Direktinlämning är uppsatt för Skatteverket'), 'momsdeklaration förberedd: ' + t.slice(0, 600));
  const eskd = await owner.request.get(BASE + (await owner.locator(`a:has-text("moms_${qTo.slice(0, 7)}")`).getAttribute('href')));
  assert(eskd.status() === 200 && /iso-8859-1/i.test(eskd.headers()['content-type']), 'eSKD-fil: ' + eskd.status());
  const eskdText = (await eskd.body()).toString('latin1');
  assert(eskdText.includes(`<Period>${qTo.slice(0, 4)}${qTo.slice(5, 7)}</Period>`) && eskdText.includes('<OrgNr>16556026-9986</OrgNr>') && eskdText.includes('<MomsBetala>'), 'eSKD-innehåll: ' + eskdText.slice(0, 400));
  log('momsdeklaration förbereds som eSKD-fil från momsrapporten');

  await owner.click('section.filing:has-text("Momsdeklaration") button:has-text("Lämna in direkt")');
  await owner.locator('section.filing:has-text("Momsdeklaration") .badge:has-text("väntar på besked")').waitFor();
  t = await flash(owner);
  assert(t.includes('väntar på besked'), 'inlämnad moms: ' + t.slice(0, 400));
  assert(skv.got[0]?.kind === 'moms' && skv.got[0].organisationsnummer === '5560269986' && Buffer.from(skv.got[0].innehall, 'base64').toString('latin1') === eskdText, 'Skatteverket fick filen');
  await owner.click('section.filing:has-text("Momsdeklaration") button:has-text("Hämta status")');
  await owner.locator('section.filing:has-text("Momsdeklaration") .badge:has-text("Godkänd")').waitFor();
  t = await text(owner);
  assert(t.includes('SKV-MOMS-4711'), 'kvittens: ' + t.slice(0, 600));
  log('momsdeklaration lämnas in direkt, status hämtas, kvittens sparas och deadlinen bockas av');

  await owner.goto(`${B}/rapporter/moms?from=${qFrom}&to=${qTo}`);
  await owner.click('button:has-text("Förbered momsdeklaration")');
  await owner.waitForURL(/error=/);
  assert(decodeURIComponent(owner.url()).includes('redan inlämnad'), 'samma period kan inte lämnas igen: ' + owner.url());
  log('en redan inlämnad period kan inte lämnas in igen');

  await owner.goto(B + '/lon/1');
  await owner.click('button:has-text("Förbered AGI")');
  await owner.waitForURL(/\/inlamning\?/);
  await owner.click('section.filing:has-text("Arbetsgivardeklaration") button:has-text("Lämna in direkt")');
  await owner.locator('section.filing:has-text("Arbetsgivardeklaration") .badge:has-text("Godkänd")').waitFor();
  t = await text(owner);
  assert(t.includes('SKV-AGI-0815') && skv.got[1]?.kind === 'agi' && Buffer.from(skv.got[1].innehall, 'base64').toString().includes('Skatteverket'), 'AGI inlämnad: ' + t.slice(0, 600));
  log('arbetsgivardeklaration från en bokförd lönekörning lämnas in och godkänns direkt');

  await owner.goto(B + '/bokslut/1/arsredovisning');
  await owner.click('button:has-text("Förbered inlämning till Bolagsverket")');
  await owner.waitForURL(/\/inlamning\?/);
  const ar = owner.locator('section.filing:has-text("Årsredovisning")');
  assert(!(await ar.locator('button:has-text("Lämna in direkt")').count()), 'Bolagsverket är inte uppsatt – ingen direktknapp');
  const ix = await owner.request.get(BASE + (await ar.locator('a:has-text("arsredovisning_2026")').getAttribute('href')));
  assert(ix.status() === 200 && (await ix.text()).includes('ix:'), 'iXBRL-fil');
  await ar.locator('input[name=receipt]').fill('BV-2027-123');
  await ar.locator('button:has-text("Registrera som inlämnad")').click();
  await owner.locator('section.filing:has-text("Årsredovisning") .badge:has-text("Godkänd")').waitFor();
  t = await text(owner);
  assert(t.includes('BV-2027-123') && t.includes('deadlinen är klar'), 'kvittens från Bolagsverket: ' + t.slice(0, 500));
  log('årsredovisningen laddas ner som iXBRL och registreras med kvittens från Bolagsverkets e-tjänst');

  await owner.goto(BASE + '/drift/installningar');
  t = await text(owner);
  assert(t.includes('Skatteverket (moms och AGI)') && t.includes('Bolagsverket (årsredovisning)'), 'integrationerna listas');
  await owner.locator('section#skv button:has-text("Testa")').click();
  await owner.waitForURL(/(ok|error)=/);
  assert(decodeURIComponent(owner.url()).includes('Inloggningen hos Skatteverket fungerar'), 'test av Skatteverket: ' + owner.url());
  log('Skatteverket och Bolagsverket finns bland integrationerna och inloggningen kan testas');

  // ================= Del 2: Peppol via åtkomstpunkt =================
  await owner.goto(B + '/integrationer');
  await owner.fill('input[name=name]', 'Omgång 8');
  for (const sc of ['sales:write', 'purchasing:write']) await owner.check(`input[name=scopes][value="${sc}"]`);
  await owner.click('button:has-text("Skapa API-nyckel")');
  const token = (await owner.locator('.flash.ok code').textContent({ timeout: 10000 })).trim();
  const api = async (method, path, body) => { const r = await fetch(`${BASE}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json() }; };

  const reg = await api('POST', '/customers', { name: 'Regionen AB', orgnr: '556707-1234', address: 'Storgatan 1', postal_code: '111 22', city: 'Stockholm' });
  const none = await api('POST', '/customers', { name: 'Lilla Firman', orgnr: '556000-0000' });
  await owner.goto(`${B}/kunder/${none.json.id}`);
  await owner.click('button:has-text("Slå upp i Peppol")');
  await owner.waitForURL(/ok=/);
  assert(decodeURIComponent(owner.url()).includes('finns inte i Peppol'), 'okänd mottagare: ' + owner.url());
  await owner.goto(`${B}/kunder/${reg.json.id}`);
  await owner.click('button:has-text("Slå upp i Peppol")');
  await owner.waitForURL(/ok=/);
  assert(decodeURIComponent(owner.url()).includes('tar emot e-faktura via Peppol (0007:5567071234)'), 'uppslag: ' + owner.url());
  assert(await owner.inputValue('input[name=peppol_id]') === '0007:5567071234', 'Peppol-ID sparat på kunden');
  log('mottagare slås upp i Peppol: okänd kund ger besked, registrerad kund får Peppol-ID sparat');

  const pinv = await api('POST', '/invoices', { customer_id: reg.json.id, invoice_date: iso(new Date()), your_reference: 'Inköp 42', book: true, lines: [{ description: 'Utbildning', quantity: 1, unit: 'st', unit_price: 800000, vat_rate: 25 }] });
  await owner.goto(`${B}/fakturor/${pinv.json.id}`);
  await owner.click('button:has-text("Skicka via Peppol")');
  await owner.locator('.peppol-status:has-text("väntar på leveranskvittens")').waitFor();
  const doc = Buffer.from(ap.sent[0].document, 'base64').toString();
  assert(ap.sent[0].receiver === '0007:5567071234' && ap.sent[0].sender === '0007:5560269986' && doc.includes('<cbc:BuyerReference>Inköp 42</cbc:BuyerReference>') && doc.includes('10000.00'), 'skickad till åtkomstpunkten');
  assert(!(await owner.locator('button:has-text("Skicka via Peppol")').count()), 'kan inte skickas två gånger');
  ap.status['D-1'] = 'delivered';
  await owner.click('button:has-text("Hämta leveransstatus")');
  await owner.locator('.peppol-status:has-text("levererad till mottagaren")').waitFor();
  log('faktura skickas via åtkomstpunkten och leveransstatus hämtas (skickad → levererad)');

  // Statusändring via webhook (misslyckad leverans) och mottagen e-faktura
  const pinv2 = await api('POST', '/invoices', { customer_id: reg.json.id, invoice_date: iso(new Date()), your_reference: 'Inköp 43', book: true, lines: [{ description: 'Kurs', quantity: 1, unit: 'st', unit_price: 100000, vat_rate: 25 }] });
  await owner.goto(`${B}/fakturor/${pinv2.json.id}`);
  await owner.click('button:has-text("Skicka via Peppol")');
  await owner.locator('.peppol-status').waitFor();
  assert((await apHook({ type: 'document.status', id: 'D-2', status: 'failed', message: 'Mottagaren avvisade: fel referens' })).status === 200, 'statuswebhook');
  await owner.reload();
  assert((await text(owner)).includes('misslyckades') && (await owner.locator('button:has-text("Skicka via Peppol")').count()) === 1, 'misslyckad leverans kan skickas om');
  const bad = await fetch(BASE + '/api/peppol/inbound', { method: 'POST', body: '{"type":"document.status","id":"D-1","status":"failed"}', headers: { 'x-peppol-timestamp': String(Math.floor(Date.now() / 1000)), 'x-peppol-signature': 'ab'.repeat(32) } });
  assert(bad.status === 401, 'osignerad webhook avvisas');
  log('leveransstatus via signerad webhook; misslyckad leverans kan skickas om, osignerad webhook avvisas');

  const ubl = `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:ID>LF-9001</cbc:ID><cbc:IssueDate>${iso(new Date())}</cbc:IssueDate><cbc:DueDate>${iso(new Date(Date.now() + 30 * 864e5))}</cbc:DueDate><cbc:DocumentCurrencyCode>SEK</cbc:DocumentCurrencyCode>
<cac:AccountingSupplierParty><cac:Party><cbc:EndpointID schemeID="0007">5569998887</cbc:EndpointID><cac:PartyName><cbc:Name>Kontorsvaror Peppol AB</cbc:Name></cac:PartyName><cac:PartyLegalEntity><cbc:RegistrationName>Kontorsvaror Peppol AB</cbc:RegistrationName><cbc:CompanyID>5569998887</cbc:CompanyID></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
<cac:AccountingCustomerParty><cac:Party><cbc:EndpointID schemeID="0007">5560269986</cbc:EndpointID></cac:Party></cac:AccountingCustomerParty>
<cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode><cbc:PaymentID>900123</cbc:PaymentID><cac:PayeeFinancialAccount><cbc:ID>5050-1055</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
<cac:TaxTotal><cbc:TaxAmount currencyID="SEK">250.00</cbc:TaxAmount></cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="SEK">1000.00</cbc:TaxExclusiveAmount><cbc:PayableAmount currencyID="SEK">1250.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
<cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="EA">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="SEK">1000.00</cbc:LineExtensionAmount><cac:Item><cbc:Name>Papper</cbc:Name></cac:Item></cac:InvoiceLine></Invoice>`;
  const inEvt = { type: 'document.received', id: 'IN-1', sender: '0007:5569998887', receiver: '0007:5560269986', document: Buffer.from(ubl).toString('base64') };
  assert((await (await apHook(inEvt)).json()).received === 1, 'mottagen e-faktura');
  assert((await (await apHook(inEvt)).json()).received === 0, 'samma e-faktura tas bara emot en gång');
  await owner.goto(B + '/peppol');
  t = await text(owner);
  assert(t.includes('Mottagen') && t.includes('0007:5569998887') && t.includes('Levererad') && t.includes('Misslyckad') && t.includes('0007:5560269986'), 'Peppol-loggen: ' + t.slice(0, 1200));
  await owner.click('a:has-text("Leverantörsfaktura")');
  await owner.waitForURL(/inkorg\/\d+/);
  t = await text(owner);
  assert(t.includes('E-faktura via Peppol från 0007:5569998887') && await owner.inputValue('input[name=invoice_number]') === 'LF-9001', 'mottagen e-faktura tolkad i inkorgen: ' + t.slice(0, 600));
  log('e-faktura tas emot via Peppol, hamnar tolkad i inkorgen och visas i Peppol-loggen');

  // ================= Del 3: lön på djupet =================
  const pnr = (base) => { let sum = 0; [...base.slice(2)].forEach((c, i) => { let d = Number(c) * (i % 2 === 0 ? 2 : 1); sum += d > 9 ? d - 9 : d; }); return `${base.slice(0, 8)}-${base.slice(8)}${(10 - (sum % 10)) % 10}`; };
  await owner.goto(B + '/lon/avtal');
  await owner.fill('form:has(button:has-text("Lägg till avtal")) input[name=name]', 'Teknikavtalet');
  await owner.fill('form:has(button:has-text("Lägg till avtal")) input[name=ob_evening]', '30');
  await owner.fill('form:has(button:has-text("Lägg till avtal")) input[name=oncall_weekend]', '40');
  await owner.fill('form:has(button:has-text("Lägg till avtal")) input[name=vacation_supplement]', '0,8');
  await owner.fill('form:has(button:has-text("Lägg till avtal")) input[name=fora_insurance_percent]', '0,6');
  await owner.click('button:has-text("Lägg till avtal")');
  await owner.waitForURL(/ok=/);
  assert((await text(owner)).includes('Teknikavtalet') && (await text(owner)).includes('semestertillägg 0,8 %'), 'avtalet sparat');
  log('kollektivavtal med OB, övertid, beredskap, semestertillägg och Fora-försäkringar sparat');

  const addEmp = async (first, last, p, salary, plan, extra = {}) => {
    await owner.goto(B + '/lon/anstallda');
    const f = owner.locator('form:has(input[name=first_name])');
    await f.locator('input[name=first_name]').fill(first); await f.locator('input[name=last_name]').fill(last);
    await f.locator('input[name=personal_number]').fill(p); await f.locator('input[name=monthly_salary]').fill(salary);
    await f.locator('input[name=tax_table]').fill('32');
    await f.locator('select[name=pension_plan]').selectOption(plan);
    await f.locator('select[name=agreement_id]').selectOption({ label: 'Teknikavtalet' });
    for (const [k, v] of Object.entries(extra)) await f.locator(`input[name=${k}]`).fill(v);
    await f.locator('button:has-text("Spara")').click();
    await owner.waitForURL(/ok=/);
  };
  const pA = pnr('19820315010'), pB = pnr('19950707020');
  await addEmp('Ingrid', 'Ingenjör', pA, '60000', 'itp1', { salary_sacrifice: '3000' });
  await addEmp('Olle', 'Montör', pB, '30000', 'saf_lo', { employment_start: '2026-12-01' });
  log('anställda med ITP 1 och löneväxling respektive avtalspension SAF-LO');

  await owner.goto(B + '/lon/2');
  for (const name of ['Ingrid Ingenjör', 'Olle Montör']) {
    await owner.selectOption('select[name=employee_id]', { label: name });
    await owner.click('button:has-text("Lägg till")');
    await owner.waitForURL(/lon\/2/);
    await owner.waitForLoadState('networkidle');
  }
  const ing = owner.locator('.card:has(h2:has-text("Ingrid Ingenjör"))');
  assert(await ing.locator('input[value="Löneväxling till tjänstepension"]').count() === 1, 'löneväxlingsrad');
  await ing.locator('form.hours input[name=ob_evening]').fill('10');
  await ing.locator('form.hours input[name=ot_simple]').fill('4');
  await ing.locator('form.hours input[name=oncall_weekend]').fill('12,5');
  await ing.locator('button:has-text("Beräkna tillägg")').click();
  await owner.locator('.card:has(h2:has-text("Ingrid Ingenjör")) input[value^="OB kväll 10 h"]').waitFor();
  const vals = await owner.locator('.card:has(h2:has-text("Ingrid Ingenjör")) input[name^=desc_]').evaluateAll((els) => els.map((e) => e.value));
  assert(vals.includes('OB kväll 10 h à 30,00 kr') && vals.includes('Enkel övertid 4 h à 638,30 kr') && vals.includes('Beredskap helg 12,5 h à 40,00 kr'), 'avtalstillägg: ' + vals.join(' | '));
  // Ändra timmar: tidigare avtalsrader ersätts
  await owner.locator('.card:has(h2:has-text("Ingrid Ingenjör")) form.hours input[name=ob_evening]').fill('2');
  await owner.locator('.card:has(h2:has-text("Ingrid Ingenjör")) button:has-text("Beräkna tillägg")').click();
  await owner.locator('.card:has(h2:has-text("Ingrid Ingenjör")) input[value^="OB kväll 2 h"]').waitFor();
  assert(await owner.locator('.card:has(h2:has-text("Ingrid Ingenjör")) input[value^="OB kväll 10 h"]').count() === 0, 'gamla OB-raden ersatt');
  log('OB, övertid (månadslön/94) och beredskap räknas ut från timmarna; nya timmar ersätter raderna');

  await owner.click('a:has-text("Pension och försäkringar")');
  await owner.waitForURL(/pension$/);
  t = await text(owner);
  // Ingrid: lön före växling 60 000 + 60 + 2 553,20 + 500 = 63 113,20; ITP 1: 4,5 % av 52 125 + 30 % av resten, plus växlat 3 000 × 1,058
  const gross = 6000000 + 6000 + 4 * 63830 + 50000, cap = Math.round(7.5 * 8340000 / 12);
  const premium = Math.round(Math.min(gross, cap) * 0.045 + (gross - cap) * 0.3) + 317400;
  const krs = (o) => (o / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s/g, ' ');
  assert(t.includes('ITP 1 (premiebestämd)') && t.replace(/\s/g, ' ').includes(krs(premium)) && t.includes('Löneväxling 3 000,00'), 'ITP 1-premie ' + krs(premium) + ': ' + t.slice(0, 900));
  assert(t.includes('Avtalspension SAF-LO') && t.replace(/\s/g, ' ').includes(krs(Math.round(3000000 * 0.006))) && t.replace(/\s/g, ' ').includes(krs(Math.round(3000000 * 0.045))), 'SAF-LO och Fora: ' + t.slice(0, 900));
  const col = await owner.request.get(owner.url() + '/collectum');
  const colX = await col.text();
  assert(col.status() === 200 && colX.includes('typ="nyanmalan" plan="ITP1"') && colX.includes(`personnummer="${pA.replace('-', '')}"`) && colX.includes('Ingrid Ingenjör') && !colX.includes('Olle'), 'Collectum-fil: ' + colX);
  const fora = await (await owner.request.get(owner.url() + '/fora')).text();
  assert(fora.includes(';202612;') && fora.includes('"Olle Montör";30000'), 'Fora-rapport: ' + fora);
  log('pension enligt ITP 1 (4,5 %/30 %) med löneväxling, SAF-LO och Fora-försäkringar; Collectum-fil och Fora-rapport');
  await owner.goto(B + '/lon/2');
  await owner.click('button:has-text("Bokför lönekörning")');
  await owner.locator('a:has-text("visa verifikation")').click();
  await owner.waitForURL(/verifikationer\/\d+/);
  t = await text(owner);
  assert(t.includes('7411') && t.includes('7533') && t.includes('7570') && t.includes('Upplupna avtalsförsäkringar (Fora)'), 'bokföring av pension och försäkringar: ' + t.slice(0, 1500));
  log('lönekörningen bokförs med pensionspremie (7411), särskild löneskatt (7533) och Fora-försäkringar (7570)');

  // ================= Del 4: kassor och utbetalningar =================
  const camtIn = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Ntry><Amt Ccy="SEK">355.48</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${todayIso}</Dt></BookgDt><AcctSvcrRef>ZT-1</AcctSvcrRef><NtryDtls><TxDtls><RmtInf><Ustrd>ZETTLE PAYOUT</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>`;
  await owner.goto(B + '/bank');
  const brow = owner.locator('tr:has-text("Företagskonto")').first();
  await brow.locator('input[type=file]').setInputFiles({ name: 'konto.xml', mimeType: 'application/xml', buffer: Buffer.from(camtIn) });
  await brow.locator('button:has-text("Importera")').click();
  await owner.waitForURL(/ok=/);

  const connectPP = async (provider, fields) => {
    await owner.goto(B + '/kassa/betalningar');
    await owner.selectOption('select[name=provider]', provider);
    for (const [k, v] of Object.entries(fields)) await owner.fill(`input[name=${k}]`, v);
    await owner.click('button:has-text("Spara koppling")');
    await owner.waitForURL(/ok=/);
  };
  await connectPP('zettle', { name: 'Butiken', api_key: 'zk', secret: 'klient-1' });
  await owner.click('section.provider:has-text("Butiken") button:has-text("Hämta nu")');
  await owner.waitForURL(/ok=.*dagsrapporter/);
  assert(decodeURIComponent(owner.url()).includes('1 dagsrapporter och 1 utbetalningar bokförda, 1 avstämda mot banken'), 'Zettle-synk: ' + decodeURIComponent(owner.url()));
  t = await text(owner);
  assert(t.includes('Dagsrapport') && t.includes('362,00') && t.includes('Avstämd mot banken') && t.includes('355,48') && t.includes('6,52'), 'rapporter: ' + t.slice(0, 1500));
  await owner.click('tr:has-text("Dagsrapport") a:has-text("verifikation")');
  await owner.waitForURL(/verifikationer\/\d+/);
  t = await text(owner);
  assert(t.includes('Dagsrapport Zettle') && t.includes('2 köp') && t.includes('1580') && t.includes('2611') && t.includes('50,00') && t.includes('2621') && t.includes('12,00'), 'dagsrapportens kontering: ' + t.slice(0, 1200));
  log('Zettle: dagsrapporten bokförs per momssats, utbetalningen delas i avgift och netto och stäms av mot bankens insättning');

  await owner.goto(B + '/kassa/betalningar');
  await owner.click('section.provider:has-text("Butiken") button:has-text("Hämta nu")');
  await owner.waitForURL((u) => decodeURIComponent(u.href).includes('0 dagsrapporter'));
  assert(decodeURIComponent(owner.url()).includes('0 dagsrapporter och 0 utbetalningar'), 'samma rapporter bokförs inte två gånger');

  await connectPP('stripe', { name: 'Stripe-kort', api_key: 'sk_live_kund', clearing_account: '1582' });
  await owner.click('section.provider:has-text("Stripe-kort") button:has-text("Hämta nu")');
  await owner.waitForURL(/ok=.*utbetalningar/);
  await owner.click('tr:has-text("Stripe-kort") a:has-text("verifikation")');
  t = await text(owner);
  assert(t.includes('Utbetalning Stripe') && t.includes('1582') && t.includes('970,00') && t.includes('6570') && t.includes('30,00') && t.includes('940,00'), 'Stripe-utbetalning: ' + t.slice(0, 1200));
  log('Stripe: utbetalningen delas i försäljning, återbetalning och avgifter mot avräkningskontot');

  await connectPP('klarna', { name: 'Klarna', api_key: 'K123', secret: 'hemlis' });
  await owner.click('section.provider:has-text("Klarna") button:has-text("Hämta nu")');
  await owner.waitForURL((u) => decodeURIComponent(u.href).includes('att kontrollera'));
  t = await text(owner);
  assert(t.includes('Kontrollera') && t.includes('går inte ihop'), 'Klarna-utbetalning som inte går ihop flaggas: ' + t.slice(0, 1500));
  log('Klarna: utbetalning som inte går ihop bokförs inte utan flaggas för kontroll');

  // ================= Del 5: valuta, koncern, engelska =================
  await owner.goto(B + '/bank');
  await owner.fill('form:has(button:has-text("Lägg till")) input[name=name]', 'EUR-konto');
  await owner.fill('form:has(button:has-text("Lägg till")) input[name=ledger_account]', '1932');
  await owner.fill('form:has(button:has-text("Lägg till")) input[name=currency]', 'EUR');
  await owner.click('form:has(button:has-text("Lägg till")) button');
  await owner.waitForURL(/ok=/);
  const camtEur = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Ntry><Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-11-02</Dt></BookgDt><AcctSvcrRef>EUR-1</AcctSvcrRef><NtryDtls><TxDtls><RmtInf><Ustrd>Insättning</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>`;
  const erow = owner.locator('tr:has-text("EUR-konto")').first();
  await erow.locator('input[type=file]').setInputFiles({ name: 'eur.xml', mimeType: 'application/xml', buffer: Buffer.from(camtEur) });
  await erow.locator('button:has-text("Importera")').click();
  await owner.waitForURL(/ok=/);
  const eurInv = await api('POST', '/invoices', { customer_id: reg.json.id, invoice_date: '2026-11-10', currency: 'EUR', exchange_rate: '11', your_reference: 'EU 1', book: true, lines: [{ description: 'Licens', quantity: 1, unit: 'st', unit_price: 100000, vat_rate: 25 }] });
  assert(eurInv.json.status === 'booked' && eurInv.json.total === 1375000, 'faktura i euro: ' + JSON.stringify(eurInv.json).slice(0, 300));
  await owner.goto(B + '/bokslut/valuta?datum=2026-12-31');
  t = await text(owner);
  assert(t.includes('EUR-konto') && t.includes('Bankkonto') && t.includes('Kundfordran') && t.includes('1250,00 EUR') && t.includes('13 750,00'), 'underlag för omvärdering: ' + t.slice(0, 1200));
  assert(await owner.locator('input[name^=amount_bank_]').inputValue() === '1000,00', 'valutasaldo från kontoutdraget');
  await owner.fill('input[name=rate_EUR]', '11,25');
  await owner.click('button:has-text("Bokför omvärdering")');
  await owner.waitForURL(/ok=/);
  await owner.click('a:has-text("visa verifikation")');
  await owner.waitForURL(/verifikationer\/\d+/);
  t = await text(owner);
  assert(t.includes('Omvärdering av valuta per 2026-12-31') && t.includes('1932') && t.includes('8330') && t.includes('11 250,00') && t.includes('1510') && t.includes('3960') && t.includes('312,50'), 'omvärderingens kontering: ' + t.slice(0, 1500));
  await owner.goto(B + '/bokslut/valuta?datum=2026-12-31');
  assert((await text(owner)).includes('Omvärderingen per 2026-12-31 är bokförd'), 'kan inte bokas två gånger');
  log('valutakonto och kundfordran i euro omvärderas till balansdagens kurs (8330 och 3960)');

  await owner.goto(`${BASE}/koncern?from=2026-01-01&to=2026-12-31&c=1&c=2&moder=1`);
  const link = owner.locator('form.group-link:has-text("Firma Test")');
  await link.locator('input[name=ownership]').fill('80');
  await link.locator('input[name=acquisition_cost]').fill('20000');
  await link.locator('button:has-text("Koppla som dotterbolag")').click();
  await owner.waitForURL(/ok=/);
  t = await text(owner);
  assert(t.includes('Aktier i Firma Test mot eget kapital vid förvärvet: 20 000,00') && t.includes('Koncernmässig goodwill Firma Test') && t.includes('Minoritetens andel i Firma Test (20 %)') && t.includes('Minoritetsintresse') && t.includes('varav minoritetens andel'), 'koncernelimineringar: ' + t.slice(0, 2500));
  log('koncern: aktier i dotterbolag elimineras mot eget kapital med goodwill och 20 % minoritet');

  const en = await login(browser, 'agare@example.com', 'hemligtlosen1');
  await en.goto(BASE + '/konto');
  await en.selectOption('select[name=locale]', 'en');
  await en.click('form:has(select[name=locale]) button');
  await en.waitForURL(/ok=/);
  await en.goto(B + '/kassa/betalningar');
  await en.waitForFunction(() => !document.documentElement.classList.contains('i18n-pending'));
  t = await text(en);
  assert(t.includes('Card terminals and payouts') && t.includes('Fetch now') && t.includes('Reports and payouts') && !t.includes('Hämta nu'), 'engelska på kortterminalsidan: ' + t.slice(0, 800));
  await en.goto(B + '/lon/avtal');
  await en.waitForFunction(() => !document.documentElement.classList.contains('i18n-pending'));
  t = await text(en);
  assert(t.includes('Collective agreements') && t.includes('Add agreement') && t.includes('Holiday supplement % of monthly salary per day'), 'engelska på avtalssidan: ' + t.slice(0, 800));
  assert(await en.getAttribute('form:has(button:has-text("Add agreement")) input[name=name]', 'placeholder') === 'E.g. Retail agreement', 'platshållare översatt');
  await en.goto(B + '/bokslut/valuta');
  await en.waitForFunction(() => !document.documentElement.classList.contains('i18n-pending'));
  assert((await text(en)).includes('Currency revaluation'), 'engelska på omvärderingssidan');
  await en.click('a:has-text("Year-end")');
  await en.waitForURL(/bokslut$/);
  await en.waitForFunction(() => document.body.innerText.includes('Year-end and tax return'));
  await en.goto(BASE + '/konto');
  await en.selectOption('select[name=locale]', 'sv');
  await en.click('form:has(select[name=locale]) button');
  await en.waitForURL(/ok=/);
  log('engelska i hela appen: sidornas rubriker, knappar, etiketter och platshållare översätts, även efter navigering');

  //@@NEXT@@
  await browser.close();
  skvServer.close(); apServer.close(); ppServer.close();
  console.log('Omgång 8: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
