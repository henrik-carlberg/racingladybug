// End-to-end: faktura i euro på engelska med kursvinst, EU-rapport, arbetsorder, budget mot utfall, månadsrapport,
// AI-assistent, checklista före periodlås, revisor med läsbehörighet, koncern, bilförmån och arbetsgivarintyg.
const http = require('http');
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const waitMsg = (page, text) => page.waitForURL((u) => decodeURIComponent(u.toString()).replace(/ /g, ' ').includes(text), { timeout: 20000 });
const text = async (page) => { await page.waitForLoadState('networkidle'); const sel = (await page.locator('main').count()) ? 'main' : 'body'; return (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').replace(/ /g, ' '); };

let claudeCalls = 0;
const claude = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = JSON.parse(body);
    claudeCalls++;
    const sys = JSON.stringify(j.system);
    const ok = sys.includes('Bolagsdata') && sys.includes('Resultat per månad');
    res.writeHead(200, { 'Content-Type': 'application/json', 'request-id': 'req_a' });
    res.end(JSON.stringify({ id: 'msg_a', type: 'message', role: 'assistant', model: j.model, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 40 },
      content: [{ type: 'text', text: JSON.stringify({ answer: ok ? `Svar: resultatet framgår av bolagsdatan (${j.messages.length} meddelanden).` : 'Ingen data', actions: [{ type: 'open', label: 'Öppna momsrapporten', path: '/rapporter/moms', invoice_number: null, bank_transaction_id: null }, { type: 'open', label: 'Farlig länk', path: 'https://evil.example', invoice_number: null, bank_transaction_id: null }] }) }], stop_reason: 'end_turn' }));
  });
});

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

  // ---- Faktura i euro på engelska ----
  await page.goto(B + '/kunder');
  await page.fill('input[name=name]', 'Berlin GmbH');
  await page.fill('input[name=country]', 'DE');
  await page.fill('input[name=vat_number]', 'DE123456789');
  await page.check('input[name=reverse_charge]');
  await page.selectOption('select[name=currency]', 'EUR');
  await page.selectOption('select[name=language]', 'en');
  await page.click('button:has-text("Spara kund")');
  await page.waitForURL(/ok=/);
  await page.goto(B + '/fakturor/ny');
  await page.selectOption('select[name=customer_id]', { label: 'Berlin GmbH' });
  assert(await page.inputValue('select[name=currency]') === 'EUR' && await page.inputValue('select[name=language]') === 'en', 'kundens valuta och språk föreslås');
  await page.fill('input[name=invoice_date]', '2026-11-03');
  await page.fill('input[name=exchange_rate]', '11,50');
  const row = page.locator('tbody tr').first();
  await row.locator('td:nth-child(1) input').fill('Consulting');
  await row.locator('td:nth-child(2) input').fill('10');
  await row.locator('td:nth-child(4) input').fill('100');
  await page.click('button:has-text("Spara utkast")');
  await page.waitForURL(/fakturor\/\d+\?ok/);
  await page.click('button:has-text("Bokför faktura")');
  await waitMsg(page, 'klar att skicka');
  let doc = (await page.locator('.doc').innerText()).replace(/\s+/g, ' ').replace(/ /g, ' ');
  assert(doc.includes('INVOICE') && doc.includes('Amount due EUR') && doc.includes('1 000,00') && doc.includes('Rate 11,5 SEK per EUR') && doc.includes('Reverse charge'), 'engelsk faktura i euro: ' + doc.slice(0, 900));
  const invUrl = page.url().split('?')[0];
  await page.click('p.small a:has-text("verifikation") >> nth=0');
  await page.waitForURL(/verifikationer\/\d+/);
  let t = await text(page);
  assert(t.includes('1510') && t.includes('11 500,00') && t.includes('3308'), 'bokförd i kronor: ' + t.slice(0, 700));
  await page.goto(invUrl);
  assert(await page.inputValue('input[name=amount]') === '11500,00', 'fordran i kronor föreslås');
  await page.fill('input[name=date]', '2026-11-20');
  await page.fill('input[name=amount]', '11700');
  await page.click('button:has-text("Registrera inbetalning")');
  await waitMsg(page, 'Inbetalningen är bokförd');
  await page.click('li a:has-text("verifikation")');
  await page.waitForURL(/verifikationer\/\d+/);
  t = await text(page);
  assert(t.includes('3960') && t.includes('200,00') && t.includes('11 700,00'), 'kursvinst 200 kr: ' + t.slice(0, 700));
  log('faktura i euro på engelska bokförs i kronor, kursvinsten går till 3960');

  // ---- EU-rapport ----
  await page.goto(B + '/rapporter/eu?period=2026-Q4');
  t = await text(page);
  assert(t.includes('DE123456789') && t.includes('Berlin GmbH') && t.includes('11 500'), 'periodisk sammanställning: ' + t.slice(0, 900));
  const csv = await (await page.request.get(B + '/rapporter/eu/csv?period=2026-Q4')).text();
  assert(csv.includes(';2026-Q4;DE123456789;0;0;11500'), 'CSV: ' + csv);
  log('periodisk sammanställning per momsnummer med CSV');

  // ---- Arbetsorder ----
  await page.goto(B + '/moduler');
  await page.locator('.card:has(h2:text-is("Arbetsordrar")) button:has-text("Aktivera")').click();
  await page.waitForURL(/ok=/);
  await page.goto(B + '/m/arbetsorder');
  await page.fill('input[name=title]', 'Byte av blandare');
  await page.selectOption('select[name=customer_id]', { label: 'Delbetalning AB' });
  await page.fill('input[name=address]', 'Storgatan 5');
  await page.click('button:has-text("Skapa arbetsorder")');
  await waitMsg(page, 'Arbetsordern är skapad');
  await page.fill('input[name=description]', 'Montering');
  await page.fill('input[name=quantity]', '2,5');
  await page.fill('input[name=unit_price]', '600');
  await page.click('button:has-text("Lägg till")');
  await waitMsg(page, 'Raden är tillagd');
  await page.selectOption('select[name=kind]', 'material');
  await page.fill('input[name=description]', 'Blandare');
  await page.fill('input[name=quantity]', '1');
  await page.fill('input[name=unit_price]', '1200');
  await page.click('button:has-text("Lägg till")');
  await page.locator('text=Blandare').first().waitFor();
  t = await text(page);
  assert(t.includes('2 700,00') && t.includes('varav arbete 1 500,00') && t.includes('Pågår'), 'arbetsorder: ' + t.slice(0, 900));
  await page.fill('input[name=signed_by]', 'Kalle Kund');
  await page.click('button:has-text("Godkänn och markera klar")');
  await waitMsg(page, 'godkänt av kunden');
  await page.click('button:has-text("Skapa faktura")');
  await waitMsg(page, 'Fakturautkast skapat från arbetsordern');
  t = await text(page);
  assert(t.includes('Fakturautkast') && t.includes('Montering') && t.includes('Blandare') && t.includes('Arbetsorder 1: Byte av blandare'), 'faktura från arbetsorder: ' + t.slice(0, 1200));
  log('arbetsorder med tid och material, kundens godkännande och faktura');

  // ---- Budget mot utfall och månadsrapport ----
  await page.goto(B + '/m/projekt/budget');
  t = await text(page);
  assert(t.includes('Budget mot utfall') && t.includes('Intäkt budget'), 'budget mot utfall: ' + t.slice(0, 600));
  await page.goto(B + '/rapporter/manad?period=2026-11');
  t = await text(page);
  assert(t.includes('Månadsrapport 2026-11') && t.includes('Intäkter') && t.includes('Kassa och bank') && t.includes('Största kostnaderna') || t.includes('Ställning vid månadens slut'), 'månadsrapport: ' + t.slice(0, 900));
  log('budget mot utfall och månadsrapport');

  // ---- AI-assistent ----
  await page.goto(B + '/assistent');
  await page.fill('textarea[name=q]', 'Hur gick november?');
  await page.click('button:has-text("Fråga")');
  await page.locator('.assistant-assistant').waitFor();
  t = await text(page);
  assert(t.includes('Svar: resultatet framgår av bolagsdatan (1 meddelanden)') && claudeCalls === 1, 'assistent: ' + t.slice(0, 600));
  assert(await page.locator('.assistant-actions a:has-text("Öppna momsrapporten")').getAttribute('href') === '/c/1/rapporter/moms' && !(await page.locator('text=Farlig länk').count()), 'förslag: bara interna länkar');
  await page.fill('textarea[name=q]', 'Och oktober?');
  await page.click('button:has-text("Fråga")');
  await page.locator('.assistant-assistant >> nth=1').waitFor();
  assert((await text(page)).includes('(3 meddelanden)'), 'konversationen skickas med');
  log('assistenten svarar utifrån bolagets siffror och minns konversationen');

  // ---- Checklista före periodlås ----
  await page.goto(B + '/installningar?lockcheck=2026-10-31');
  t = await text(page);
  assert(t.includes('Banken är avstämd') && t.includes('Momsen är redovisad') && t.includes('Underlag finns'), 'checklista: ' + t.slice(0, 400));
  log('checklista före periodlås');

  // ---- Revisor ----
  await page.goto(B + '/installningar');
  await page.fill('form:has(select[name=role]) input[name=email]', 'revisor.omg3@example.com');
  await page.selectOption('form:has(select[name=role]) select[name=role]', 'auditor');
  await page.click('button:has-text("Skapa inbjudan")');
  await page.waitForURL(/invite=/);
  const link = (await page.locator('code').textContent()).trim();
  const aud = await (await browser.newContext()).newPage();
  aud.setDefaultTimeout(20000);
  await aud.goto(link);
  await aud.fill('input[name=name]', 'Rut Revisor');
  await aud.fill('input[name=password]', 'revisorlosen1');
  await aud.click('button:has-text("Acceptera")');
  await aud.waitForURL(BASE + '/');
  await aud.goto(B + '/verifikationer');
  t = await text(aud);
  assert(t.includes('läsbehörighet') && (await aud.locator('tbody tr').count()) > 3, 'revisorn ser verifikationerna: ' + t.slice(0, 300));
  await aud.goto(B + '/kunder');
  await aud.fill('input[name=name]', 'Revisorns kund');
  await aud.click('button:has-text("Spara kund")');
  await waitMsg(aud, 'Revisorn har läsbehörighet');
  await page.goto(B + '/kunder');
  assert(!(await text(page)).includes('Revisorns kund'), 'revisorn kan inte skapa kunder');
  log('revisorn läser allt men kan inte ändra');

  // ---- Koncern ----
  await page.goto(BASE + '/koncern');
  t = await text(page);
  assert(t.includes('Koncernsammanställning') && t.includes('Resultaträkning') && t.includes('Balansräkning') && t.includes('Elimineringar'), 'koncern: ' + t.slice(0, 600));
  log('koncernsammanställning');

  // ---- Bilförmån och arbetsgivarintyg ----
  await page.goto(B + '/lon/bilforman?price=400000&tax=1500');
  t = await text(page);
  assert(t.includes('Förmånsvärde per år') && /Per månad.*\d/.test(t), 'bilförmån: ' + t.slice(0, 600));
  await page.goto(B + '/lon/anstallda');
  await page.locator('tbody tr a').first().click();
  await page.waitForURL(/anstallda\/\d+/);
  await page.fill('input[name=pension_percent]', '4,5');
  await page.selectOption('select[name=vacation_rule]', 'percent');
  await page.click('button:has-text("Spara")');
  await waitMsg(page, 'Den anställda är sparad');
  await page.goto(B + '/lon/anstallda');
  await page.locator('tbody tr a').first().click();
  await page.waitForURL(/anstallda\/\d+/);
  assert(await page.inputValue('input[name=pension_percent]') === '4,5' && await page.inputValue('select[name=vacation_rule]') === 'percent', 'pension och semesterregel sparade');
  await page.click('a:has-text("Underlag för arbetsgivarintyg")');
  await page.waitForURL(/intyg/);
  t = await text(page);
  assert(t.includes('Underlag för arbetsgivarintyg') && t.includes('Lön per månad'), 'arbetsgivarintyg: ' + t.slice(0, 600));
  log('bilförmån, tjänstepension, procentregeln och arbetsgivarintyg');

  await browser.close();
  claude.close();
  console.log('Omgång 3: alla steg gick igenom');
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
