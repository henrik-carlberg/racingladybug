// End-to-end: resursbokning – resurser, bokning, krock, öppettider, återkommande, godkännande, lediga resurser och fakturering.
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const waitMsg = (page, text) => page.waitForURL((u) => decodeURIComponent(u.toString()).includes(text), { timeout: 20000 });
const text = async (page) => { await page.waitForLoadState('networkidle'); await page.waitForSelector('main h1'); return (await page.locator('main').textContent()).replace(/\s+/g, ' '); };
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }); };

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(20000);
  await page.goto(BASE + '/login');
  await page.fill('input[name=email]', 'agare@example.com');
  await page.fill('input[name=password]', 'hemligtlosen1');
  await page.click('form button:has-text("Logga in")');
  await page.waitForURL(BASE + '/');
  const B = `${BASE}/c/1`, M = `${B}/m/resurser`;

  await page.goto(B + '/moduler');
  await page.locator('.card:has(h2:text-is("Resursbokning")) button:has-text("Aktivera")').click();
  await page.waitForURL(/ok=/);

  async function resource(name, kind, cap, hour, dayPrice, from, to, approval) {
    await page.goto(M + '/resurser');
    const f = page.locator('form:has(button:has-text("Lägg upp resurs"))');
    await f.locator('input[name=name]').fill(name);
    await f.locator('select[name=kind]').selectOption(kind);
    if (cap) await f.locator('input[name=capacity]').fill(cap);
    if (hour) await f.locator('input[name=price_hour]').fill(hour);
    if (dayPrice) await f.locator('input[name=price_day]').fill(dayPrice);
    await f.locator('input[name=open_from]').fill(from);
    await f.locator('input[name=open_to]').fill(to);
    if (approval) await f.locator('input[name=requires_approval]').check();
    await f.locator('button:has-text("Lägg upp resurs")').click();
    await waitMsg(page, 'Resursen är upplagd');
  }
  await resource('Konferensrum Ek', 'room', '8', '500', '3000', '08:00', '17:00', false);
  await resource('Projektor', 'equipment', '', '', '', '07:00', '18:00', true);
  log('två resurser: rum med tim- och dagpris, projektor som kräver godkännande');

  async function book({ res, date, from, to, title, customer, billable, repeat, expect }) {
    await page.goto(M);
    const f = page.locator('form:has(button:text-is("Boka"))');
    await f.locator('select[name=resource_id]').selectOption({ label: await f.locator(`select[name=resource_id] option:has-text("${res}")`).first().textContent() });
    await f.locator('input[name=date]').fill(date);
    await f.locator('input[name=from]').fill(from);
    await f.locator('input[name=to]').fill(to);
    if (title) await f.locator('input[name=title]').fill(title);
    if (customer) await f.locator('select[name=customer_id]').selectOption({ index: 1 });
    if (billable) await f.locator('input[name=billable]').check();
    if (repeat) await f.locator('input[name=repeat_weeks]').fill(String(repeat));
    await f.locator('button:text-is("Boka")').click();
    await waitMsg(page, expect);
  }
  const past = day(-2), past2 = day(-3), future = day(7);
  await book({ res: 'Konferensrum Ek', date: past, from: '09:00', to: '11:00', title: 'Kundmöte', customer: true, billable: true, expect: 'Bokningen är gjord' });
  await book({ res: 'Konferensrum Ek', date: past2, from: '08:00', to: '17:00', title: 'Heldagskurs', customer: true, billable: true, expect: 'Bokningen är gjord' });
  await book({ res: 'Konferensrum Ek', date: past, from: '10:00', to: '12:00', title: 'Krock', expect: 'är redan bokad' });
  await book({ res: 'Konferensrum Ek', date: future, from: '07:00', to: '08:00', title: 'Tidigt', expect: 'kan bokas 08:00–17:00' });
  log('bokning, krock nekas, bokning utanför öppettid nekas');
  await book({ res: 'Konferensrum Ek', date: future, from: '13:00', to: '14:00', title: 'Veckomöte', repeat: 3, expect: '3 bokningar är gjorda' });
  log('återkommande bokning 3 veckor');

  // Bokning via API (inte ägare) på resurs som kräver godkännande → väntar
  await page.goto(B + '/integrationer');
  await page.fill('input[name=name]', 'Bokningssystem');
  await page.check('input[name=scopes][value="resurser:write"]');
  await page.click('button:has-text("Skapa API-nyckel")');
  const token = (await page.locator('.flash.ok code').textContent({ timeout: 10000 })).trim();
  const api = async (method, path, body) => {
    const res = await fetch(`${BASE}/api/v1/m/resurser${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  const res = await api('GET', '/resources');
  const projektor = res.json.data.find((r) => r.name === 'Projektor');
  const pb = await api('POST', '/bookings', { resource_id: projektor.id, date: future, from: '13:00', to: '15:00', title: 'Presentation' });
  assert(pb.status === 201 && pb.json.data[0].status === 'pending', 'väntar på godkännande: ' + JSON.stringify(pb.json));
  const clash = await api('POST', '/bookings', { resource_id: projektor.id, date: future, from: '14:00', to: '16:00' });
  assert(clash.status === 409, 'krock via API ger 409');
  await page.goto(`${M}?vecka=${future}`);
  let t = await text(page);
  assert(t.includes('1 bokningar väntar på godkännande') && t.includes('Presentation'), 'väntande: ' + t.slice(0, 800));
  await page.click('button:text-is("Godkänn")');
  await waitMsg(page, 'Bokningen är godkänd');
  assert(!(await text(page)).includes('väntar på godkännande'), 'godkänd');
  log('bokning via API väntar på godkännande, krock ger 409, ägaren godkänner');

  await page.goto(`${M}/ledigt?datum=${future}&fran=13:30&till=14:30`);
  t = await text(page);
  assert(t.includes('Konferensrum Ek') && t.includes('Upptagen: 13:00–14:00 Veckomöte') && t.includes('Projektor') && t.includes('Upptagen: 13:00–15:00 Presentation'), 'lediga: ' + t.slice(0, 900));
  await page.goto(`${M}/ledigt?datum=${future}&fran=15:00&till=16:00&typ=room&antal=6`);
  await text(page);
  t = (await page.locator('main table').first().textContent()).replace(/\s+/g, ' ');
  assert(t.includes('Konferensrum Ek') && t.includes('Ledig') && !t.includes('Projektor'), 'ledigt rum för 6 pers.: ' + t);
  log('sök ledig resurs med typ och antal personer');

  await page.goto(M + '/rapport');
  t = await text(page);
  assert(t.includes('Ofakturerade bokningar') && t.includes('4 000,00'), 'att fakturera: ' + t.slice(0, 1200));
  await page.click('button:has-text("Skapa faktura")');
  await waitMsg(page, 'Fakturautkastet för bokningarna är skapat');
  t = await text(page);
  assert(t.includes('Konferensrum Ek') && t.includes('2 h') && t.includes('1 dag') && t.includes('5 000,00'), 'faktura: ' + t.slice(0, 1200));
  log('fakturering: 2 h à 500 + heldag till dagpris 3 000 = 4 000 kr exkl. moms');

  await browser.close();
})().catch((e) => { console.error('FEL:', e.message); process.exit(1); });
