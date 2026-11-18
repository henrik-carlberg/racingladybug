// End-to-end: publik startsida, priser och hjälp, demobolag, begränsning av inloggningsförsök, hälsokontroll, driftsida och full export.
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const waitMsg = (page, text) => page.waitForURL((u) => decodeURIComponent(u.toString()).replace(/ /g, ' ').includes(text), { timeout: 20000 });
const text = async (page) => { await page.waitForLoadState('networkidle'); return (await page.locator('body').innerText()).replace(/\s+/g, ' '); };

(async () => {
  const browser = await chromium.launch();
  const guest = await (await browser.newContext()).newPage();
  guest.setDefaultTimeout(20000);

  // ---- Publika sidor ----
  await guest.goto(BASE + '/');
  let t = await text(guest);
  assert(t.includes('Bokföring, fakturor, lön och hela verksamheten') && t.includes('Prova gratis i 30 dagar') && t.includes('Byråvy'), 'landningssida: ' + t.slice(0, 600));
  await guest.click('header a:has-text("Priser")');
  await guest.waitForURL(/\/priser/);
  t = await text(guest);
  assert(t.includes('99 kr') && t.includes('39 kr') && t.includes('Lönerevision') && t.includes('Vanliga frågor'), 'priser: ' + t.slice(0, 800));
  await guest.goto(BASE + '/hjalp?q=moms');
  t = await text(guest);
  assert(t.includes('Momsdeklarationen') && !t.includes('Byråvyn'), 'hjälpsök: ' + t.slice(0, 600));
  await guest.click('a:has-text("Momsdeklarationen")');
  await guest.waitForURL(/\/hjalp\/moms/);
  assert((await text(guest)).includes('Skatteverkets e-tjänst Momsdeklaration'), 'hjälpartikel');
  assert((await guest.goto(BASE + '/hjalp/finns-inte')).status() === 404, '404 för okänd artikel');
  log('publik startsida, prissida med moduler, hjälpcenter med sök och artiklar');

  // ---- Hälsokontroll ----
  const h0 = await fetch(BASE + '/api/health');
  const health = await h0.json();
  assert(h0.status === 200 && health.ok && health.db === 'ok', 'hälsa: ' + JSON.stringify(health));
  const cron = await fetch(BASE + '/api/cron/daily', { headers: { Authorization: 'Bearer testcron' } });
  assert(cron.status === 200, 'cron');
  log('hälsokontroll 200 och schemalagt jobb registrerar hjärtslag');

  // ---- Begränsning av inloggningsförsök ----
  const reg = await (await browser.newContext()).newPage();
  reg.setDefaultTimeout(20000);
  await reg.goto(BASE + '/register');
  await reg.fill('input[name=name]', 'Demo Användare');
  await reg.fill('input[name=email]', 'demo.lansering@example.com');
  await reg.fill('input[name=password]', 'demolosenord12');
  await reg.check('input[name=terms]');
  await reg.click('form button');
  await reg.waitForURL((x) => !x.pathname.startsWith('/register'));
  const attacker = await (await browser.newContext()).newPage();
  attacker.setDefaultTimeout(20000);
  for (let i = 0; i < 10; i++) {
    await attacker.goto(BASE + '/login');
    await attacker.fill('input[name=email]', 'demo.lansering@example.com');
    await attacker.fill('input[name=password]', 'fel-losenord-' + i);
    await attacker.click('form button:has-text("Logga in")');
    await waitMsg(attacker, 'Fel e-post eller lösenord');
  }
  await attacker.goto(BASE + '/login');
  await attacker.fill('input[name=email]', 'demo.lansering@example.com');
  await attacker.fill('input[name=password]', 'demolosenord12');
  await attacker.click('form button:has-text("Logga in")');
  await waitMsg(attacker, 'För många försök');
  log('efter 10 felaktiga lösenord spärras kontot i 15 minuter, även med rätt lösenord');

  // ---- Demobolag ----
  await reg.goto(BASE + '/');
  await reg.click('button:has-text("Skapa demobolag")');
  await waitMsg(reg, 'Demobolaget är skapat');
  t = await text(reg);
  assert(t.includes('Demobolaget AB') && t.includes('Det här är ett demobolag'), 'demobolag: ' + t.slice(0, 800));
  const cid = reg.url().match(/\/c\/(\d+)/)[1];
  await reg.goto(`${BASE}/c/${cid}/fakturor`);
  t = await text(reg);
  assert(t.includes('Nordljus AB') && t.includes('Café Vågen') && t.includes('Utkast'), 'demofakturor: ' + t.slice(0, 1200));
  await reg.goto(`${BASE}/c/${cid}/bank/avstamning`);
  t = await text(reg);
  assert(t.includes('TELIA') && t.includes('LIND ARKITEKTER'), 'demobank: ' + t.slice(0, 1200));
  await reg.goto(`${BASE}/c/${cid}/installningar`);
  await reg.fill('form:has(input[name=iban]) input[name=name]', 'Mitt Riktiga AB');
  await reg.click('form:has(input[name=iban]) button:has-text("Spara")');
  await reg.waitForURL(/ok=/);
  assert((await text(reg)).includes('Demobolaget AB'), 'demobolagets namn kan inte ändras');
  await reg.goto(`${BASE}/c/${cid}`);
  await reg.click('button:has-text("Ta bort demobolaget")');
  await waitMsg(reg, 'Demobolaget är borttaget');
  assert((await reg.goto(`${BASE}/c/${cid}`)).status() === 404, 'demobolaget borta');
  log('demobolag med kunder, fakturor, bank och anställd; namnet låst; kan tas bort');

  // ---- Driftsida och full export (ägaren, användare 1) ----
  const owner = await (await browser.newContext()).newPage();
  owner.setDefaultTimeout(20000);
  await owner.goto(BASE + '/login');
  await owner.fill('input[name=email]', 'agare@example.com');
  await owner.fill('input[name=password]', 'hemligtlosen1');
  await owner.click('form button:has-text("Logga in")');
  await owner.waitForURL(BASE + '/');
  await owner.goto(BASE + '/drift');
  t = await text(owner);
  assert(t.includes('Drift') && t.includes('Bolag') && t.includes('daily') && t.includes('Begränsade anrop'), 'driftsida: ' + t.slice(0, 1500));
  assert((await reg.goto(BASE + '/drift')).status() === 404, 'driftsidan bara för admin');
  const ex = await owner.request.get(BASE + '/c/1/rapporter/export/allt');
  const raw = await ex.text();
  const data = JSON.parse(raw);
  assert(ex.status() === 200 && data.company.name === 'Testbolaget AB' && data.tables.vouchers.length > 0 && data.tables.voucher_lines.length > 0 && data.tables.employees.length > 0, 'export: ' + raw.slice(0, 300));
  for (const k of ['"token_hash"', '"password_hash"', '"secret"', '"secret_enc"', '"token_enc"', '"portal_token"', '"public_token"', '"totp_secret"', '"kiosk_token"', '"path_token"', '"inbox_token"']) assert(!raw.includes(k), 'hemlig kolumn i exporten: ' + k);
  assert(!JSON.stringify(data.tables).includes('Demobolaget'), 'inga andra bolag i exporten');
  log('driftsida för administratören (404 för andra), full export utan hemligheter och utan andra bolags data');

  // ---- Bläddring ----
  await owner.goto(BASE + '/c/1/verifikationer');
  const hasNext = await owner.locator('a:has-text("Nästa →")').count();
  if (hasNext) {
    await owner.click('a:has-text("Nästa →")');
    await owner.waitForURL(/sida=2/);
    assert((await text(owner)).includes('Visar 101–'), 'sida 2');
  }
  log('bläddring i verifikationer' + (hasNext ? ' (sida 2)' : ''));

  await browser.close();
  console.log('Alla lanseringstester gick igenom');
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
