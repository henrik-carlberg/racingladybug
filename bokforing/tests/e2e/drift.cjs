// End-to-end: kostnadsställen, anläggningsregister, dagskassa och e-handel, schema och personalliggare, kundportal.
const { chromium } = require('playwright');
const crypto = require('node:crypto');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const waitMsg = (page, text) => page.waitForURL((u) => decodeURIComponent(u.toString()).replace(/\u00a0/g, ' ').includes(text), { timeout: 20000 });
const text = async (page) => { await page.waitForLoadState('networkidle'); await page.waitForSelector('main h1, h1'); return (await page.locator('body').textContent()).replace(/\s+/g, ' '); };
const day = (n) => { const d = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function login(browser, email, pw) {
  const p = await (await browser.newContext()).newPage();
  p.setDefaultTimeout(20000);
  await p.goto(BASE + '/login');
  await p.fill('input[name=email]', email);
  await p.fill('input[name=password]', pw);
  await p.click('form button:has-text("Logga in")');
  await p.waitForURL(BASE + '/');
  return p;
}

(async () => {
  const browser = await chromium.launch();
  const page = await login(browser, 'agare@example.com', 'hemligtlosen1');
  const B = `${BASE}/c/1`;
  await page.goto(B + '/integrationer');
  await page.fill('input[name=name]', 'Drift');
  for (const s of ['sales:write', 'accounting:read', 'crm:write']) await page.check(`input[name=scopes][value="${s}"]`);
  await page.click('button:has-text("Skapa API-nyckel")');
  const token = (await page.locator('.flash.ok code').textContent({ timeout: 10000 })).trim();
  const api = async (method, path, body) => {
    const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  const balance = async (acc) => {
    const r = await api('GET', '/reports/balances?from=2026-01-01&to=2026-12-31');
    return (r.json.data ?? r.json.accounts ?? r.json).find((x) => x.account === acc) ?? { change: 0, closing_balance: 0 };
  };

  // ================= Kostnadsställen =================
  for (const [code, name] of [['10', 'Butiken'], ['20', 'Webbutiken']]) {
    await page.goto(B + '/installningar/kostnadsstallen');
    await page.fill('input[name=code]', code);
    await page.fill('input[name=name]', name);
    await page.click('button:has-text("Lägg till")');
    await waitMsg(page, 'Kostnadsstället är skapat');
  }
  await page.goto(B + '/verifikationer/ny');
  await page.fill('input[name=description]', 'Hyra butik november');
  const rows = page.locator('tbody tr');
  await rows.nth(0).locator('td').nth(0).locator('input').fill('5010');
  await rows.nth(0).locator('td').nth(2).locator('input').fill('8000');
  await rows.nth(0).locator('select[aria-label=Kostnadsställe]').selectOption({ label: '10 Butiken' });
  await rows.nth(1).locator('td').nth(0).locator('input').fill('1930');
  await rows.nth(1).locator('td').nth(3).locator('input').fill('8000');
  await page.click('button:text-is("Bokför")');
  await waitMsg(page, 'Verifikationen är bokförd');
  let t = await text(page);
  assert(t.includes('KS 10'), 'kostnadsställe på verifikationen: ' + t.slice(0, 1500));
  await page.goto(B + '/rapporter/dimensioner?from=2026-11-01&to=2026-11-30');
  t = await text(page);
  assert(t.includes('10 Butiken') && t.includes('−8 000,00') || t.includes('-8 000,00'), 'resultat per kostnadsställe: ' + t.slice(0, 2000));
  const fy = await page.request.get(B + '/rapporter/export');
  const fyId = (await fy.text()).match(/export\/sie\?fy=(\d+)/g).map((x) => x.split('=')[1]);
  let sie = '';
  for (const id of fyId) { const r = await page.request.get(`${B}/rapporter/export/sie?fy=${id}`); const body = Buffer.from(await r.body()).toString('latin1'); if (/#TRANS 5010 \{1 "10"\}/.test(body)) sie = body; }
  assert(sie.includes('#DIM 1') && sie.includes('#OBJEKT 1 "10"') && /#TRANS 5010 \{1 "10"\} 8000\.00/.test(sie), 'SIE med dimensioner: ' + fyId + ' ' + sie.split('\n').filter((l) => /DIM|OBJEKT|5010/.test(l)).join(' | '));
  log('kostnadsställen: verifikation med KS 10, resultat per kostnadsställe, SIE #DIM/#OBJEKT');

  // ================= Anläggningsregister =================
  await page.goto(B + '/anlaggningar');
  await page.fill('input[name=name]', 'Bärbar dator');
  await page.selectOption('select[name=category]', 'datorer');
  await page.fill('input[name=acquired_on]', '2026-09-15');
  await page.fill('input[name=cost]', '36000');
  await page.click('button:has-text("Lägg upp tillgång")');
  await waitMsg(page, 'upplagd i anläggningsregistret');
  await page.fill('input[name=period]', '2026-10');
  await page.click('button:has-text("Bokför avskrivningar")');
  await waitMsg(page, 'Avskrivningar bokförda: 2 000,00 kr på 2 verifikationer');
  await page.fill('input[name=period]', '2026-10');
  await page.click('button:has-text("Bokför avskrivningar")');
  await waitMsg(page, 'Inga avskrivningar att bokföra');
  t = await text(page);
  assert(/Bärbar dator.*Datorer.*36 000,00.*36 mån.*2 000,00.*34 000,00.*2026-10/.test(t), 'förteckning: ' + t.slice(0, 2500));
  assert((await balance(7835)).change === 200000 && (await balance(1259)).change === -200000, 'avskrivning 7835/1259');
  await page.locator('summary:has-text("Avyttra")').first().click();
  await page.fill('input[name=price]', '20000');
  await page.click('button:has-text("Bokför avyttring")');
  await waitMsg(page, 'förlust 14 000,00 kr');
  assert((await balance(7973)).change === 1400000 && (await balance(1250)).change <= 0, 'förlust vid avyttring');
  log('anläggning 36 000 kr på 36 mån: 2 månader à 1 000 kr, inga dubbletter, såld för 20 000 kr → förlust 14 000 kr');

  // ================= Dagskassa =================
  await page.goto(B + '/kassa');
  await page.fill('input[name=z_number]', '0042');
  await page.fill('input[name=sales_25]', '1250');
  await page.fill('input[name=sales_12]', '112');
  await page.fill('input[name=pay_card]', '1000');
  await page.fill('input[name=pay_cash]', '300');
  await page.fill('input[name=pay_swish]', '61');
  await page.click('button:has-text("Bokför dagskassa")');
  await waitMsg(page, 'stämmer inte med försäljningen');
  await page.fill('input[name=z_number]', '0042');
  await page.fill('input[name=sales_25]', '1250');
  await page.fill('input[name=sales_12]', '112');
  await page.fill('input[name=pay_card]', '1000');
  await page.fill('input[name=pay_cash]', '300');
  await page.fill('input[name=pay_swish]', '61');
  await page.check('input[name=allow_diff]');
  await page.click('button:has-text("Bokför dagskassa")');
  await waitMsg(page, 'Dagskassan är bokförd');
  assert((await balance(1910)).change >= 30000 && (await balance(2621)).change <= -1200, 'kassa och moms 12 %');
  log('dagskassa: 25 % och 12 % moms, kort/kontant/Swish, kassadifferens 1 kr efter bekräftelse');

  // ================= E-handel =================
  await page.goto(B + '/kassa');
  await page.selectOption('select[name=platform]', 'shopify');
  await page.fill('input[name=name]', 'Webbutiken');
  await page.fill('input[name=secret]', 'shpss_hemlig');
  await page.click('button:has-text("Koppla butik")');
  await waitMsg(page, 'Butiken är kopplad');
  const shopUrl = (await page.locator('code.shop-url').first().textContent()).trim();
  const shop = async (url, body, secret, headers = {}) => {
    const raw = JSON.stringify(body);
    const sig = crypto.createHmac('sha256', secret).update(raw).digest('base64');
    const r = await fetch(url, { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', ...headers, ...(headers.sigHeader ? { [headers.sigHeader]: sig } : {}) } });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const sh = { sigHeader: 'X-Shopify-Hmac-Sha256', 'X-Shopify-Topic': 'orders/paid' };
  const order = { id: 820982911946154500, name: '#1001', processed_at: '2026-11-17T14:02:00+01:00', currency: 'SEK', financial_status: 'paid', total_price: '1474.00', total_tax: '274.00',
    tax_lines: [{ rate: 0.25, price: '250.00' }, { rate: 0.12, price: '24.00' }] };
  assert((await shop(shopUrl, order, 'fel', sh)).status === 401, 'fel signatur');
  let r = await shop(shopUrl, order, 'shpss_hemlig', sh);
  assert(r.json.result === 'booked', 'shopify: ' + JSON.stringify(r));
  assert((await shop(shopUrl, order, 'shpss_hemlig', sh)).json.result === 'duplicate', 'dubblett');
  assert((await shop(shopUrl, { ...order, id: 2, financial_status: 'pending' }, 'shpss_hemlig', sh)).json.result === 'not_paid', 'obetald');
  assert((await shop(shopUrl, { ...order, id: 3, name: '#1003', currency: 'EUR' }, 'shpss_hemlig', sh)).json.result === 'skipped', 'valuta');
  await page.selectOption('select[name=platform]', 'woocommerce');
  await page.fill('input[name=name]', 'Woo-butik');
  await page.click('button:has-text("Koppla butik")');
  await waitMsg(page, 'Hemlighet att klistra in i WooCommerce');
  const wooSecret = decodeURIComponent(page.url()).match(/WooCommerce: ([A-Za-z0-9_-]+)/)[1];
  const wooUrl = (await page.locator('code.shop-url').nth(1).textContent()).trim();
  const ping = await fetch(wooUrl, { method: 'POST', body: 'webhook_id=12', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert(ping.status === 200, 'woo ping');
  r = await shop(wooUrl, { id: 77, number: '77', status: 'processing', date_paid: '2026-11-16T10:00:00', currency: 'SEK', total: '349.00', total_tax: '69.80',
    tax_lines: [{ rate_percent: 25, tax_total: '59.80', shipping_tax_total: '10.00' }] }, wooSecret, { sigHeader: 'X-WC-Webhook-Signature', 'X-WC-Webhook-Topic': 'order.updated' });
  assert(r.json.result === 'booked', 'woo: ' + JSON.stringify(r));
  await page.goto(B + '/kassa');
  t = await text(page);
  assert(t.includes('#1001') && t.includes('1 474,00') && t.includes('Ej bokförd') && t.includes('Valutan EUR') && t.includes('77') && t.includes('349,00'), 'orderlista: ' + t.slice(-2000));
  log('Shopify och WooCommerce: signerade webhooks, betalda SEK-order bokförs en gång, obetald och EUR bokförs inte');

  // ================= Schema och personalliggare =================
  const monday = (() => { const d = new Date(day(7) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
  await page.goto(`${B}/schema?vecka=${monday}`);
  await page.selectOption('select[name=employee_id]', { label: 'Anna Andersson' });
  await page.fill('input[name=date]', monday);
  await page.fill('input[name=start]', '08:00');
  await page.fill('input[name=end]', '16:30');
  await page.fill('input[name=role]', 'Kassa');
  await page.click('button:has-text("Lägg till pass")');
  await waitMsg(page, 'Passet är tillagt');
  await page.selectOption('select[name=employee_id]', { label: 'Anna Andersson' });
  await page.fill('input[name=date]', monday);
  await page.fill('input[name=start]', '12:00');
  await page.fill('input[name=end]', '14:00');
  await page.click('button:has-text("Lägg till pass")');
  await waitMsg(page, 'redan ett pass som överlappar');
  t = await text(page);
  assert(t.includes('08:00–16:30') && /Anna Andersson.*8,5 h|Anna Andersson.*8:30/.test(t), 'schema: ' + t.slice(0, 2000));
  log('schema: pass 08:00–16:30, överlappande pass nekas');

  await page.goto(B + '/personalliggare');
  await page.fill('input[name=name]', 'Salongen');
  await page.fill('input[name=address]', 'Storgatan 1, Stockholm');
  await page.click('button:has-text("Lägg till arbetsplats")');
  await waitMsg(page, 'Arbetsplatsen är tillagd');
  const kiosk = (await page.locator('code.kiosk-url').first().textContent()).trim();
  const tablet = await (await browser.newContext()).newPage();
  await tablet.goto(kiosk);
  await tablet.fill('input[name=personal_number]', '19811218-9876');
  await tablet.click('button:has-text("Stämpla in / ut")');
  await tablet.waitForURL(/ok=/);
  assert(decodeURIComponent(tablet.url()).includes('Anna Andersson – instämplad'), 'kiosk in: ' + tablet.url());
  await tablet.fill('input[name=personal_number]', '19121212-1212');
  await tablet.click('button:has-text("Stämpla in / ut")');
  await tablet.waitForURL(/fel=/);
  assert(decodeURIComponent(tablet.url()).includes('ange även namn'), 'okänd utan namn');
  await tablet.fill('input[name=personal_number]', '19121212-1212');
  await tablet.fill('input[name=name]', 'Tolvan Inhyrd');
  await tablet.click('button:has-text("Stämpla in / ut")');
  await tablet.waitForURL(/ok=/);
  t = (await tablet.locator('main').textContent()).replace(/\s+/g, ' ');
  assert(t.includes('Instämplade nu (2)') && t.includes('Tolvan Inhyrd') && !t.includes('19811218'), 'kiosk visar namn men inte personnummer: ' + t);
  log('stämplingssidan: anställd med personnummer, inhyrd med namn, personnummer visas inte');

  const anna = await login(browser, 'anna@example.com', 'annaslosen12');
  await anna.goto(B + '/mitt/schema');
  t = await text(anna);
  assert(t.includes(monday) && t.includes('08:00–16:30') && t.includes('Kassa') && t.includes('Instämplad på Salongen'), 'Annas schema: ' + t.slice(0, 1500));
  await anna.click('button:has-text("Stämpla ut – Salongen")');
  await waitMsg(anna, 'Du är utstämplad');
  log('Anna ser sitt schema och stämplar ut på Min sida');

  await page.goto(B + '/personalliggare');
  t = await text(page);
  assert(t.includes('På plats nu (1)') && t.includes('Tolvan Inhyrd'), 'på plats: ' + t.slice(0, 2500));
  const annaRow = page.locator('tr:has-text("Anna Andersson")').first();
  await annaRow.locator('summary:has-text("Rätta")').click();
  const cin = await annaRow.locator('input[name=check_in]').inputValue();
  const corrected = cin.slice(0, 11) + '07:55';
  await annaRow.locator('input[name=check_in]').fill(corrected);
  await annaRow.locator('input[name=reason]').fill('Stämplade in efter ankomst');
  await annaRow.locator('button:has-text("Spara rättelse")').click();
  await waitMsg(page, 'Rättelsen är sparad');
  await page.goto(B + '/personalliggare/kontroll');
  t = await text(page);
  assert(t.includes('Testbolaget AB') && t.includes('556026-9986') && t.includes('Salongen') && t.includes('19811218-9876') && t.includes('07:55') && t.includes('Stämplade in efter ankomst'), 'kontrollvy: ' + t.slice(0, 2000));
  log('rättelse med orsak och ursprungligt värde; kontrollvy med bolag, org.nr, personnummer och rättelser');

  // ================= Kundportal =================
  const cust = await api('POST', '/customers', { name: 'Portalkund AB', email: 'portal@kund.example' });
  await api('POST', '/invoices', { customer_id: cust.json.id, invoice_date: day(-40), due_date: day(-10), book: true, lines: [{ description: 'Konsult', quantity: 1, unit_price: 200000, vat_rate: 25 }] });
  const deal = await api('POST', '/m/crm/deals', { title: 'Webbplats 2027', customer_id: cust.json.id, value: 4000000 });
  assert(deal.status === 201, 'affär: ' + JSON.stringify(deal));
  const q = await api('POST', `/m/crm/deals/${deal.json.id}/quote`, { valid_to: day(30), notes: 'Leverans i januari.', lines: [{ description: 'Design och utveckling', quantity: 40, unit: 'h', unit_price: 100000, vat_rate: 25 }] });
  assert(q.status === 200, 'offert: ' + JSON.stringify(q).slice(0, 300));
  await page.goto(`${B}/kunder/${cust.json.id}`);
  await page.click('button:has-text("Skapa länk till kundportalen")');
  await waitMsg(page, 'Länken till kundportalen är klar');
  const portal = (await page.locator('code.portal-url').textContent()).trim();
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(portal);
  t = (await guest.locator('main').textContent()).replace(/\s+/g, ' ');
  assert(t.includes('Portalkund AB') && t.includes('Kundportal hos Testbolaget AB') && t.includes('2 500,00') && t.includes('Förfallen') && t.includes('Webbplats 2027') && t.includes('50 000,00'), 'portal: ' + t.slice(0, 1500));
  await guest.fill('input[name=name]', 'Petra Portal');
  await guest.click('button:has-text("Godkänn offerten")');
  await guest.waitForURL(/ok=/);
  t = (await guest.locator('main').textContent()).replace(/\s+/g, ' ');
  assert(t.includes('Offerten är godkänd') && t.includes('av Petra Portal'), 'godkänd: ' + t.slice(0, 1000));
  const won = await api('GET', `/m/crm/deals/${deal.json.id}`);
  assert(won.json.kind === 'won', 'affären vunnen: ' + won.json.kind);
  await guest.click('summary:has-text("Uppdatera dina kontaktuppgifter")');
  await guest.fill('input[name=email]', 'ekonomi@portalkund.example');
  await guest.click('button:has-text("Spara")');
  await guest.waitForURL(/ok=/);
  const c2 = await api('GET', `/customers/${cust.json.id}`);
  assert(c2.json.email === 'ekonomi@portalkund.example', 'kontakt uppdaterad');
  await guest.click('a:has-text("Faktura")');
  await guest.waitForURL(/\/f\//);
  assert((await guest.locator('body').textContent()).includes('FAKTURA'), 'fakturan öppnas från portalen');
  log('kundportal: fakturor med status, offert godkänd av kunden (affären vunnen), kontaktuppgifter uppdaterade');

  await browser.close();
  console.log('Alla drifttester gick igenom');
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
