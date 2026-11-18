// End-to-end: konteringsregler och inlärning i bankavstämningen, samt ROT- och RUT-avdrag med begäran och beslut.
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const waitMsg = (page, text) => page.waitForURL((u) => decodeURIComponent(u.toString()).includes(text), { timeout: 20000 });
const text = async (page) => { await page.waitForLoadState('networkidle'); await page.waitForSelector('main h1'); return (await page.locator('main').textContent()).replace(/\s+/g, ' '); };

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(20000);
  await page.goto(BASE + '/login');
  await page.fill('input[name=email]', 'agare@example.com');
  await page.fill('input[name=password]', 'hemligtlosen1');
  await page.click('form button:has-text("Logga in")');
  await page.waitForURL(BASE + '/');
  const B = `${BASE}/c/1`;
  await page.goto(B + '/integrationer');
  await page.fill('input[name=name]', 'Rotbank');
  for (const s of ['sales:write', 'accounting:read']) await page.check(`input[name=scopes][value="${s}"]`);
  await page.click('button:has-text("Skapa API-nyckel")');
  const token = (await page.locator('.flash.ok code').textContent({ timeout: 10000 })).trim();
  const api = async (method, path, body) => {
    const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  const balance = async (acc) => {
    const r = await api('GET', '/reports/balances?from=2026-01-01&to=2026-12-31');
    const rows = r.json.data ?? r.json.accounts ?? r.json;
    return rows.find((x) => x.account === acc) ?? { closing_balance: 0, change: 0 };
  };

  // ================= Bank: konteringsregler =================
  await page.goto(B + '/bank');
  await page.fill('form:has(button:has-text("Lägg till")) input[name=name]', 'Företagskort');
  await page.fill('form:has(button:has-text("Lägg till")) input[name=ledger_account]', '1930');
  await page.click('form:has(button:has-text("Lägg till")) button');
  await waitMsg(page, 'Bankkontot är tillagt');
  const importCsv = async (name, rows) => {
    await page.goto(B + '/bank');
    const csv = 'Bokföringsdag;Belopp;Text\n' + rows.join('\n') + '\n';
    await page.locator('tr:has-text("Företagskort") input[type=file]').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await page.locator('tr:has-text("Företagskort") button:has-text("Importera")').click();
    await page.waitForURL(/ok=/);
  };
  await importCsv('kort1.csv', ['2026-11-03;-499,00;KORTKÖP 261103 TELIA SVERIGE AB', '2026-11-04;-1250,00;KORTKÖP 261104 CIRCLE K', '2026-11-06;-1100,00;KORTKÖP 261106 CIRCLE K',
    '2026-11-10;-980,00;KORTKÖP 261110 CIRCLE K', '2026-11-08;-95,00;AVGIFT FÖRETAGSPAKET']);

  await page.goto(B + '/bank/regler');
  await page.click('button:has-text("Lägg till vanliga regler")');
  await waitMsg(page, 'vanliga regler är tillagda');
  let t = await text(page);
  assert(t.includes('Telia') && t.includes('6212') && t.includes('Bankavgifter') && t.includes('6570'), 'startregler: ' + t.slice(0, 1500));
  log('vanliga regler tillagda (Skatteverket, bankavgifter, ränta, Telia, Tele2, Telenor)');

  await page.goto(B + '/bank/avstamning');
  const card = (txt) => page.locator(`.card:has-text("${txt}")`).first();
  t = await card('TELIA SVERIGE').textContent();
  assert(t.includes('6212') && t.includes('25 % moms') && t.includes('regel ”Telia”'), 'Telia-förslag: ' + t);
  t = await card('AVGIFT FÖRETAGSPAKET').textContent();
  assert(t.includes('6570') && t.includes('Bankavgifter'), 'avgift: ' + t);
  log('regelförslag: Telia → 6212 med 25 % moms, avgift → 6570');

  // Circle K bokförs för hand två gånger → tredje gången föreslås samma konto
  for (const d of ['261104', '261106']) {
    await page.goto(B + '/bank/avstamning');
    const c = card(`${d} CIRCLE K`);
    await c.locator('summary:has-text("Bokför mot konto")').click();
    await c.locator('input[name=account]').fill('5611');
    await c.locator('select[name=vat_rate]').selectOption('25');
    await c.locator('details button:text-is("Bokför")').click();
    await waitMsg(page, 'Transaktionen är avstämd');
  }
  await page.goto(B + '/bank/avstamning');
  t = await card('261110 CIRCLE K').textContent();
  assert(t.includes('5611') && t.includes('bokförd så 2 gånger tidigare'), 'inlärt förslag: ' + t);
  log('inlärning: Circle K bokförd två gånger på 5611 → föreslås tredje gången');

  // Skapa regel från en avstämd transaktion, med automatisk bokföring
  await page.goto(B + '/bank/avstamning?status=matched');
  await page.locator('.card:has-text("261104 CIRCLE K") a:has-text("Skapa regel")').click();
  await page.waitForURL(/bank\/regler\?/);
  assert(await page.inputValue('form:has(button:has-text("Spara regel")) input[name=pattern]') === 'circle' && await page.inputValue('form:has(button:has-text("Spara regel")) input[name=account]') === '5611', 'förifylld regel');
  await page.fill('form:has(button:has-text("Spara regel")) input[name=name]', 'Drivmedel Circle K');
  await page.selectOption('form:has(button:has-text("Spara regel")) select[name=vat_rate]', '25');
  await page.check('form:has(button:has-text("Spara regel")) input[name=auto]');
  await page.click('button:has-text("Spara regel")');
  await waitMsg(page, 'Regeln är sparad');
  assert(page.url().includes('/bank/avstamning'), 'tillbaka till avstämningen');
  log('regel skapad från avstämd transaktion (förifylld: circle → 5611), automatisk');

  await page.click('button:has-text("Bokför alla kontoförslag")');
  await waitMsg(page, 'transaktioner bokfördes enligt förslagen');
  t = await text(page);
  assert(!t.includes('TELIA') && !t.includes('CIRCLE') && !t.includes('FÖRETAGSPAKET'), 'alla bokförda: ' + t.slice(0, 1500));
  const r6212 = await balance(6212);
  assert(r6212.change === 39920, 'Telia netto 399,20 på 6212: ' + JSON.stringify(r6212));
  log('alla kontoförslag bokförda på en gång: Telia 399,20 + moms 99,80');

  await importCsv('kort2.csv', ['2026-11-15;-600,00;KORTKÖP 261115 CIRCLE K', '2026-11-16;-200,00;KORTKÖP 261116 ICA SUPERMARKET']);
  await page.goto(B + '/bank/avstamning');
  await page.click('button:has-text("Stäm av säkra matchningar automatiskt")');
  await waitMsg(page, 'stämdes av automatiskt');
  t = await text(page);
  assert(!t.includes('261115 CIRCLE K') && t.includes('ICA SUPERMARKET'), 'automatisk regel: ' + t.slice(0, 1500));
  await page.goto(B + '/bank/regler');
  t = await text(page);
  assert(/Drivmedel Circle K Automatisk.*circle.*5611.*2/.test(t), 'regelns användning: ' + t.slice(0, 2000));
  log('automatisk regel bokför ny Circle K-transaktion direkt, ICA lämnas för granskning');

  // ================= ROT =================
  const cust = await api('POST', '/customers', { name: 'Eva Privat', address: 'Ekbacken 3', postal_code: '123 45', city: 'Stockholm' });
  await page.goto(B + '/fakturor/ny');
  await page.selectOption('select[name=customer_id]', { label: 'Eva Privat' });
  await page.fill('input[name=invoice_date]', '2026-11-10');
  await page.selectOption('select[name=reduction_type]', 'rot');
  const rows = page.locator('tbody tr');
  await rows.nth(0).locator('td').nth(0).locator('input').fill('Målning vardagsrum');
  await rows.nth(0).locator('td').nth(1).locator('input').fill('10');
  await rows.nth(0).locator('td').nth(2).locator('input').fill('h');
  await rows.nth(0).locator('td').nth(3).locator('input').fill('500');
  await rows.nth(0).locator('input[type=checkbox]').check();
  await page.click('button:has-text("+ Rad")');
  await rows.nth(1).locator('td').nth(0).locator('input').fill('Färg och material');
  await rows.nth(1).locator('td').nth(3).locator('input').fill('2000');
  await page.fill('input[name=buyer_pnr]', '19121212-1212');
  await page.fill('input[name=work_type]', 'Målning och tapetsering');
  await page.fill('input[name=property]', 'Stockholm Ekbacken 1:23');
  t = (await page.locator('form').first().textContent()).replace(/\s+/g, ' ');
  assert(t.includes('ROT-avdrag (30 % av arbete 6 250,00)') && t.includes('−1 875,00') && t.includes('Att betala6 875,00'), 'förhandsvisning: ' + t.slice(-1500));
  await page.click('button:has-text("Spara utkast")');
  await waitMsg(page, 'Utkastet är sparat');
  await page.click('button:has-text("Bokför")');
  await waitMsg(page, 'Fakturan är bokförd');
  const invUrl = page.url().split('?')[0];
  t = await text(page);
  assert(t.includes('Totalt inkl. moms8 750,00') && t.includes('ROT-avdrag (30 % av arbetskostnad 6 250,00 kr inkl. moms)−1 875,00') && t.includes('Att betala SEK6 875,00')
    && t.includes('personnummer 19121212-1212') && t.includes('Fastighet: Stockholm Ekbacken 1:23') && t.includes('har F-skatt'), 'ROT-faktura: ' + t.slice(0, 3000));
  assert((await balance(1513)).change === 187500, '1513 efter bokföring');
  log('ROT-faktura: 8 750 kr, avdrag 30 % av arbete 6 250 = 1 875 kr, kunden betalar 6 875 kr; 1 875 kr på 1513');

  await page.fill('form:has(input[name=amount]) input[name=date]', '2026-11-12');
  await page.click('button:has-text("Registrera inbetalning")');
  await waitMsg(page, 'betal');
  await page.goto(B);
  assert((await text(page)).includes('ROT/RUT att begära från Skatteverket'), 'att göra');
  await page.goto(B + '/fakturor/rotrut');
  t = await text(page);
  assert(t.includes('Att begära (1)') && t.includes('19121212-1212') && t.includes('Målning och tapetsering') && t.includes('6 250,00') && t.includes('2 500,00') && t.includes('6 875,00')
    && t.includes('1 875,00') && t.includes('Stockholm Ekbacken 1:23') && t.includes('2027-01-31'), 'underlag för begäran: ' + t.slice(0, 2500));
  await page.click('button:has-text("Markera valda som begärda")');
  await waitMsg(page, '1 fakturor är markerade som begärda');
  await page.locator('tr:has-text("Eva Privat") button:has-text("Registrera beslut")').click();
  await waitMsg(page, 'Utbetalningen från Skatteverket är bokförd');
  assert((await balance(1513)).change === 0 && (await balance(1630)).change >= 187500, '1513 nollad, 1630 ökad');
  log('kunden betalar → begäran med alla uppgifter för e-tjänsten → beslut 1 875 kr till skattekontot, 1513 nollad');

  // ================= RUT, delvis beviljat =================
  const rut = await api('POST', '/invoices', { customer_id: cust.json.id, invoice_date: '2026-11-11', book: true, reduction_type: 'rut', buyer_pnr: '191212121212', work_type: 'Städning',
    lines: [{ description: 'Storstädning', quantity: 4, unit: 'h', unit_price: 25000, vat_rate: 25, labor: true }] });
  assert(rut.status === 201 && rut.json.tax_reduction === 62500 && rut.json.total === 62500, 'RUT via API: ' + JSON.stringify(rut.json).slice(0, 400));
  const bad = await api('POST', '/invoices', { customer_id: cust.json.id, invoice_date: '2026-11-11', book: true, reduction_type: 'rot', buyer_pnr: '191212121212', work_type: 'Snickeri',
    lines: [{ description: 'Snickeri', quantity: 1, unit: 'h', unit_price: 50000, vat_rate: 25, labor: true }] });
  assert(bad.status === 400 && bad.json.error.message.includes('fastighetsbeteckning'), 'ROT utan fastighet nekas: ' + JSON.stringify(bad.json));
  await api('POST', `/invoices/${rut.json.id}/payments`, { date: '2026-11-13' });
  await page.goto(B + '/fakturor/rotrut');
  await page.click('button:has-text("Markera valda som begärda")');
  await waitMsg(page, 'markerade som begärda');
  const row = page.locator(`tr:has(a:text-is("${rut.json.number}"))`);
  await row.locator('input[name=amount]').fill('400');
  await row.locator('button:has-text("Registrera beslut")').click();
  await waitMsg(page, 'mellanskillnaden ligger som utkast');
  await page.locator('summary:has-text("Avslutade")').click();
  t = await text(page);
  assert(t.includes('Delvis beviljad') && t.includes('400,00 av 625,00') && /Eva Privat\s*19121212-1212\s*1 875,00\s*400,00/.test(t), 'delvis beviljat: ' + t.slice(-1500));
  await page.click('a:has-text("Faktura på mellanskillnaden")');
  await page.waitForURL(/fakturor\/\d+/);
  t = await text(page);
  assert(t.includes('Ej beviljat rut-avdrag') && t.includes('225,00') && t.includes('Utkast'), 'mellanskillnad: ' + t.slice(0, 1500));
  log('RUT 625 kr, Skatteverket beviljar 400 kr → faktura till kunden på 225 kr (utkast); summa per köpare');

  await browser.close();
  console.log('Alla tester för bankregler och ROT/RUT gick igenom');
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
