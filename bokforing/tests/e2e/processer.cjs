// End-to-end: avtal och återkommande fakturering, kundreskontra och påminnelser, likviditet och budget, utlägg och reseräkningar.
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const waitMsg = (page, text) => page.waitForURL((u) => decodeURIComponent(u.toString()).includes(text), { timeout: 20000 });
const text = async (page) => { await page.waitForLoadState('networkidle'); await page.waitForSelector('main h1'); return (await page.locator('main').textContent()).replace(/\s+/g, ' '); };
// Dagens datum i Stockholm ± n dagar (räknat på datumet, så sommartid och sena kvällar inte ger fel dag)
const day = (n) => { const d = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

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
  async function activate(name) {
    await page.goto(B + '/moduler');
    await page.locator(`.card:has(h2:text-is("${name}")) button:has-text("Aktivera")`).click();
    await page.waitForURL(/ok=/);
  }

  // ---------- Avtal ----------
  await activate('Avtal och abonnemang');
  await page.goto(B + '/m/avtal/nytt');
  await page.selectOption('select[name=customer_id]', { index: 0 });
  await page.fill('input[name=name]', 'Supportavtal');
  await page.fill('input[name=start_date]', day(-65));
  await page.fill('input[name=d_0]', 'Support');
  await page.fill('input[name=p_0]', '1000');
  await page.fill('input[name=d_1]', 'Hosting');
  await page.fill('input[name=q_1]', '2');
  await page.fill('input[name=p_1]', '250');
  await page.click('button:has-text("Skapa avtal")');
  await waitMsg(page, 'Avtalet är skapat');
  const A = page.url().split('?')[0];
  await page.click('button:has-text("Fakturera förfallna perioder")');
  await waitMsg(page, '3 fakturor är skapade');
  let t = await text(page);
  assert(t.includes('1 500,00') && t.includes('MRR 1 500,00') && (t.match(/Utkast/g) || []).length >= 3, 'avtal: ' + t.slice(0, 1200));
  await page.click('button:has-text("Fakturera förfallna perioder")');
  await waitMsg(page, 'Inga perioder att fakturera');
  log('månadsavtal 1 500 kr startat för 65 dagar sedan: 3 periodfakturor i förskott, inga dubbletter');
  await page.fill('input[name=notice_date]', day(0));
  await page.click('button:has-text("Registrera uppsägning")');
  await waitMsg(page, 'Avtalet är uppsagt');
  t = await text(page);
  assert(t.includes(`Löper till${addMonths(day(0), 3)}`), 'uppsägning 3 månader: ' + t.slice(0, 900));
  log('uppsägning: löper ut efter 3 månaders uppsägningstid');

  // ---------- Reskontra ----------
  await activate('Kundreskontra och påminnelser');
  await page.goto(B + '/m/reskontra/installningar');
  await page.fill('input[name=reference_rate]', '2,00');
  await page.click('button:has-text("Spara")');
  await waitMsg(page, 'Inställningarna är sparade');
  await page.goto(B + '/integrationer');
  await page.fill('input[name=name]', 'Reskontratest');
  await page.check('input[name=scopes][value="sales:write"]');
  await page.click('button:has-text("Skapa API-nyckel")');
  const token = (await page.locator('.flash.ok code').textContent({ timeout: 10000 })).trim();
  const api = async (method, path, body) => {
    const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  const cust = await api('POST', '/customers', { name: 'Sen Betalare AB', email: 'ekonomi@senbetalare.example' });
  const inv = await api('POST', '/invoices', { customer_id: cust.json.id, invoice_date: day(-50), due_date: day(-40), book: true, lines: [{ description: 'Konsult', unit_price: 1000000, vat_rate: 25 }] });
  assert(inv.json.status === 'booked', 'förfallen faktura');
  await page.goto(B + '/m/reskontra');
  t = await text(page);
  assert(t.includes('Sen Betalare AB') && t.includes('12 500,00') && t.includes('137,00'), 'åldersanalys och ränta: ' + t.slice(0, 1500));
  const row = page.locator(`tr:has(a:text-is("${inv.json.number}"))`);
  await row.locator('button:has-text("Påminnelse 1")').click();
  await waitMsg(page, 'Påminnelse 1 är skapad');
  t = await text(page);
  assert(t.includes(`faktura ${inv.json.number}`) && t.includes('60,00 kr') && t.includes('137,00 kr') && t.includes('OCR'), 'påminnelsebrev: ' + t.slice(0, 1200));
  await page.goto(B + '/m/reskontra');
  await page.locator(`tr:has(a:text-is("${inv.json.number}")) button:has-text("Påminnelse 2")`).click();
  await waitMsg(page, 'Påminnelse 2 är skapad');
  await page.goto(B + '/m/reskontra');
  await page.locator(`tr:has(a:text-is("${inv.json.number}")) button:has-text("Markera för inkasso")`).click();
  await waitMsg(page, 'markerad för inkasso');
  t = await text(page);
  assert(t.includes('Underlag för inkasso') && t.includes('Sen Betalare AB'), 'inkassounderlag');
  log('förfallen 40 dagar: ränta 137 kr (10 %), påminnelse 1 och 2 med avgift 60 kr, inkassounderlag');
  await page.goto(`${B}/m/reskontra/kund/${cust.json.id}`);
  await page.click('button:has-text("Fakturera påminnelseavgift och ränta")');
  await waitMsg(page, 'Fakturautkast för avgifter och ränta är skapat');
  t = await text(page);
  assert(t.includes('Påminnelseavgift faktura') && t.includes('Dröjsmålsränta faktura') && t.includes('257,00'), 'avgiftsfaktura: ' + t.slice(0, 1200));
  log('avgiftsfaktura: 2 × 60 kr + ränta 137 kr = 257 kr, momsfri');

  // ---------- Likviditet och budget ----------
  await activate('Likviditet och budget');
  await page.goto(B + '/m/likviditet');
  await page.fill('form:has(button:has-text("Lägg till")) input[name=date]', day(3));
  await page.fill('input[name=description]', 'Lokalhyra');
  await page.fill('form:has(button:has-text("Lägg till")) input[name=amount]', '8000');
  await page.selectOption('select[name=recurrence]', 'monthly');
  await page.click('button:has-text("Lägg till")');
  await waitMsg(page, 'Posten är tillagd');
  await page.fill('input[name=min_balance]', '10000000');
  await page.click('form:has(input[name=min_balance]) button:has-text("Spara")');
  await waitMsg(page, 'Inställningarna är sparade');
  t = await text(page);
  assert(t.includes('Kassa och bank idag') && t.includes('Lokalhyra') && t.includes('-8 000,00') && t.includes('väntas gå under') && t.includes('Kundfaktura'), 'likviditet: ' + t.slice(0, 1500));
  log('likviditetsprognos 13 veckor med kundfakturor, avtal, återkommande hyra och varning för lågt saldo');
  const year = Number(day(0).slice(0, 4));
  await page.goto(`${B}/m/likviditet/budget?ar=${year + 1}`);
  await page.fill('input[name=percent]', '10');
  await page.click('button:has-text("Fyll i budget")');
  await waitMsg(page, 'Budgeten är ifylld');
  await page.fill('input[name=revenue_1]', '100000');
  await page.click('button:has-text("Spara budget")');
  await waitMsg(page, 'Budgeten är sparad');
  t = await text(page);
  assert(t.includes(`Budget och utfall ${year + 1}`) && t.includes('Budgeterat resultat helår') && await page.inputValue('input[name=revenue_1]') === '100000', 'budget: ' + t.slice(0, 800));
  log('budget från förra årets utfall +10 % och manuell justering');

  // ---------- Utlägg ----------
  await activate('Utlägg och reseräkningar');
  await page.goto(B + '/m/utlagg');
  await page.selectOption('select[name=employee_id]', { label: 'Anna Andersson' });
  await page.fill('input[name=title]', 'Kundbesök Borås');
  await page.click('button:text-is("Skapa")');
  await waitMsg(page, 'Utläggsräkningen är skapad');
  const R = page.url().split('?')[0];
  const receipt = page.locator('form:has(button:has-text("Lägg till kvitto"))');
  await receipt.locator('select[name=category]').selectOption('kontor');
  await receipt.locator('input[name=amount]').fill('125');
  await receipt.locator('input[name=file]').setInputFiles({ name: 'kvitto.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await receipt.locator('button').click();
  await waitMsg(page, 'Raden är tillagd');
  await page.goto(R);
  const trip = page.locator('form:has(button:has-text("Lägg till resa"))');
  await trip.locator('input[name=km]').fill('124');
  await trip.locator('input[name=description]').fill('Kontoret – kund i Borås');
  await trip.locator('button').click();
  await waitMsg(page, 'Raden är tillagd');
  await page.goto(R);
  const allow = page.locator('form:has(button:has-text("Lägg till traktamente"))');
  await allow.locator('input[name=days_full]').fill('2');
  await allow.locator('input[name=days_half]').fill('1');
  await allow.locator('input[name=nights]').fill('2');
  await allow.locator('input[name=description]').fill('Göteborg, mässa');
  await allow.locator('button').click();
  await waitMsg(page, 'Raden är tillagd');
  await page.goto(R);
  t = await text(page);
  assert(t.includes('310,00') && t.includes('1 050,00') && t.includes('25,00') && t.includes('1 485,00'), 'utläggsrader: ' + t.slice(0, 1500));
  await page.click('button:has-text("Skicka in för attest")');
  await waitMsg(page, 'inskickad för attest');
  await page.click('button:has-text("Attestera och bokför")');
  await waitMsg(page, 'attesterad och bokförd');
  await page.click('a:text-is("verifikation")');
  await page.waitForURL(/verifikationer\/\d+/);
  t = await text(page);
  assert(t.includes('6110') && t.includes('100,00') && t.includes('2641') && t.includes('7331') && t.includes('7321') && t.includes('2820') && t.includes('1 485,00') && t.includes('kvitto.png'), 'verifikation: ' + t.slice(0, 1500));
  log('kvitto 125 kr, 124 km (310 kr) och traktamente (1 050 kr) attesterade: kostnader och moms mot 2820');
  await page.goto(R);
  if (await page.locator('button:has-text("Lägg till i lönen")').count()) {
    await page.click('button:has-text("Lägg till i lönen")');
    await waitMsg(page, 'betalas ut med lönen');
    log('utbetalning via lönen (skattefri ersättning mot 2820)');
  } else {
    await page.click('button:has-text("Bokför utbetalning")');
    await waitMsg(page, 'Utbetalningen är bokförd');
    log('utbetalning direkt från banken');
  }
  assert((await text(page)).includes('Utbetald'), 'utbetald');

  await browser.close();
  function addMonths(d, n) { const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1 + n, dd = Number(d.slice(8)); const ty = y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12;
    const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate(); return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`; }
})().catch((e) => { console.error('FEL:', e.message); process.exit(1); });
