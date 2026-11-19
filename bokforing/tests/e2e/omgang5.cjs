// End-to-end, omgång 5: inlärd kontering, mönster och förslag, ångra, hjälp i sammanhanget och kontroller,
// pushnotiser, kommentarer och frågor till kunden, flytt från andra program och årsredovisning i iXBRL.
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const text = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); const sel = (await page.locator('main').count()) ? 'main' : 'body'; return (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').replace(/ /g, ' '); };
const iso = (d) => d.toISOString().slice(0, 10);
/** Samma dag i månaden n månader bakåt (sista dagen om månaden är kortare) */
const monthsAgo = (n) => { const t = new Date(); const y = t.getUTCFullYear(), m = t.getUTCMonth() - n; const len = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return iso(new Date(Date.UTC(y, m, Math.min(t.getUTCDate(), len)))); };

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

(async () => {
  const browser = await chromium.launch();
  const owner = await login(browser, 'agare@example.com', 'hemligtlosen1');
  const B = `${BASE}/c/1`;
  let t;

  // ================= Del 1: inlärd kontering =================
  await owner.goto(B + '/leverantorer');
  await owner.fill('input[name=name]', 'Lärbolaget AB');
  await owner.click('button:has-text("Spara leverantör")');
  await owner.waitForURL(/ok=/);
  const registerInvoice = async (no, total, vat, account, amount) => {
    await owner.goto(B + '/leverantorsfakturor/ny');
    await owner.selectOption('select[name=supplier_id]', { label: 'Lärbolaget AB' });
    await owner.fill('input[name=invoice_number]', no);
    await owner.fill('input[name=due_date]', monthsAgo(-1));
    await owner.fill('input[name=total]', total);
    await owner.fill('input[name=vat]', vat);
    await owner.fill('input[name=account_0]', account);
    await owner.fill('input[name=amount_0]', amount);
    await owner.click('button:has-text("Registrera och bokför")');
    await owner.waitForURL(/ok=/);
  };
  await registerInvoice('LB-1', '1250', '250', '5410', '1000');
  await registerInvoice('LB-2', '625', '125', '5410', '500');
  await owner.goto(B + '/leverantorsfakturor/ny');
  const supplierId = await owner.locator('select[name=supplier_id] option', { hasText: 'Lärbolaget AB' }).getAttribute('value');
  await owner.goto(B + `/leverantorsfakturor/ny?leverantor=${supplierId}`);
  await owner.locator('.learned').waitFor();
  assert((await owner.locator('.learned').innerText()).includes('konto 5410, 25 % moms'), 'inlärd kontering visas');
  assert(await owner.inputValue('input[name=account_0]') === '5410', 'kontot ifyllt');
  await owner.fill('input[name=total]', '2500');
  await owner.locator('input[name=total]').blur();
  assert((await owner.inputValue('input[name=vat]')).replace(/\s/g, '') === '500,00', 'momsen räknas ut: ' + await owner.inputValue('input[name=vat]'));
  assert((await owner.inputValue('input[name=amount_0]')).replace(/\s/g, '') === '2000,00', 'beloppet exkl. moms');
  log('leverantörsfaktura: kontot och momsen fylls i som de två senaste gångerna');

  const receipt = async (desc) => {
    await owner.goto(B + '/kvitto');
    await owner.fill('input[name=total]', '89');
    await owner.click('button:has-text("Facklitteratur och tidningar")');
    await owner.fill('input[name=description]', desc);
    await owner.click('button:has-text("Bokför kvitto")');
    await owner.waitForURL(/ok=/);
  };
  await receipt('Pressbyrån Centralen');
  await receipt('Pressbyrån Centralen');
  await owner.goto(B + '/kvitto');
  await owner.fill('input[name=description]', 'Pressbyrån centralen');
  await owner.locator('.learned').waitFor();
  assert(await owner.locator('button:has-text("Facklitteratur och tidningar"):not(.secondary)').count(), 'kategorin vald som förra gångerna');
  assert(await owner.inputValue('select[name=vat_rate]') === '6', 'momsen som förra gångerna');
  log('kvitto: samma butik får samma kategori och moms');

  // ================= Del 1: mönster och förslag =================
  const voucher = async (date) => {
    await owner.goto(B + '/verifikationer/ny');
    await owner.fill('input[name=date]', date);
    await owner.fill('input[name=description]', 'Hyra förråd');
    const rows = owner.locator('tbody tr');
    await rows.nth(0).locator('input').nth(0).fill('5010');
    await rows.nth(0).locator('input').nth(1).fill('3000');
    await rows.nth(1).locator('input').nth(0).fill('1930');
    await rows.nth(1).locator('input').nth(2).fill('3000');
    await owner.click('button:text-is("Bokför")');
    await owner.waitForURL(/verifikationer\/\d+/);
  };
  for (const n of [3, 2, 1]) await voucher(monthsAgo(n));
  await owner.goto(B);
  t = await text(owner);
  assert(t.includes('Förslag') && t.includes('Bokför ”Hyra förråd” igen?'), 'förslag om återkommande verifikation: ' + t.slice(0, 800));
  await owner.locator('.suggestion:has-text("Hyra förråd") a.btn').click();
  await owner.waitForURL(/kopiera=\d+/);
  assert(await owner.inputValue('input[name=description]') === 'Hyra förråd', 'beskrivningen ifylld');
  assert(await owner.locator('tbody tr').nth(0).locator('input').nth(0).inputValue() === '5010', 'kontona ifyllda');
  await owner.goto(B);
  await owner.locator('.suggestion:has-text("Hyra förråd") button:has-text("Inte nu")').click();
  await owner.locator('.suggestion:has-text("Hyra förråd")').waitFor({ state: 'detached' });
  log('återkommande verifikation föreslås på översikten, fylls i med ett klick och kan avfärdas');

  // ================= Del 1: ångra =================
  await owner.goto(B + '/fakturor');
  const draftHref = await owner.locator('tbody a[href*="/fakturor/"]:text-is("Utkast")').first().getAttribute('href');
  await owner.goto(BASE + draftHref);
  await owner.click('button:has-text("Ta bort utkast")');
  await owner.waitForURL(/fakturor$/);
  await owner.locator('.toast:has-text("Utkastet tas bort") button:has-text("Ångra")').click();
  await owner.waitForTimeout(7000);
  await owner.goto(BASE + draftHref);
  assert((await text(owner)).includes('Bokför faktura'), 'utkastet finns kvar efter ångra');
  await owner.click('button:has-text("Ta bort utkast")');
  await owner.waitForURL(/fakturor$/);
  await owner.locator('.toast').waitFor({ state: 'detached', timeout: 20000 });
  await owner.waitForLoadState('networkidle');
  const gone = await owner.goto(BASE + draftHref);
  assert(gone.status() === 404, 'utkastet borttaget när tiden gått: ' + gone.status());
  log('ta bort utkast kan ångras i några sekunder, sedan tas det bort');

  await browser.close();
  console.log('Omgång 5: alla steg gick igenom');
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
