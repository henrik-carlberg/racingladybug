// End-to-end: marknadsföring – kampanj, kostnad från bokföringen, leads via API och formulär, kund och ROI, budget.
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
  const B = `${BASE}/c/1`, M = `${B}/m/marknad`;

  await page.goto(B + '/moduler');
  await page.locator('.card:has(h2:text-is("Marknadsföring")) button:has-text("Aktivera")').click();
  await page.waitForURL(/ok=/);

  await page.goto(M + '/kampanjer');
  await page.fill('input[name=name]', 'Vårkampanj');
  await page.selectOption('select[name=channel]', 'linkedin');
  await page.selectOption('select[name=status]', 'active');
  await page.fill('input[name=start_date]', '2026-11-01');
  await page.fill('input[name=end_date]', '2026-12-31');
  await page.fill('input[name=budget]', '10000');
  await page.fill('input[name=code]', 'var2026');
  await page.click('button:has-text("Skapa kampanj")');
  await waitMsg(page, 'Kampanjen är skapad');
  const C = page.url().split('?')[0];
  log('kampanj skapad');

  // Annonskostnad bokförs som kvitto (5910) och kopplas till kampanjen
  await page.goto(B + '/kvitto');
  await page.fill('input[name=date]', '2026-11-10');
  await page.fill('input[name=total]', '2500');
  await page.click('button:has-text("Reklam och annonser")');
  await page.click('button:has-text("Bokför kvitto")');
  await waitMsg(page, 'Kvittot är bokfört');
  await page.goto(C);
  await page.click('tr:has-text("konto 5910") button:has-text("Koppla")');
  await waitMsg(page, 'Kostnaden är kopplad');
  await page.fill('input[name=description]', 'Eget material');
  await page.fill('input[name=amount]', '500');
  await page.click('button:has-text("Lägg till")');
  await waitMsg(page, 'Kostnaden är tillagd');
  let t = await text(page);
  assert(t.includes('2 500,00') && t.includes('av 10 000,00 kr (25 %)'), 'kostnad: ' + t.slice(0, 800));
  log('kostnad 2 000 kr från bokföringen (5910) + 500 kr manuellt = 2 500 kr av budget 10 000');

  // Lead via API (webbformulär) med kampanjkod och samtycke
  await page.goto(B + '/integrationer');
  await page.fill('input[name=name]', 'Webbplats');
  for (const s of ['marknad:write', 'sales:write']) await page.check(`input[name=scopes][value="${s}"]`);
  await page.click('button:has-text("Skapa API-nyckel")');
  const token = (await page.locator('.flash.ok code').textContent({ timeout: 10000 })).trim();
  const api = async (method, path, body) => {
    const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  const lead = await api('POST', '/m/marknad/leads', { name: 'Lisa Lind', company_name: 'Lind Design AB', email: 'lisa@example.com', source: 'Webbformulär', campaign_code: 'var2026', consent: true, consent_text: 'Jag vill få nyhetsbrev' });
  assert(lead.status === 201 && lead.json.campaign === 'Vårkampanj' && lead.json.consent && lead.json.consent_at, 'lead via API: ' + JSON.stringify(lead.json));
  log('lead via API med kampanjkod och samtycke');

  await page.goto(M + '/leads');
  await page.fill('input[name=name]', 'Per Persson');
  await page.selectOption('select[name=campaign_id]', { label: 'Vårkampanj' });
  await page.fill('input[name=source]', 'Mässa');
  await page.click('button:has-text("Registrera lead")');
  await waitMsg(page, 'Leadet är registrerat');
  await page.selectOption('select[name=status]', 'lost');
  await page.click('button:has-text("Spara")');
  await waitMsg(page, 'Leadet är sparat');

  await page.goto(`${M}/leads/${lead.json.id}`);
  await page.click('button:has-text("Gör om till kund")');
  await waitMsg(page, 'Leadet är nu kund');
  const won = await api('GET', '/m/marknad/leads?status=won');
  const customerId = won.json.data?.[0]?.customer_id;
  assert(customerId, 'kund skapad');
  const inv = await api('POST', '/invoices', { customer_id: customerId, invoice_date: today(), book: true, lines: [{ description: 'Designuppdrag', unit_price: 400000, vat_rate: 25 }] });
  assert(inv.status === 201, 'faktura till ny kund: ' + JSON.stringify(inv.json));
  await page.goto(C);
  t = await text(page);
  assert(t.includes('Leads2') && t.includes('1 250,00 kr per lead') && t.includes('Nya kunder1') && t.includes('konvertering 50 %') && t.includes('4 000,00') && t.includes('ROI 60 %'), 'nyckeltal: ' + t.slice(0, 1000));
  log('lead → kund, faktura 4 000 kr: 1 250 kr/lead, konvertering 50 %, ROI 60 %');

  await page.goto(M + '?ar=2026');
  await page.fill('input[name=m11]', '5000');
  await page.click('button:has-text("Spara budget")');
  await waitMsg(page, 'Marknadsbudgeten är sparad');
  t = await text(page);
  assert(t.includes('Marknadsbudget 20265 000,00') && t.includes('Kunder1'), 'budget och tratt: ' + t.slice(0, 800));
  log('marknadsbudget och tratt på översikten');

  await browser.close();
  function today() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }); }
})().catch((e) => { console.error('FEL:', e.message); process.exit(1); });
