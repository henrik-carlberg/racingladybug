// End-to-end: delbetalningar, förskottsfaktura som avräknas, periodiseringar, semesterlöneskuld, kvitto som läses av,
// e-postsammandrag (inställning) och CSV-import av kunder och obetalda fakturor.
const http = require('http');
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const waitMsg = (page, text) => page.waitForURL((u) => decodeURIComponent(u.toString()).replace(/\u00a0/g, ' ').includes(text), { timeout: 20000 });
const text = async (page) => { await page.waitForLoadState('networkidle'); const sel = (await page.locator('main').count()) ? 'main' : 'body'; return (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').replace(/\u00a0/g, ' '); };
const noError = async (page, label) => { const e = await page.locator('.flash.error').count(); if (e) throw new Error(label + ': ' + await page.locator('.flash.error').first().innerText()); };

const claude = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = JSON.parse(body);
    res.writeHead(200, { 'Content-Type': 'application/json', 'request-id': 'req_test' });
    const out = { merchant: 'Pressbyrån', date: '2026-11-12', total_amount: 89, vat_rate: 12, category: 'personal_fika', description: 'Kaffe och bullar till teamet' };
    res.end(JSON.stringify({ id: 'msg_r', type: 'message', role: 'assistant', model: j.model, stop_sequence: null, usage: { input_tokens: 800, output_tokens: 80 },
      content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn' }));
  });
});

async function invoice(page, B, customer, desc, price, opts = {}) {
  await page.goto(B + '/fakturor/ny');
  await page.selectOption('select[name=customer_id]', { label: customer });
  await page.fill('input[name=invoice_date]', '2026-11-02');
  if (opts.advance) await page.check('input[name=advance]');
  const row = page.locator('tbody tr').first();
  await row.locator('td:nth-child(1) input').fill(desc);
  await row.locator('td:nth-child(4) input').fill(price);
  await page.click('button:has-text("Spara utkast")');
  await page.waitForURL(/fakturor\/\d+\?ok/);
  return page.url().split('?')[0];
}

(async () => {
  await new Promise((r) => claude.listen(3304, r));
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(20000);
  await page.goto(BASE + '/login');
  await page.fill('input[name=email]', 'agare@example.com');
  await page.fill('input[name=password]', 'hemligtlosen1');
  await page.click('form button:has-text("Logga in")');
  await page.waitForURL(BASE + '/');
  const B = `${BASE}/c/1`;

  // ---- Delbetalning ----
  await page.goto(B + '/kunder');
  await page.fill('input[name=name]', 'Delbetalning AB');
  await page.click('button:has-text("Spara kund")');
  await page.waitForURL(/ok=/);
  const inv = await invoice(page, B, 'Delbetalning AB', 'Installation', '1000');
  await page.click('button:has-text("Bokför faktura")');
  await waitMsg(page, 'klar att skicka');
  assert(await page.inputValue('input[name=amount]') === '1250,00', 'standardbelopp är hela totalen');
  await page.fill('input[name=date]', '2026-11-05');
  await page.fill('input[name=amount]', '500');
  await page.click('button:has-text("Registrera inbetalning")');
  await waitMsg(page, 'Inbetalningen är bokförd');
  let t = await text(page);
  assert(t.includes('betalt 500,00 av 1 250,00') && t.includes('kvar 750,00'), 'delbetald: ' + t.slice(0, 900));
  assert(!t.includes('Kreditera hela fakturan'), 'delbetald faktura kan inte krediteras');
  assert(await page.inputValue('input[name=amount]') === '750,00', 'standardbelopp är det som återstår');
  await page.fill('input[name=date]', '2026-11-10');
  await page.click('button:has-text("Registrera inbetalning")');
  await page.locator('text=betalt 1 250,00 av 1 250,00').waitFor();
  t = await text(page);
  assert(t.includes('Betald') && t.includes('betalt 1 250,00 av 1 250,00') && !t.includes('Registrera inbetalning'), 'slutbetald: ' + t.slice(0, 900));
  log('kundfaktura betald i två delar, återstående belopp föreslås');

  // ---- Förskottsfaktura ----
  await invoice(page, B, 'Delbetalning AB', 'Förskott projekt', '2000', { advance: true });
  t = await text(page);
  assert(t.includes('Förskottsfaktura'), 'förskottsmarkering');
  await page.click('button:has-text("Bokför faktura")');
  await waitMsg(page, 'klar att skicka');
  await page.fill('input[name=date]', '2026-11-06');
  await page.click('button:has-text("Registrera inbetalning")');
  await waitMsg(page, 'Inbetalningen är bokförd');
  const advNo = (await text(page)).match(/Faktura (\d+)/)[1];
  await page.click('p.small a:has-text("verifikation") >> nth=0');
  await page.waitForURL(/verifikationer\/\d+/);
  t = await text(page);
  assert(t.includes('2420'), 'förskottet bokfört mot 2420: ' + t.slice(0, 600));
  await invoice(page, B, 'Delbetalning AB', 'Projekt slutleverans', '5000');
  t = await text(page);
  assert(t.includes('Betalda förskott att avräkna') && t.includes(`Faktura ${advNo}`), 'förskott att avräkna: ' + t.slice(0, 900));
  await page.click('button:has-text("Dra av på denna faktura")');
  await waitMsg(page, 'Förskottet är avräknat');
  t = await text(page);
  assert(t.includes(`Avgår förskott enligt faktura ${advNo}`) && t.includes('3 750,00'), 'slutfaktura minus förskott: ' + t.slice(0, 1500));
  assert(!t.includes('Betalda förskott att avräkna'), 'förskottet avräknas bara en gång');
  await page.click('button:has-text("Bokför faktura")');
  await waitMsg(page, 'klar att skicka');
  await noError(page, 'bokför slutfaktura');
  log('förskottsfaktura mot 2420 avräknas på slutfakturan');

  // ---- Periodisering ----
  await page.goto(B + '/periodiseringar');
  await page.fill('input[name=description]', 'Företagsförsäkring helår');
  await page.selectOption('select[name=kind]', 'prepaid_expense');
  await page.fill('input[name=amount]', '12000');
  await page.fill('input[name=result_account]', '6310');
  await page.fill('input[name=first_period]', '2026-09');
  await page.fill('input[name=months]', '12');
  await page.fill('input[name=transfer_date]', '2026-09-01');
  await page.click('button:has-text("Lägg upp periodisering")');
  await waitMsg(page, 'Periodiseringen är upplagd');
  await page.fill('input[name=period]', '2026-10');
  await page.click('button:has-text("Bokför periodiseringar")');
  await waitMsg(page, 'Periodiseringar bokförda: 2 000,00 kr på 2 verifikationer');
  t = await text(page);
  assert(t.includes('Företagsförsäkring helår') && t.includes('10 000,00'), 'kvar efter två månader: ' + t.slice(0, 1200));
  await page.click('button:has-text("Bokför periodiseringar")');
  await waitMsg(page, 'Inga periodiseringar att bokföra');
  await page.goto(B + '/rapporter/huvudbok?account=1790&from=2026-01-01&to=2026-12-31');
  t = await text(page);
  assert(t.includes('2026-10-31 Företagsförsäkring helår 1 000,00 10 000,00'), 'huvudbok 1790: ' + t.slice(0, 1200));
  log('periodisering flyttas till 1790 och löses upp månadsvis, utan dubbelbokning');

  // ---- Semesterlöneskuld (förslaget visas) ----
  await page.goto(B + '/periodiseringar?asof=2026-12-31');
  t = await text(page);
  assert(t.includes('Semesterlöneskuld') && (t.includes('Dagar kvar') || t.includes('Inga aktiva anställda')), 'semesterlöneskuld: ' + t.slice(-800));
  log('förslag på semesterlöneskuld per bokslutsdagen');

  // ---- Kvitto som läses av ----
  await page.goto(B + '/kvitto');
  await page.setInputFiles('input[name=file]', { name: 'kvitto.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await page.locator('.receipt-read').waitFor();
  assert(await page.inputValue('input[name=date]') === '2026-11-12', 'datum avläst');
  assert(await page.inputValue('input[name=total]') === '89,00', 'belopp avläst');
  assert(await page.inputValue('select[name=vat_rate]') === '12', 'moms avläst');
  assert((await page.inputValue('input[name=description]')).includes('Pressbyrån'), 'beskrivning avläst');
  await page.click('button:has-text("Bokför kvitto")');
  await waitMsg(page, 'Kvittot är bokfört');
  t = await text(page);
  assert(t.includes('Pressbyrån') && t.includes('89,00'), 'bokfört kvitto: ' + t.slice(-600));
  log('kvittot läses av (datum, belopp, moms, kategori) och bokförs');

  // ---- E-postsammandrag ----
  await page.goto(BASE + '/konto');
  await page.selectOption('select[name=digest]', 'daily');
  await page.click('form:has(select[name=digest]) button');
  await waitMsg(page, 'Inställningen är sparad');
  assert(await page.inputValue('select[name=digest]') === 'daily', 'sammandrag dagligen');
  const bad = await page.goto(BASE + '/avregistrera/ogiltigtokenogiltigtoken');
  await page.click('button:has-text("Ja, avsluta")');
  await waitMsg(page, 'ok=0');
  assert((await text(page)).includes('Länken är ogiltig'), 'ogiltig avregistrering');
  log('inställning för e-postsammandrag och avregistreringslänk');

  // ---- CSV-import ----
  await page.goto(B + '/installningar/import');
  await page.selectOption('select[name=kind]', 'customers');
  const kunder = 'Kundnr;Namn;Organisationsnummer;E-post;Postnummer;Ort\n1;Importkund Ett AB;556677-8899;ett@example.com;111 22;Stockholm\n2;Importkund Två AB;;tva@example.com;411 01;Göteborg\n3;Delbetalning AB;;;;\n';
  await page.setInputFiles('input[name=file]', { name: 'kunder.csv', mimeType: 'text/csv', buffer: Buffer.from(kunder, 'latin1') });
  await page.locator('table.import-preview').waitFor();
  t = await text(page);
  assert(t.includes('Namn → Namn') && t.includes('Kundnr (används inte)') && t.includes('Göteborg'), 'förhandsgranskning: ' + t.slice(0, 1200));
  await page.click('button:has-text("Importera 3 rader")');
  await page.locator('.import-done').waitFor();
  t = await text(page);
  assert(t.includes('2 importerade, 1 fanns redan'), 'kundimport: ' + t.slice(0, 600));

  await page.selectOption('select[name=kind]', 'customer_invoices');
  const fakturor = 'Fakturanr;Kund;Fakturadatum;Förfallodatum;Total;Restbelopp\n9001;Importkund Ett AB;2026-10-01;2026-10-31;2 000,00;1 500,00\n9002;Ny Kund Från Fil AB;15.10.2026;14.11.2026;800;800\n9003;Importkund Två AB;2026-10-01;2026-13-01;5;5\n';
  await page.setInputFiles('input[name=file]', { name: 'fakturor.csv', mimeType: 'text/csv', buffer: Buffer.from(fakturor) });
  await page.locator('text=rader har fel').waitFor();
  t = await text(page);
  assert(t.includes('Rad 4: Ogiltigt datum') && !t.includes('Importera 3 rader'), 'fel i filen blockerar importen: ' + t.slice(0, 1200));
  await page.setInputFiles('input[name=file]', { name: 'fakturor.csv', mimeType: 'text/csv', buffer: Buffer.from(fakturor.split('\n').slice(0, 3).join('\n')) });
  await page.locator('button:has-text("Importera 2 rader")').waitFor();
  await page.click('button:has-text("Importera 2 rader")');
  await page.locator('.import-done').waitFor();
  assert((await text(page)).includes('2 importerade, 0 fanns redan, 1 nya kunder'), 'fakturaimport');
  await page.goto(B + '/fakturor');
  await page.click('a:has-text("9001")');
  t = await text(page);
  assert(t.includes('1 500,00'), 'importerad faktura: ' + t.slice(0, 800));
  await page.fill('input[name=date]', '2026-11-15');
  await page.click('button:has-text("Registrera inbetalning")');
  await waitMsg(page, 'Inbetalningen är bokförd');
  await page.click('li a:has-text("verifikation")');
  await page.waitForURL(/verifikationer\/\d+/);
  t = await text(page);
  assert(t.includes('1510') && t.includes('1930') && !t.includes('3001'), 'betalning av importerad faktura mot 1510: ' + t.slice(0, 800));
  log('CSV-import av kunder (dubbletter hoppas över) och obetalda fakturor som betalas mot 1510');

  await browser.close();
  claude.close();
  console.log('Omgång 2: alla steg gick igenom');
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
