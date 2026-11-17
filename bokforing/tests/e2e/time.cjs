// End-to-end: uppdrag, aktiviteter, tidrapportering, fakturaunderlag, timbank med månadsavräkning, API och cron.
// Körs efter flow.cjs (ägarkonto, aktiebolag 1 och minst en kund finns). Servern startas med CRON_SECRET=testcron.
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const waitMsg = (page, text) => page.waitForURL((u) => decodeURIComponent(u.toString()).includes(text), { timeout: 20000 });
const text = async (page) => {
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('main h1');
  return (await page.locator('main').textContent()).replace(/\s+/g, ' ');
};

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

  async function createProject(name, billing, rate, activities) {
    await page.goto(B + '/uppdrag');
    await page.fill('input[name=name]', name);
    await page.selectOption('select[name=billing]', billing);
    await page.fill('input[name=hourly_rate]', rate);
    await page.fill('textarea[name=activities]', activities);
    await page.click('button:has-text("Skapa uppdrag")');
    await page.waitForURL(/uppdrag\/\d+/);
    return page.url().split('?')[0];
  }
  async function report(date, activityLabel, hours, description, billable = true) {
    await page.goto(`${B}/tid?week=${date}`);
    await page.fill('input[name=date]', date);
    await page.selectOption('select[name=activity_id]', { label: activityLabel });
    await page.fill('input[name=hours]', hours);
    await page.fill('input[name=description]', description);
    if (!billable) await page.uncheck('input[name=billable]');
    await page.click('button:has-text("Spara tid")');
    await waitMsg(page, 'Tiden är sparad');
  }

  // Löpande räkning
  const P1 = await createProject('Webbshop', 'hourly', '1000', 'Utveckling\nMöte');
  await page.fill('form:has(button:has-text("Lägg till")) input[name=name]', 'Projektledning');
  await page.fill('form:has(button:has-text("Lägg till")) input[name=hourly_rate]', '1200');
  await page.click('button:has-text("Lägg till")');
  await waitMsg(page, 'Aktiviteten är tillagd');
  log('uppdrag med aktiviteter och eget timpris');

  await report('2026-11-16', 'Webbshop – Utveckling', '1,5', 'Startmöte och kravlista');
  await report('2026-11-17', 'Webbshop – Utveckling', '2:30', 'Produktsidor');
  await report('2026-11-17', 'Webbshop – Projektledning', '1', 'Planering');
  await report('2026-11-18', 'Webbshop – Utveckling', '0,5', 'Intern genomgång', false);
  await page.goto(`${B}/tid?week=2026-11-16`);
  const week = await text(page);
  assert(week.includes('Vecka 47') && week.includes('5,5 h') && week.includes('Ej debiterbar'), 'veckovy: ' + week.slice(0, 600));
  log('tid rapporterad: 5,5 h varav 5 h debiterbart');

  await page.goto(P1);
  assert((await text(page)).includes('Ofakturerat') && (await text(page)).includes('5 200,00'), 'ofakturerat värde');
  await page.fill('input[name=to]', '2026-11-30');
  await page.click('button:has-text("Skapa fakturaunderlag")');
  await waitMsg(page, 'Fakturaunderlaget är skapat');
  let inv = await text(page);
  assert(inv.includes('Utveckling, Webbshop') && inv.includes('4 h') && inv.includes('Projektledning, Webbshop') && inv.includes('1 200,00')
    && inv.includes('Tidsspecifikation') && inv.includes('Produktsidor') && !inv.includes('Intern genomgång') && inv.includes('6 500,00'), 'fakturaunderlag: ' + inv.slice(0, 1500));
  await page.click('button:has-text("Bokför faktura")');
  await waitMsg(page, 'bokförd');
  await page.goto(`${B}/tid?week=2026-11-16`);
  assert(await page.locator('a:has-text("Fakturerad")').count() === 3, 'tre rader fakturerade');
  log('fakturaunderlag: 4 h utveckling + 1 h projektledning = 6 500 kr inkl. moms, tidsspecifikation, tiden låst');

  // Timbank
  const P2 = await createProject('Support', 'hour_bank', '900', 'Support');
  await page.fill('input[name=hours]', '10');
  await page.click('button:has-text("Skapa faktura för timbank")');
  await waitMsg(page, 'Fakturan för timbanken är skapad');
  inv = await text(page);
  assert(inv.includes('Timbank 10 h – Support') && inv.includes('11 250,00'), 'timbanksfaktura: ' + inv.slice(0, 800));
  await page.click('button:has-text("Bokför faktura")');
  await waitMsg(page, 'bokförd');
  await report('2026-10-15', 'Support – Support', '3', 'Felsökning');
  await report('2026-10-20', 'Support – Support', '1:30', 'Uppdatering');
  await page.goto(P2);
  assert((await text(page)).includes('5,5 hKöpt 10 h · avräknat 0 h · ej avräknat 4,5 h'), 'kvar före avräkning: ' + (await text(page)).slice(0, 600));
  await page.fill('input[name=period]', '2026-10');
  await page.click('button:has-text("Skapa avräkning")');
  await waitMsg(page, 'Avräkningen är skapad');
  inv = await text(page);
  assert(inv.includes('Timbank – avräkning oktober 2026') && inv.includes('Köpta timmar totalt10 h') && inv.includes('Använt oktober 20264,5 h')
    && inv.includes('Kvar i timbanken5,5 h') && inv.includes('Att betala SEK0,00'), 'avräkning oktober: ' + inv.slice(0, 1500));
  await page.click('button:has-text("Bokför faktura")');
  await waitMsg(page, 'bokförd');
  assert(await page.locator('.badge:has-text("Betald")').count(), 'avräkning på 0 kr är reglerad');
  log('timbank 10 h köpt, oktober: 4,5 h använda, 5,5 h kvar (faktura 0 kr)');

  await report('2026-11-10', 'Support – Support', '7', 'Migrering');
  await page.goto(P2);
  await page.fill('input[name=period]', '2026-10');
  await page.click('button:has-text("Skapa avräkning")');
  await waitMsg(page, 'Det finns redan en avräkning för oktober 2026');
  await page.fill('input[name=period]', '2026-11');
  await page.click('button:has-text("Skapa avräkning")');
  await waitMsg(page, 'Avräkningen är skapad');
  inv = await text(page);
  assert(inv.includes('Varav utöver timbanken (faktureras)1,5 h') && inv.includes('Kvar i timbanken0 h') && inv.includes('Timmar utöver timbanken, november 2026')
    && inv.includes('1 350,00') && inv.includes('1 688,00'), 'avräkning november med övertid: ' + inv.slice(0, 1500));
  log('november: 7 h använda, 5,5 h från banken, 1,5 h övertid faktureras 1 688 kr (avrundat)');

  // API
  await page.goto(B + '/integrationer');
  await page.fill('input[name=name]', 'Tidsystem');
  for (const s of ['time:write']) await page.check(`input[name=scopes][value="${s}"]`);
  await page.click('button:has-text("Skapa API-nyckel")');
  const token = (await page.locator('.flash.ok code').textContent({ timeout: 10000 })).trim();
  const api = async (method, path, body) => {
    const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  const projects = await api('GET', '/projects?active=true');
  const support = projects.json.data.find((p) => p.name === 'Support');
  assert(support && support.bank && support.bank.remaining === 0, 'projekt via API: ' + JSON.stringify(projects.json).slice(0, 400));
  const te = await api('POST', '/time-entries', { activity_id: support.activities[0].id, date: '2026-12-01', hours: '1,5', description: 'Via API' });
  assert(te.status === 201 && te.json.minutes === 90, 'tid via API: ' + JSON.stringify(te.json));
  const del = await api('DELETE', `/time-entries/${te.json.id}`);
  assert(del.status === 200 && del.json.deleted, 'ta bort tid via API');
  log('API: uppdrag med timbanksaldo, rapportera och ta bort tid');

  // Cron: förra månadens avräkningar finns redan → inga nya
  const cron = await fetch(`${BASE}/api/cron/timbank`, { headers: { Authorization: 'Bearer testcron' } });
  const cj = await cron.json();
  assert(cron.status === 200 && cj.period && cj.created >= 0, 'cron: ' + JSON.stringify(cj));
  assert((await fetch(`${BASE}/api/cron/timbank`)).status === 401, 'cron utan hemlighet');
  log('cron för månadsavräkningar', JSON.stringify(cj));

  await browser.close();
})().catch((e) => { console.error('FEL:', e.message); process.exit(1); });
