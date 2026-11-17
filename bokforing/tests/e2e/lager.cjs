// End-to-end: inköp, lager och logistik. Körs efter flow.cjs (leverantör och kund finns i bolag 1).
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
  const B = `${BASE}/c/1`, M = `${B}/m/lager`;
  const pick = async (sel, sku) => page.selectOption(sel, await page.locator(`${sel} option:has-text("${sku} ")`).first().getAttribute('value'));

  await page.goto(B + '/moduler');
  await page.locator('.card:has(h2:text-is("Inköp, lager och logistik")) button:has-text("Aktivera")').click();
  await page.waitForURL(/ok=/);

  async function product(sku, name, buy, sell, opening, reorder) {
    await page.goto(M + '/artiklar');
    await page.fill('input[name=sku]', sku); await page.fill('input[name=name]', name);
    await page.fill('input[name=purchase_price]', buy); await page.fill('input[name=sales_price]', sell);
    await page.selectOption('select[name=supplier_id]', { index: 1 });
    if (reorder) { await page.fill('input[name=reorder_point]', reorder[0]); await page.fill('input[name=reorder_qty]', reorder[1]); }
    await page.fill('input[name=opening_qty]', opening);
    await page.click('button:has-text("Lägg upp artikel")');
    await waitMsg(page, 'Artikeln är upplagd');
  }
  await product('A-100', 'Kabel USB-C', '50', '129', '5', ['10', '50']);
  await product('A-200', 'Laddare', '120', '299', '20');
  log('artiklar med ingående lager och beställningspunkt');

  await page.goto(M + '/inkop');
  let t = await text(page);
  assert(t.includes('Beställningsförslag') && t.includes('A-100 Kabel USB-C') && t.includes('50'), 'beställningsförslag: ' + t.slice(0, 800));
  await page.click('button:has-text("Skapa inköpsorder per leverantör")');
  await waitMsg(page, '1 inköpsorder är skapade');
  log('beställningsförslag → inköpsorder');

  await pick('select[name=product_0]', 'A-200');
  await page.fill('input[name=qty_0]', '10');
  await page.fill('input[name=price_0]', '150');
  await page.click('button:has-text("Skapa inköpsorder")');
  await waitMsg(page, 'Inköpsordern är skapad');
  t = await text(page);
  assert(t.includes('INKÖPSORDER') && t.includes('1 500,00') && t.includes('1 875,00'), 'inköpsorder: ' + t.slice(0, 1200));
  await page.click('button:has-text("Markera som skickad")');
  await waitMsg(page, 'markerad som skickad');
  await page.click('button:has-text("Registrera inleverans")');
  await waitMsg(page, 'Inleveransen är registrerad');
  assert((await text(page)).includes('Inlevererad'), 'status inlevererad');
  await page.fill('input[name=invoice_number]', 'LF-900');
  await page.click('button:has-text("Registrera leverantörsfaktura")');
  await waitMsg(page, 'registrerad från inköpsordern');
  assert((await text(page)).includes('1 875,00'), 'leverantörsfaktura 1 875 kr');
  await page.goto(M + '/artiklar');
  t = await text(page);
  assert(t.includes('30 st') && t.includes('130,00'), 'saldo 30 och snittpris 130: ' + t.slice(0, 1200));
  log('inköpsorder 10 st à 150 kr: inleverans, snittpris 120 → 130 kr, leverantörsfaktura 1 875 kr');

  await page.goto(M + '/order');
  await page.selectOption('select[name=customer_id]', { index: 0 });
  await pick('select[name=product_0]', 'A-200');
  await page.fill('input[name=qty_0]', '3');
  await page.click('button:has-text("Skapa kundorder")');
  await waitMsg(page, 'Kundordern är skapad');
  assert((await text(page)).includes('FÖLJESEDEL'), 'följesedel');
  await page.fill('input[name=carrier]', 'PostNord');
  await page.fill('input[name=tracking]', 'SE123456789');
  await page.click('button:has-text("Leverera och dra från lagret")');
  await waitMsg(page, 'Ordern är levererad');
  t = await text(page);
  assert(t.includes('Levererad') && t.includes('SE123456789'), 'levererad med spårning');
  await page.click('button:has-text("Skapa faktura från leveransen")');
  await waitMsg(page, 'Fakturautkastet är skapat');
  t = await text(page);
  assert(t.includes('A-200 Laddare') && t.includes('897,00') && t.includes('SE123456789'), 'faktura från order: ' + t.slice(0, 1200));
  log('kundorder 3 st: följesedel, leverans med PostNord SE123456789, fakturautkast 897 kr exkl. moms');

  await page.goto(M + '/order');
  await page.selectOption('select[name=customer_id]', { index: 0 });
  await pick('select[name=product_0]', 'A-100');
  await page.fill('input[name=qty_0]', '1000');
  await page.click('button:has-text("Skapa kundorder")');
  await waitMsg(page, 'Kundordern är skapad');
  assert((await text(page)).includes('Saknas i lager') && await page.locator('button:has-text("Leverera och dra från lagret")').isDisabled(), 'kan inte leverera mer än lagret');
  await page.click('button:has-text("Makulera ordern")');
  await waitMsg(page, 'Ordern är makulerad');
  log('order större än lagret kan inte levereras');

  await page.goto(M + '/inventering');
  const a100 = await page.locator('tr:has-text("A-100") input[name=product_id]').inputValue();
  await page.fill(`input[name=counted_${a100}]`, '52');
  await page.click('button:has-text("Registrera inventering")');
  await waitMsg(page, '1 artiklar justerade');
  log('inventering: A-100 55 → 52');

  await page.goto(M + '/varde?r97=1');
  t = await text(page);
  assert(t.includes('6 110,00') && t.includes('5 926,70'), 'lagervärde: ' + t.slice(0, 1500));
  await page.click('button:has-text("Bokför lagerförändring")');
  await waitMsg(page, 'Lagervärderingen är bokförd');
  await page.goto(M + '/varde?r97=1');
  t = await text(page);
  assert(t.includes('Lagerförändring att bokföra0,00') && t.includes('Tidigare värderingar'), 'efter bokföring: ' + t.slice(0, 1500));
  log('lagervärde 6 110 kr, 97 %-regeln 5 926,70 kr bokfört på 1460 mot 4960');

  await browser.close();
})().catch((e) => { console.error('FEL:', e.message); process.exit(1); });
