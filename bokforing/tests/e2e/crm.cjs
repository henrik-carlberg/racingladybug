// End-to-end: CRM-säljpipeline – affär, offert, e-signering av kund → vunnen, faktura, projekt, förlorad affär och prognos.
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
  const B = `${BASE}/c/1`, M = `${B}/m/crm`;

  await page.goto(B + '/moduler');
  const btn = page.locator('.card:has(h2:text-is("CRM")) button:has-text("Aktivera")');
  if (await btn.count()) { await btn.click(); await page.waitForURL(/ok=/); }

  await page.goto(M + '/pipeline');
  let t = await text(page);
  assert(t.includes('Ny möjlighet') && t.includes('Behovsanalys') && t.includes('Offert skickad') && t.includes('Förhandling'), 'standardsteg: ' + t.slice(0, 600));
  await page.fill('input[name=title]', 'Ny webbshop');
  await page.fill('input[name=prospect_name]', 'Nordic Shoes AB');
  await page.fill('input[name=contact_name]', 'Karin Kund');
  await page.fill('input[name=contact_email]', 'karin@example.com');
  await page.fill('input[name=value]', '100000');
  await page.fill('input[name=expected_close]', '2026-12-15');
  await page.fill('input[name=source]', 'Rekommendation');
  await page.click('button:has-text("Skapa affär")');
  await waitMsg(page, 'Affären är skapad');
  const D = page.url().split('?')[0];
  log('affär för prospekt i första steget');

  await page.fill('input[name=d_0]', 'Design');
  await page.fill('input[name=p_0]', '40000');
  await page.fill('input[name=d_1]', 'Utveckling');
  await page.fill('input[name=q_1]', '80');
  await page.fill('input[name=u_1]', 'h');
  await page.fill('input[name=p_1]', '1000');
  await page.click('button:has-text("Spara offert")');
  await waitMsg(page, 'Offerten är sparad');
  t = await text(page);
  assert(t.includes('Summa 120 000,00 kr exkl. moms, 150 000,00 kr inkl. moms') && t.includes('Värde120 000,00'), 'offert: ' + t.slice(0, 1500));
  await page.click('button:has-text("Skicka offert för e-signering")');
  await waitMsg(page, 'Offerten är skickad');
  t = await text(page);
  assert(t.includes('Offert skickad') && t.includes('50 %') && t.includes('viktat 60 000,00'), 'offert skickad: ' + t.slice(0, 1000));
  log('offert 120 000 kr skickad för e-signering → steg Offert skickad, viktat 60 000');

  await page.click('a:has-text("Visa dokument")');
  await page.waitForURL(/\/dokument\/\d+$/);
  const signLink = (await page.locator('code.mono').first().textContent()).trim();
  const ext = await (await browser.newContext()).newPage();
  await ext.goto(signLink);
  assert(await ext.locator('text=Utveckling').count(), 'offerten på signeringssidan');
  await ext.check('input[name=consent]');
  await ext.fill('input[name=signed_name]', 'Karin Kund');
  await ext.click('button:has-text("Signera dokumentet")');
  await ext.locator('text=Du signerade dokumentet').waitFor();
  await page.goto(D);
  t = await text(page);
  assert(t.includes('Vunnen') && t.includes('signerad av kunden') && t.includes('Nordic Shoes AB') && !t.includes('Prospekt'), 'vunnen efter signering: ' + t.slice(0, 1000));
  log('kunden signerade → affären vunnen och kunden skapad automatiskt');

  await page.click('button:has-text("Skapa projekt")');
  await waitMsg(page, 'Projektet är skapat');
  await page.click('button:has-text("Skapa faktura")');
  await waitMsg(page, 'Fakturautkastet är skapat');
  t = await text(page);
  assert(t.includes('Design') && t.includes('80 h') && t.includes('150 000,00') && t.includes('Karin Kund'), 'faktura från offert: ' + t.slice(0, 1200));
  log('projekt och fakturautkast (150 000 kr inkl. moms) från den vunna affären');

  // Andra affären förloras – orsak krävs
  await page.goto(M + '/pipeline');
  await page.selectOption('form:has(button:has-text("Skapa affär")) select[name=customer_id]', { index: 1 });
  await page.fill('input[name=title]', 'Support 2027');
  await page.fill('input[name=value]', '50000');
  await page.fill('input[name=expected_close]', '2027-01-20');
  await page.click('button:has-text("Skapa affär")');
  await waitMsg(page, 'Affären är skapad');
  const lostStage = await page.locator('.card:has(b:text-is("Steg")) select[name=stage_id] option:text-is("Förlorad")').getAttribute('value');
  await page.selectOption('.card:has(b:text-is("Steg")) select[name=stage_id]', lostStage);
  await page.click('.card:has(b:text-is("Steg")) button:has-text("Flytta")');
  await waitMsg(page, 'Ange varför affären förlorades');
  await page.selectOption('.card:has(b:text-is("Steg")) select[name=stage_id]', lostStage);
  await page.selectOption('.card:has(b:text-is("Steg")) select[name=lost_reason]', 'Pris');
  await page.click('.card:has(b:text-is("Steg")) button:has-text("Flytta")');
  await waitMsg(page, 'Affären är flyttad');
  assert((await text(page)).includes('Förlorad') && (await text(page)).includes(': Pris'), 'förlorad med orsak');
  log('förlorad affär kräver orsak (Pris)');

  // Tredje öppen affär i pipelinen
  await page.goto(M + '/pipeline');
  await page.fill('input[name=title]', 'Utbildning');
  await page.fill('input[name=prospect_name]', 'Skola AB');
  await page.fill('input[name=value]', '20000');
  await page.click('button:has-text("Skapa affär")');
  await waitMsg(page, 'Affären är skapad');

  await page.goto(M + '/prognos');
  t = await text(page);
  assert(t.includes('Öppen pipeline20 000,00') && t.includes('Viktad pipeline2 000,00') && t.includes('Vinstandel (12 mån)50 %') && t.includes('Pris1') && t.includes('Snittaffär / säljcykel120 000,00'), 'prognos: ' + t.slice(0, 1500));
  log('prognos och analys: vinstandel 50 %, snittaffär 120 000, förlustorsak Pris');

  await page.goto(M + '/steg');
  await page.fill('input[placeholder="T.ex. Demo genomförd"]', 'Demo genomförd');
  await page.click('button:has-text("Lägg till")');
  await waitMsg(page, 'Steget är sparat');
  await page.goto(M + '/pipeline');
  assert((await text(page)).includes('Demo genomförd'), 'nytt steg i pipelinen');
  log('eget pipelinesteg');

  await browser.close();
})().catch((e) => { console.error('FEL:', e.message); process.exit(1); });
