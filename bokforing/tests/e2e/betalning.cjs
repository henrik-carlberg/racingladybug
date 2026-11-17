// End-to-end: e-faktura (Peppol BIS 3), Swish-QR på fakturan, betalfil (pain.001) och frånvaro i lönen.
// Körs efter saas.cjs (Anna Andersson har inloggning som anställd, lösen annaslosen12).
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const waitMsg = (page, text) => page.waitForURL((u) => decodeURIComponent(u.toString()).includes(text), { timeout: 20000 });
const text = async (page) => { await page.waitForLoadState('networkidle'); await page.waitForSelector('main h1'); return (await page.locator('main').textContent()).replace(/\s+/g, ' '); };
const login = async (browser, email, pw) => {
  const p = await (await browser.newContext()).newPage();
  p.setDefaultTimeout(20000);
  await p.goto(BASE + '/login');
  await p.fill('input[name=email]', email);
  await p.fill('input[name=password]', pw);
  await p.click('form button:has-text("Logga in")');
  await p.waitForURL(BASE + '/');
  return p;
};

(async () => {
  const browser = await chromium.launch();
  const page = await login(browser, 'agare@example.com', 'hemligtlosen1');
  const B = `${BASE}/c/1`;

  await page.goto(B + '/integrationer');
  await page.fill('input[name=name]', 'Betaltest');
  for (const s of ['sales:write', 'purchasing:write']) await page.check(`input[name=scopes][value="${s}"]`);
  await page.click('button:has-text("Skapa API-nyckel")');
  const token = (await page.locator('.flash.ok code').textContent({ timeout: 10000 })).trim();
  const api = async (method, path, body) => {
    const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };

  // ---------- Bolagsuppgifter: IBAN, BIC, Swish ----------
  await page.goto(B + '/installningar');
  await page.fill('input[name=iban]', 'SE45 5000 0000 0583 9825 7466');
  await page.fill('input[name=bic]', 'ESSESESS');
  await page.fill('input[name=swish_number]', '123 456 78 90');
  await page.click('form:has(input[name=iban]) button:has-text("Spara")');
  await page.waitForURL(/ok=/);
  log('IBAN, BIC och Swishnummer sparade');

  // ---------- Peppol ----------
  const bad = await api('POST', '/customers', { name: 'Kommunen', orgnr: '212000-0142', peppol_id: 'fel' });
  assert(bad.status === 400, 'felaktigt Peppol-ID avvisas: ' + JSON.stringify(bad));
  const cust = await api('POST', '/customers', { name: 'Kommunen', orgnr: '212000-0142', address: 'Torget 1', postal_code: '411 01', city: 'Göteborg', peppol_id: '0007:2120000142' });
  assert(cust.status === 201, 'kund: ' + JSON.stringify(cust));
  const inv = await api('POST', '/invoices', { customer_id: cust.json.id, invoice_date: '2026-11-17', book: true, lines: [{ description: 'Konsult & stöd', quantity: 2, unit: 'h', unit_price: 100000, vat_rate: 25 }] });
  assert(inv.json.status === 'booked', 'faktura: ' + JSON.stringify(inv));
  await page.goto(`${B}/fakturor/${inv.json.id}`);
  let t = await text(page);
  assert(t.includes('E-faktura (Peppol BIS 3)') && t.includes('Er referens'), 'saknad referens visas: ' + t.slice(0, 1500));
  let res = await page.request.get(`${B}/fakturor/${inv.json.id}/peppol`);
  assert(res.status() === 422, 'utan referens: 422');
  log('Peppol-kontroll: fel format på Peppol-ID avvisas, faktura utan "Er referens" stoppas');

  const inv2 = await api('POST', '/invoices', { customer_id: cust.json.id, invoice_date: '2026-11-17', your_reference: 'Ref 4711', book: true, lines: [{ description: 'Konsult & stöd', quantity: 2, unit: 'h', unit_price: 100000, vat_rate: 25 }] });
  await page.goto(`${B}/fakturor/${inv2.json.id}`);
  t = await text(page);
  assert(t.includes('Ladda ner e-faktura (XML)') && t.includes('0007:2120000142'), 'nedladdning: ' + t.slice(0, 1500));
  res = await page.request.get(`${B}/fakturor/${inv2.json.id}/peppol`);
  const x = await res.text();
  assert(res.status() === 200 && x.includes('<cbc:BuyerReference>Ref 4711</cbc:BuyerReference>') && x.includes('<cbc:EndpointID schemeID="0007">2120000142</cbc:EndpointID>')
    && x.includes('<cbc:PayableAmount currencyID="SEK">2500.00</cbc:PayableAmount>') && x.includes('Konsult &amp; stöd') && x.includes(`<cbc:PaymentID>${inv2.json.ocr}</cbc:PaymentID>`), 'Peppol-XML: ' + x.slice(0, 3000));
  log('Peppol BIS 3-faktura nedladdad: köparreferens, Peppol-ID, OCR och belopp 2 500 kr');

  // ---------- Swish-QR ----------
  assert(await page.locator('.invoice svg, svg').count() > 0 && t.includes('Swish') && t.includes('123 456 78 90'), 'Swish-QR på fakturan: ' + t.slice(0, 2000));
  log('Swish-QR med nummer, belopp och OCR visas på fakturan');

  // ---------- Betalfil pain.001 ----------
  const sup = await api('POST', '/suppliers', { name: 'Giro AB', bankgiro: '5050-1055', default_account: 5410 });
  const si = await api('POST', '/supplier-invoices', { supplier_id: sup.json.id, invoice_number: 'G-1', invoice_date: '2026-11-10', due_date: '2026-12-10', payment_reference: '100123', total: 125000, vat: 25000 });
  assert(si.status === 201, 'levfaktura: ' + JSON.stringify(si));
  await api('POST', `/supplier-invoices/${si.json.id}/approve`);
  await page.goto(B + '/leverantorsfakturor/betalning');
  assert(await page.locator('a:has-text("Betalfil till banken (ISO 20022)")').count() === 1, 'knapp för betalfil');
  res = await page.request.get(`${B}/leverantorsfakturor/betalning/pain001`);
  const p = await res.text();
  assert(res.status() === 200, 'pain.001: ' + res.status() + ' ' + p);
  assert(p.includes('pain.001.001.03') && p.includes('<IBAN>SE4550000000058398257466</IBAN>') && p.includes('<BIC>ESSESESS</BIC>')
    && p.includes('<Id>50501055</Id><SchmeNm><Prtry>BGNR</Prtry></SchmeNm>') && p.includes('<Ref>100123</Ref>') && p.includes('<InstdAmt Ccy="SEK">1250.00</InstdAmt>') && p.includes('2026-12-10'), 'pain.001-innehåll: ' + p.slice(0, 3000));
  log('betalfil pain.001: bankgiro (BGNR), OCR (SCOR), 1 250 kr på förfallodagen');

  // ---------- Frånvaro ----------
  await page.goto(B + '/lon/franvaro');
  const reg = async (kind, from, to) => {
    await page.selectOption('select[name=employee_id]', { label: 'Anna Andersson' });
    await page.selectOption('select[name=kind]', kind);
    await page.fill('input[name=from]', from);
    await page.fill('input[name=to]', to);
    await page.click('button:has-text("Registrera frånvaro")');
    await page.waitForURL(/ok=/);
    await page.goto(B + '/lon/franvaro');
  };
  await reg('sick', '2026-11-02', '2026-11-04');
  await reg('vacation', '2026-11-09', '2026-11-13');
  await page.selectOption('select[name=employee_id]', { label: 'Anna Andersson' });
  await page.fill('input[name=from]', '2026-11-03');
  await page.fill('input[name=to]', '2026-11-03');
  await page.click('button:has-text("Registrera frånvaro")');
  await page.waitForURL(/error=/);
  log('sjukdom 2–4 nov och semester 9–13 nov registrerade, överlapp avvisas');

  // Anställd ansöker om semester, ägaren godkänner
  const anna = await login(browser, 'anna@example.com', 'annaslosen12');
  await anna.goto(B + '/mitt/franvaro');
  await anna.selectOption('select[name=kind]', 'vacation');
  await anna.fill('input[name=from]', '2026-11-23');
  await anna.fill('input[name=to]', '2026-11-25');
  await anna.click('button:has-text("Skicka")');
  await anna.waitForURL(/ok=/);
  t = await text(anna);
  assert(t.includes('Ansökan') && t.includes('2026-11-23'), 'Annas ansökan: ' + t.slice(0, 1200));
  await page.goto(B + '/lon/franvaro');
  t = await text(page);
  assert(t.includes('1 ansökningar väntar'), 'väntande ansökan: ' + t.slice(0, 800));
  await page.click('button:has-text("Godkänn")');
  await page.waitForURL(/ok=/);
  await page.goto(B + '/lon/franvaro?ar=2026');
  t = await text(page);
  assert(!t.includes('ansökningar väntar') && /Anna Andersson\s*25\s*8\s*\d+\s*17/.test(t), 'semestersaldo 25 − 8 = 17: ' + t.slice(0, 1500));
  log('Anna ansöker om semester 23–25 nov, ägaren godkänner; saldo 17 dagar kvar');

  // Lönekörningen 2026-12 (utkast från lonerevision.cjs)
  await page.goto(B + '/lon');
  await page.click('a:has-text("2026-12")');
  await page.waitForURL(/lon\/\d+/);
  const R = page.url().split('?')[0];
  await page.click('button:has-text("Räkna in frånvaro")');
  await page.waitForURL(/ok=/);
  await page.goto(R);
  await page.waitForLoadState('networkidle');
  const rows = async (prefix) => page.locator(`input[value^="${prefix}"]`).count();
  assert(await rows('Sjukavdrag 3 dagar 2026-11-02') === 1 && await rows('Sjuklön 80 % 3 dagar') === 1 && await rows('Karensavdrag') === 1 && await rows('Semestertillägg 5 dagar') === 1 && await rows('Semestertillägg 3 dagar') === 1,
    'frånvaro i lönen: ' + (await text(page)).slice(0, 2500));
  await page.click('button:has-text("Räkna in frånvaro")');
  await page.waitForURL(/ok=/);
  await page.goto(R);
  await page.waitForLoadState('networkidle');
  assert(await rows('Karensavdrag') === 1, 'frånvaro räknas bara in en gång');
  log('lönekörning 2026-12: sjukavdrag, sjuklön 80 %, karensavdrag och semestertillägg inräknade, en gång');

  await anna.goto(B + '/mitt/franvaro');
  t = await text(anna);
  assert(t.includes('Godkänd') && t.includes('17'), 'Anna ser godkänd ledighet och saldo: ' + t.slice(0, 1200));
  log('Anna ser godkänd semester och saldo');

  await browser.close();
  console.log('Alla betalnings- och frånvarotester gick igenom');
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
