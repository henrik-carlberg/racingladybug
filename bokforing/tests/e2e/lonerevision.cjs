// End-to-end: lönerevisionsmodulen – utrymme, förslag, godkännande, lönebesked, genomförande, retroaktiv lön och lönekartläggning.
// Körs efter flow.cjs (Anna Andersson 35 000 kr, lönekörning 2026-05 bokförd) och bank-hr.cjs.
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

  await page.goto(B + '/moduler');
  await page.locator('.card:has(h2:text-is("Lönerevision")) button:has-text("Aktivera")').click();
  await page.waitForURL(/ok=/);
  const M = B + '/m/lonerevision';
  log('modulen aktiverad');

  await page.goto(M + '/ny');
  await page.fill('input[name=name]', 'Lönerevision 2026');
  await page.fill('input[name=effective_date]', '2026-05-01');
  await page.fill('input[name=budget_percent]', '3');
  await page.fill('textarea[name=criteria]', 'Ansvar, resultat och samarbete');
  await page.click('button:has-text("Skapa lönerevision")');
  await waitMsg(page, 'Lönerevisionen är skapad');
  const R = page.url().split('?')[0];
  let t = await text(page);
  assert(t.includes('Anna Andersson') && t.includes('35 000,00') && t.includes('Utrymme (3 %)'), 'revision: ' + t.slice(0, 800));
  log('lönerevision med alla aktiva anställda och utrymme 3 %');

  await page.fill('input[name=percent]', '3');
  await page.click('button:has-text("Fördela")');
  await waitMsg(page, 'Höjningen är utlagd');
  const annaId = await page.locator('tr:has-text("Anna Andersson") input[name=employee_id]').inputValue();
  await page.fill(`input[name=percent_${annaId}]`, '4');
  await page.fill(`input[name=comment_${annaId}]`, 'Utökat ansvar för lönen');
  await page.click('button:has-text("Spara förslag")');
  await waitMsg(page, 'Förslagen är sparade');
  t = await text(page);
  assert(await page.inputValue(`input[name=new_${annaId}]`) === '36400' && t.includes('1 400,00') && t.includes('4 %') && t.includes('Över budget'), 'förslag: ' + t.slice(0, 1500));
  log('3 % till alla, Anna 4 % (36 400 kr) med motivering');

  await page.click('button:has-text("Godkänn lönerevisionen")');
  await waitMsg(page, 'Lönerevisionen är godkänd');
  await page.click('button:has-text("Skicka lönebesked för e-signering")');
  await waitMsg(page, 'lönebesked är skickade');
  log('godkänd och lönebesked skickade:', decodeURIComponent(page.url()).split('ok=')[1]);

  await page.click('button:has-text("Genomför")');
  await waitMsg(page, 'De nya lönerna är införda');
  t = await text(page);
  assert(t.includes('Genomförd') && t.includes('Retroaktiv lön') && t.includes('1 400,00') && t.includes('Ej utbetald'), 'genomförd: ' + t.slice(-1500));
  await page.goto(B + '/lon/anstallda');
  assert((await text(page)).includes('36 400,00'), 'ny lön i lönen');
  log('genomförd: ny lön i lönen och retroaktiv lön 1 400 kr för maj');

  await page.goto(B + '/lon');
  await page.fill('input[name=period]', '2026-12');
  await page.fill('input[name=payment_date]', '2026-12-23');
  await page.click('button:has-text("Ny lönekörning")');
  await page.waitForURL(/lon\/\d+\?ok/);
  await page.goto(R);
  await page.selectOption('select[name=run_id]', { label: '2026-12' });
  await page.click('button:has-text("Lägg in retroaktiv lön")');
  await waitMsg(page, 'Retroaktiv lön är inlagd');
  await page.goto(B + '/lon');
  await page.click('a:has-text("2026-12")');
  await page.waitForURL(/lon\/\d+/);
  t = await text(page);
  assert(await page.locator('input[value="Retroaktiv lön från 2026-05-01 (lönerevision)"]').count() === 1 && t.includes('37 800,00'), 'retrorad i lönekörningen: ' + t.slice(0, 1500));
  log('retroaktiv lön inlagd i lönekörningen 2026-12: bruttolön 36 400 + 1 400 = 37 800');

  await page.goto(M);
  t = await text(page);
  assert(t.includes('Lönehistorik') && t.includes('Anna Andersson') && t.includes('36 400,00'), 'lönehistorik');
  await page.goto(M + '/kartlaggning');
  t = await text(page);
  assert(t.includes('Lönekartläggning') && t.includes('Kvinnors lön av mäns'), 'kartläggning');
  log('lönehistorik och underlag för lönekartläggning');

  await browser.close();
})().catch((e) => { console.error('FEL:', e.message); process.exit(1); });
