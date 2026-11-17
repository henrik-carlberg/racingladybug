// End-to-end: projektmodulen – projektplan, delmoment med fakturering, uppgifter med tid, kostnader och lönsamhet.
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
  const B = `${BASE}/c/1`, M = `${B}/m/projekt`;

  await page.goto(B + '/moduler');
  await page.locator('.card:has(h2:text-is("Projekt")) button:has-text("Aktivera")').click();
  await page.waitForURL(/ok=/);

  await page.goto(M);
  await page.selectOption('select[name=customer_id]', { index: 0 });
  await page.fill('input[name=name]', 'Ny webbplats');
  await page.selectOption('select[name=billing]', 'fixed');
  await page.fill('input[name=hourly_rate]', '1000');
  await page.selectOption('select[name=manager_user_id]', { label: 'Ägare Testsson' });
  await page.fill('input[name=start_date]', '2026-11-01');
  await page.fill('input[name=end_date]', '2027-02-28');
  await page.fill('input[name=budget_hours]', '40');
  await page.fill('input[name=budget_revenue]', '60000');
  await page.fill('input[name=internal_rate]', '500');
  await page.click('button:has-text("Skapa projekt")');
  await waitMsg(page, 'Projektet är skapat');
  const P = page.url().split('?')[0];
  log('projekt med plan och budget');

  for (const [name, due, amount] of [['Design klar', '2026-12-15', '20000'], ['Lansering', '2027-02-15', '40000']]) {
    await page.fill('form:has(button:has-text("Lägg till")) input[placeholder="T.ex. Förstudie klar"]', name);
    await page.fill('form:has(input[placeholder="T.ex. Förstudie klar"]) input[name=due_date]', due);
    await page.fill('form:has(input[placeholder="T.ex. Förstudie klar"]) input[name=amount]', amount);
    await page.click('form:has(input[placeholder="T.ex. Förstudie klar"]) button:has-text("Lägg till")');
    await waitMsg(page, 'Delmomentet är tillagt');
    await page.goto(P);
  }
  for (const [title, est, ms] of [['Skisser', '8', 'Design klar'], ['Utveckling', '24', 'Lansering'], ['Test', '8', 'Lansering']]) {
    await page.fill('form:has(button:has-text("Lägg till uppgift")) input[name=title]', title);
    await page.fill('form:has(button:has-text("Lägg till uppgift")) input[name=estimate]', est);
    await page.selectOption('form:has(button:has-text("Lägg till uppgift")) select[name=assignee_user_id]', { label: 'Ägare Testsson' });
    await page.selectOption('form:has(button:has-text("Lägg till uppgift")) select[name=milestone_id]', { label: ms });
    await page.click('button:has-text("Lägg till uppgift")');
    await waitMsg(page, 'Uppgiften är tillagd');
    await page.goto(P);
  }
  log('två delmoment och tre uppgifter');

  const card = page.locator('.card:has(b:text-is("Skisser"))');
  await card.locator('input[name=hours]').fill('6');
  await card.locator('button:has-text("Rapportera")').click();
  await waitMsg(page, 'Tiden är rapporterad');
  await page.goto(P);
  await page.locator('.card:has(b:text-is("Skisser")) button:has-text("→ Klart")').click();
  await waitMsg(page, 'Uppgiften är flyttad');
  let t = await text(page);
  assert(t.includes('Färdigt20 %') && t.includes('Timmar6 h') && t.includes('av 40 h (15 %)') && t.includes('prognos 30 h'), 'framdrift: ' + t.slice(0, 1200));
  log('6 h på Skisser, klar: 20 % färdigt, prognos 30 h av 40');

  await page.locator('tr:has-text("Design klar") button:has-text("Markera klart")').click();
  await waitMsg(page, 'Delmomentet är klart');
  await page.locator('tr:has-text("Design klar") button:has-text("Fakturera")').click();
  await waitMsg(page, 'Fakturautkastet för delmomentet är skapat');
  t = await text(page);
  assert(t.includes('Ny webbplats – Design klar') && t.includes('25 000,00'), 'delfaktura: ' + t.slice(0, 1000));
  await page.click('button:has-text("Bokför faktura")');
  await waitMsg(page, 'bokförd');
  log('delmoment fakturerat: 20 000 kr + moms');

  await page.goto(P);
  await page.fill('form:has(input[placeholder="T.ex. del av licens, resa"]) input[name=description]', 'Bildlicenser');
  await page.fill('form:has(input[placeholder="T.ex. del av licens, resa"]) input[name=amount]', '1000');
  await page.click('form:has(input[placeholder="T.ex. del av licens, resa"]) button:has-text("Lägg till")');
  await waitMsg(page, 'Kostnaden är tillagd');
  t = await text(page);
  assert(t.includes('Intäkter20 000,00') && t.includes('Resultat16 000,00') && t.includes('marginal 80 %') && t.includes('intern tid 3 000,00'), 'lönsamhet: ' + t.slice(0, 1500));
  log('lönsamhet: 20 000 − 1 000 − 6 h × 500 = 16 000 kr (80 %)');

  await page.goto(M + '/mina-uppgifter');
  t = await text(page);
  assert(t.includes('Utveckling') && t.includes('Test') && !t.includes('Skisser'), 'mina uppgifter');
  await page.locator('.card:has(b:text-is("Utveckling")) button:has-text("→ Pågår")').click();
  await waitMsg(page, 'Uppgiften är flyttad');
  assert(page.url().includes('mina-uppgifter'), 'stannar på mina uppgifter');
  await page.goto(M);
  t = await text(page);
  assert(t.includes('Ny webbplats') && t.includes('Pågår') && t.includes('20 %') && t.includes('16 000,00'), 'portfölj: ' + t.slice(0, 1200));
  log('mina uppgifter och projektportfölj');

  await browser.close();
})().catch((e) => { console.error('FEL:', e.message); process.exit(1); });
