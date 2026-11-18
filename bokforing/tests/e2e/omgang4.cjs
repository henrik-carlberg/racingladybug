// End-to-end, omgång 4: behörighet per användare, attest i två steg, ändringshistorik och att revisorn inte kan ändra något
// ens när formuläret skickas utan JavaScript.
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const waitMsg = (page, text) => page.waitForURL((u) => decodeURIComponent(u.toString()).replace(/ /g, ' ').includes(text), { timeout: 20000 });
const text = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); const sel = (await page.locator('main').count()) ? 'main' : 'body'; return (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').replace(/ /g, ' '); };

async function login(browser, email, password, opts = {}) {
  const p = await (await browser.newContext(opts)).newPage();
  p.setDefaultTimeout(20000);
  await p.goto(BASE + '/login');
  await p.fill('input[name=email]', email);
  await p.fill('input[name=password]', password);
  await p.click('form button:has-text("Logga in")');
  await p.waitForURL(BASE + '/');
  return p;
}
async function invite(owner, B, email, role) {
  await owner.goto(B + '/installningar');
  await owner.fill('form:has(select[name=role]) input[name=email]', email);
  await owner.selectOption('form:has(select[name=role]) select[name=role]', role);
  await owner.click('button:has-text("Skapa inbjudan")');
  await owner.waitForURL(/invite=/);
  return (await owner.locator('code').textContent()).trim();
}
async function accept(browser, link, name, password) {
  const p = await (await browser.newContext()).newPage();
  p.setDefaultTimeout(20000);
  await p.goto(link);
  await p.fill('input[name=name]', name);
  await p.fill('input[name=password]', password);
  await p.click('button:has-text("Acceptera")');
  await p.waitForURL(BASE + '/');
  return p;
}

(async () => {
  const browser = await chromium.launch();
  const owner = await login(browser, 'agare@example.com', 'hemligtlosen1');
  const B = `${BASE}/c/1`;

  // ---- Revisor utan JavaScript ----
  await accept(browser, await invite(owner, B, 'revisor.omg4@example.com', 'auditor'), 'Ulla Granskare', 'granskarlosen1');
  const nojs = await login(browser, 'revisor.omg4@example.com', 'granskarlosen1', { javaScriptEnabled: false });
  await nojs.goto(B + '/kunder');
  await nojs.fill('input[name=name]', 'Kund utan JS');
  await nojs.click('button:has-text("Spara kund")');
  await nojs.waitForLoadState('load');
  assert(decodeURIComponent(nojs.url()).includes('Revisorn har läsbehörighet'), 'formulär utan JavaScript nekas: ' + nojs.url());
  await owner.goto(B + '/kunder');
  assert(!(await text(owner)).includes('Kund utan JS'), 'ingen kund skapad');
  log('revisorn nekas även när formuläret skickas utan JavaScript');

  // ---- Begränsad konsult ----
  const kons = await accept(browser, await invite(owner, B, 'konsult.omg4@example.com', 'accountant'), 'Kim Fakturerare', 'fakturalosen1');
  await owner.goto(B + '/installningar');
  const row = owner.locator('tr:has-text("Kim Fakturerare")');
  await row.locator('summary').click();
  for (const p of ['purchasing', 'attest', 'payments', 'payroll', 'ledger']) await row.locator(`input[value=${p}]`).uncheck();
  await row.locator('button:has-text("Spara behörigheter")').click();
  await waitMsg(owner, 'Behörigheterna är sparade');
  assert((await text(owner)).includes('Begränsad (1 av 6)'), 'begränsning visas');
  await kons.goto(B);
  const nav = await kons.locator('nav').innerText();
  assert(nav.includes('Kundfakturor') && !nav.includes('Lönekörningar') && !nav.includes('Verifikationer'), 'menyn visar bara det tillåtna: ' + nav);
  await kons.goto(B + '/lon');
  await kons.waitForURL((u) => !u.pathname.endsWith('/lon'));
  assert(decodeURIComponent(kons.url()).includes('Du saknar behörighet'), 'lönesidan nekas: ' + kons.url());
  await kons.goto(B + '/kunder');
  await kons.fill('input[name=name]', 'Konsultens kund');
  await kons.click('button:has-text("Spara kund")');
  await waitMsg(kons, 'Kunden är sparad');
  log('konsult med begränsad behörighet ser och gör bara kundfakturor');

  // ---- Attest i två steg ----
  await owner.goto(B + '/installningar');
  await owner.fill('input[name=attest_threshold]', '5000');
  await owner.check('input[name=attest_not_registrant]');
  await owner.click('form:has(input[name=attest_threshold]) button:has-text("Spara")');
  await waitMsg(owner, 'Attestreglerna är sparade');
  await owner.goto(B + '/leverantorsfakturor/ny');
  await owner.selectOption('select[name=supplier_id]', { label: 'Hyresvärden AB' });
  await owner.fill('input[name=invoice_number]', 'H-ATTEST-1');
  await owner.fill('input[name=invoice_date]', '2026-11-10');
  await owner.fill('input[name=due_date]', '2026-12-10');
  await owner.fill('input[name=total]', '12500');
  await owner.click('button:has-text("25 % moms")');
  await owner.click('button:has-text("Registrera och bokför")');
  await owner.waitForURL(/leverantorsfakturor\/\d+\?ok/);
  const siUrl = owner.url().split('?')[0];
  await owner.click('button:has-text("Attestera")');
  await waitMsg(owner, 'registrerat fakturan får inte attestera');
  const att = await accept(browser, await invite(owner, B, 'attest1.omg4@example.com', 'accountant'), 'Anna Attest', 'attestlosen11');
  const att2 = await accept(browser, await invite(owner, B, 'attest2.omg4@example.com', 'accountant'), 'Bo Attest', 'attestlosen22');
  await att.goto(siUrl);
  assert(await att.locator('button:has-text("Attestera (1 av 2)")').count(), 'två attester krävs');
  await att.click('button:has-text("Attestera")');
  await waitMsg(att, 'Första attesten är gjord');
  await att.click('button:has-text("Attestera")');
  await waitMsg(att, 'redan attesterat');
  await att2.goto(siUrl);
  await att2.click('button:has-text("Attestera (2 av 2)")');
  await waitMsg(att2, 'attesterad för betalning');
  let t = await text(att2);
  assert(t.includes('Historik') , 'historik finns');
  await att2.locator('details.history summary').click();
  t = await text(att2);
  assert(t.includes('Första attest') && t.includes('Anna Attest') && t.includes('Attesterad') && t.includes('Bo Attest'), 'historik med båda attesterna: ' + t.slice(-800));
  log('attest i två steg av olika personer, registreraren får inte attestera, historik');

  // ---- Ändringshistorik på kund ----
  await owner.goto(B + '/kunder');
  await owner.click('a:has-text("Konsultens kund")');
  await owner.waitForURL(/kunder\/\d+/);
  await owner.fill('input[name=city]', 'Umeå');
  await owner.click('button:text-is("Spara")');
  await waitMsg(owner, 'Kunden är sparad');
  await owner.goto(B + '/kunder');
  await owner.click('a:has-text("Konsultens kund")');
  await owner.locator('details.history summary').click();
  t = await text(owner);
  assert(t.includes('ort: – → Umeå') && t.includes('Kim Fakturerare'), 'kundhistorik: ' + t.slice(-600));
  log('ändringshistorik visar vem som ändrade vad');

  await browser.close();
  console.log('Omgång 4 del 1: alla steg gick igenom');
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
