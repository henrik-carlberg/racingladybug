// End-to-end: kom igång, ingående balanser, kvitton, deadlines, bokslut, deklaration (SRU), årsredovisning och enskild firma.
// Körs efter flow.cjs (ägarkonto och aktiebolag 1 finns).
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const waitMsg = (page, text) => page.waitForURL((u) => decodeURIComponent(u.toString()).includes(text), { timeout: 20000 });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(BASE + '/login');
  await page.fill('input[name=email]', 'agare@example.com');
  await page.fill('input[name=password]', 'hemligtlosen1');
  await page.click('form button:has-text("Logga in")');
  await page.waitForURL(BASE + '/');
  const B = `${BASE}/c/1`;

  // Översikt: snabbval och kom igång
  await page.goto(B);
  assert(await page.locator('text=Vad vill du göra?').count(), 'snabbval');
  assert(await page.locator('text=Nästa deadlines').count(), 'deadlines på översikten');
  await page.goto(B + '/kom-igang');
  const guide = await page.locator('main').textContent();
  assert(guide.includes('Företagsuppgifter') && guide.includes('Ingående balanser') && guide.includes('Första kunden'), 'guidens steg');
  assert(await page.locator('.card:has-text("Första kunden") >> text=✅').count(), 'första kunden klar automatiskt');
  log('översikt och kom igång-guide');

  // Ingående balanser (nystartat AB)
  await page.goto(B + '/kom-igang/ingaende-balanser');
  await page.click('text=Fyll i 25 000 kr aktiekapital');
  assert(await page.locator('text=Balanserar ✓').count(), 'balanserar');
  await page.click('button:has-text("Bokför ingående balanser")');
  await waitMsg(page, 'ingående balanserna är bokförda');
  const ib = await page.locator('main').textContent();
  assert(ib.includes('I1') && ib.includes('2081') && ib.includes('25 000,00'), 'IB-verifikation');
  await page.goto(B + '/kom-igang');
  assert(await page.locator('.card:has-text("Ingående balanser") >> text=✅').count(), 'IB-steget klart');
  // IB ska synas som ingående balans i balansräkningen, inte som rörelse
  await page.goto(B + '/rapporter?from=2026-01-01&to=2026-12-31');
  assert(await page.locator('tr:has-text("2081") >> text=25 000,00').count() >= 1, 'aktiekapital i balansräkningen');
  log('ingående balanser bokförda och visas i balansräkningen');

  // Kvitto: kontorsmaterial med bild
  await page.goto(B + '/kvitto');
  await page.setInputFiles('input[name=file]', { name: 'kvitto.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await page.fill('input[name=date]', '2026-09-15');
  await page.fill('input[name=total]', '500');
  await page.click('button:has-text("Kontorsmaterial")');
  assert(await page.locator('text=Bokförs så här').count(), 'förhandsvisning');
  await page.click('button:has-text("Bokför kvitto")');
  await waitMsg(page, 'Kvittot är bokfört');
  await page.click('main table a >> nth=0');
  await page.waitForURL(/verifikationer\/\d+/);
  const v = await page.locator('main').textContent();
  assert(v.includes('6110') && v.includes('400,00') && v.includes('2641') && v.includes('100,00') && v.includes('kvitto.png'), 'kvittokontering: ' + v.slice(0, 300));
  log('kvitto: 6110 400 + moms 100 mot bank, med bild');

  // Representation, 2 personer, privat utlägg
  await page.goto(B + '/kvitto');
  await page.fill('input[name=date]', '2026-09-16');
  await page.fill('input[name=total]', '1120');
  await page.click('button:has-text("Representation")');
  await page.fill('input[name=persons]', '2');
  await page.selectOption('select[name=paid_with]', 'private');
  assert(await page.locator('text=Momsavdraget begränsas till 72,00').count(), 'begränsat momsavdrag');
  await page.click('button:has-text("Bokför kvitto")');
  await waitMsg(page, 'Kvittot är bokfört');
  await page.click('main table a >> nth=0');
  await page.waitForURL(/verifikationer\/\d+/);
  const rep = await page.locator('main').textContent();
  assert(rep.includes('6072') && rep.includes('1 048,00') && rep.includes('2893') && rep.includes('privat utlägg'), 'representation: ' + rep.slice(0, 300));
  log('representation: momsavdrag max 36 kr/person, privat utlägg till 2893');

  // Deadlines
  await page.goto(B + '/deadlines');
  const dl = await page.locator('main').textContent();
  assert(dl.includes('Momsdeklaration') && dl.includes('Arbetsgivardeklaration') && dl.includes('Inkomstdeklaration 2'), 'deadlines för AB med anställda');
  const first = page.locator('.card:has-text("Momsdeklaration")').first();
  const title = (await first.locator('b').first().textContent()).trim();
  await first.locator('button:has-text("Markera klar")').click();
  await page.waitForLoadState('networkidle');
  assert(!(await page.locator(`.card:has(b:text-is("${title}"))`).count()), 'avbockad försvinner');
  await page.goto(B + '/deadlines?visa=alla');
  assert(await page.locator(`.card:has(b:text-is("${title}")) >> text=Markerad klar av`).count(), 'syns som klar');
  log('deadlines: moms, AGI, INK2 – avbockning');

  // Bokslut 2026: skatt, deklaration, SRU, årsredovisning
  await page.goto(B + '/bokslut');
  await page.click('tr:has-text("2026-01-01") a:has-text("Öppna")');
  await page.waitForURL(/bokslut\/\d+$/);
  const fyUrl = page.url();
  assert(await page.locator('text=Bokför resultat och stäng året').count(), 'stängningssteg');
  assert(await page.locator('button:has-text("Bokför resultat och stäng året")').isDisabled(), 'kan inte stänga pågående år');
  await page.goto(fyUrl + '/deklaration');
  const decl = await page.locator('main').textContent();
  assert(decl.includes('INK2R Räkenskapsschema') && decl.includes('3.1') && decl.includes('Nettoomsättning') && decl.includes('2.26'), 'INK2-underlag');
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('a:has-text("BLANKETTER.SRU")')]);
  const sru = require('fs').readFileSync(await dl1.path(), 'latin1');
  assert(sru.includes('#BLANKETT INK2R-2026P4') && sru.includes('#IDENTITET 165560269986') && sru.includes('#UPPGIFT 7410 ') && sru.trim().endsWith('#FIL_SLUT'), 'SRU-fil: ' + sru.slice(0, 200));
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('a:has-text("INFO.SRU")')]);
  assert(require('fs').readFileSync(await dl2.path(), 'latin1').includes('#MEDIELEV_START'), 'INFO.SRU');
  log('INK2-underlag och SRU-filer (INK2R-2026P4)');

  await page.goto(fyUrl + '/arsredovisning');
  await page.fill('textarea[name=activity]', 'Bolaget bedriver konsultverksamhet. Bolaget har sitt säte i Stockholm.');
  await page.fill('textarea[name=board]', 'Ägare Testsson, Styrelseledamot');
  await page.click('button:has-text("Spara och uppdatera utkastet")');
  await waitMsg(page, 'Uppgifterna är sparade');
  const ar = await page.locator('.document-body').textContent();
  for (const s of ['Förvaltningsberättelse', 'Bolaget bedriver konsultverksamhet', 'Resultaträkning', 'Balansräkning', 'Fastställelseintyg', 'Ägare Testsson'])
    assert(ar.includes(s), 'årsredovisning saknar ' + s);
  await page.click('button:has-text("Skapa protokoll och skicka för e-signering")');
  await waitMsg(page, 'Årsstämmoprotokollet är skickat');
  assert(await page.locator('text=Protokoll fört vid årsstämma').count(), 'protokoll');
  log('årsredovisning K2 och årsstämmoprotokoll för e-signering');

  // Enskild firma
  await page.goto(BASE + '/');
  await page.fill('input[name=name]', 'Firma Test');
  await page.selectOption('select[name=company_type]', 'EF');
  await page.fill('input[name=orgnr]', '19811218-9876');
  await page.click('button:has-text("Skapa bolag")');
  await page.waitForURL(/kom-igang/);
  assert(await page.locator('text=Som enskild näringsidkare').count(), 'EF-anpassad guide');
  const efBase = page.url().replace(/\/kom-igang.*/, '');
  await page.goto(efBase + '/kvitto');
  await page.fill('input[name=total]', '250');
  await page.click('button:has-text("Facklitteratur")');
  await page.selectOption('select[name=paid_with]', 'private');
  await page.click('button:has-text("Bokför kvitto")');
  await waitMsg(page, 'Kvittot är bokfört');
  await page.goto(efBase + '/deadlines');
  assert(await page.locator('text=Inkomstdeklaration 1 med NE-bilaga').count() && !(await page.locator('text=Inkomstdeklaration 2').count()), 'EF-deadlines');
  await page.goto(efBase + '/bokslut');
  await page.click('a:has-text("Öppna")');
  await page.waitForURL(/bokslut\/\d+$/);
  await page.goto(page.url() + '/deklaration');
  const ne = await page.locator('main').textContent();
  assert(ne.includes('NE – Resultaträkning') && ne.includes('R6') && ne.includes('B10'), 'NE-underlag');
  log('enskild firma: guide, kvitto (egen insättning), NE-deadlines och NE-underlag');

  await browser.close();
})().catch((e) => { console.error('FEL:', e.message); process.exit(1); });
