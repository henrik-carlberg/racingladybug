// End-to-end, omgång 26: jämkning, omvänd skattskyldighet för varor, löneutmätning, slutlön, kontrollenhet och dagsrapporter.
const { chromium } = require('playwright');
const http = require('node:http');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const text = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); const sel = (await page.locator('main').count()) ? 'main' : 'body'; return (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').replace(/ /g, ' '); };
const iso = (d) => d.toISOString().slice(0, 10);
const day = (n) => iso(new Date(Date.now() - n * 864e5));
const YEAR = new Date().getFullYear();
const MONTH = new Date().getMonth() + 1;

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
async function login(browser, email, password) {
  const p = await (await browser.newContext()).newPage();
  p.setDefaultTimeout(20000);
  await p.goto(BASE + '/login');
  await p.fill('input[name=email]', email);
  await p.fill('input[name=password]', password);
  await p.click('form button:has-text("Logga in")');
  await p.waitForURL(BASE + '/');
  return p;
}

const viesServer = http.createServer((req, res) => {
  const m = /\/ms\/([A-Z]{2})\/vat\/([0-9A-Z]+)/.exec(req.url || '');
  const ok = m && m[1] === 'DE' && m[2] === '123456789';
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ isValid: !!ok, name: ok ? 'EU KUND GMBH' : '---', address: ok ? 'Berlin' : '---', userError: ok ? 'VALID' : 'INVALID' }));
}).listen(3320);
const mailServer = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"m1"}'); }); }).listen(3303);

const luhn = (s) => { let sum = 0; for (let i = 0; i < s.length; i++) { let v = Number(s[s.length - 1 - i]); if (i % 2 === 1) { v *= 2; if (v > 9) v -= 9; } sum += v; } return sum % 10 === 0; };
const orgnrFor = (prefix) => { for (let i = 0; i < 10; i++) { const s = prefix + String(i); if (luhn(s)) return `${s.slice(0, 6)}-${s.slice(6)}`; } };

(async () => {
  const browser = await chromium.launch();
  const owner = await login(browser, 'agare@example.com', 'hemligtlosen1');
  let t;
  const nb = (s) => s.replace(/[\s  ]/g, '');

  const newCompany = async (name, prefix) => {
    await owner.goto(BASE + '/');
    await owner.fill('input[name=name]', name);
    await owner.selectOption('select[name=company_type]', 'AB');
    await owner.fill('input[name=orgnr]', orgnrFor(String(prefix + (Date.now() % 900000)).slice(0, 9)));
    await owner.fill('input[name=fy_start]', `${YEAR}-01-01`); await owner.fill('input[name=fy_end]', `${YEAR}-12-31`);
    await owner.click('button:has-text("Skapa bolag")');
    await owner.waitForURL(/kom-igang/);
    return owner.url().replace(/\/kom-igang.*/, '');
  };
  const invoice = async (B, customer, amount, dateStr = day(1)) => {
    await owner.goto(B + '/fakturor/ny');
    await owner.selectOption('select[name=customer_id]', { label: customer });
    await owner.fill('input[name=invoice_date]', dateStr);
    const r0 = owner.locator('tbody tr').first();
    await r0.locator('td:nth-child(1) input').fill('Varor'); await r0.locator('td:nth-child(2) input').fill('1');
    await r0.locator('td:nth-child(3) input').fill('st'); await r0.locator('td:nth-child(4) input').fill(String(amount));
    await owner.click('button:has-text("Spara utkast")');
    await owner.waitForURL(/fakturor\/\d+\?ok/);
    await owner.click('button:has-text("Bokför faktura")');
    await owner.locator('text=Fakturan är bokförd').waitFor();
  };

  const voucher = async (B, desc, rows, d = day(1)) => {
    await owner.goto(B + '/verifikationer/ny');
    await owner.fill('input[name=date]', d);
    await owner.fill('input[name=description]', desc);
    for (let i = 0; i < rows.length; i++) {
      if (i >= 2) await owner.click('button:has-text("+ Rad")');
      const r = owner.locator('tbody tr').nth(i);
      await r.locator('td:nth-child(1) input').fill(String(rows[i][0]));
      if (rows[i][1] > 0) await r.locator('td:nth-child(3) input').fill(String(rows[i][1]));
      else await r.locator('td:nth-child(4) input').fill(String(-rows[i][1]));
    }
    await owner.click('button:has-text("Bokför")');
    await owner.waitForURL(/verifikationer\/\d+/).catch(async (e) => { throw new Error('verifikation: ' + (await text(owner)).slice(0, 600)); });
  };

  const addFy = async (B, y) => {
    await owner.goto(B + '/installningar');
    await owner.fill('form:has(button:has-text("Lägg till")) input[name=start]', `${y}-01-01`);
    await owner.fill('form:has(button:has-text("Lägg till")) input[name=end]', `${y}-12-31`);
    await owner.click('form:has(input[name=end]) button:has-text("Lägg till")');
    await owner.locator('text=Räkenskapsåret är tillagt').waitFor();
  };

  // ================= Del 1: jämkning – ny-, till- och ombyggnad och slutjämkning =================
  const JK = await newCompany('Jämkaren AB', 559310000);
  const inv = async (desc, kind, vat, pct) => {
    await owner.goto(JK + '/rapporter/moms/avancerat#jamkning');
    const jf = owner.locator('form:has(input[name=vat_amount])');
    await jf.locator('input[name=description]').fill(desc); await jf.locator('select[name=kind]').selectOption(kind);
    await jf.locator('input[name=completed_on]').fill(`${YEAR - 1}-03-01`);
    await jf.locator('input[name=vat_amount]').fill(vat); await jf.locator('input[name=orig_pct]').fill(pct);
    await jf.locator('button:has-text("Registrera")').click();
    await owner.locator('.flash').first().waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  assert((await inv('Liten ombyggnad', 'nybyggnad', '50000', '100')).includes('minst100000kr'), 'gräns för fastighetsinvestering');
  assert((await inv('Liten maskin', 'inventarie', '5000', '100')).includes('minst50000kr'), 'gräns för inventarier');
  await inv('Tillbyggnad lager', 'nybyggnad', '400000', '50');
  await inv('Fräsmaskin', 'inventarie', '50000', '100');
  const card = (d) => owner.locator(`.investment:has-text("${d}")`);
  await owner.goto(JK + '/rapporter/moms/avancerat#jamkning');
  assert((await card('Tillbyggnad lager').innerText()).includes(`t.o.m. ${YEAR + 18}`), 'tjugo års korrigeringstid');
  await card('Tillbyggnad lager').locator('select[name=disposal]').selectOption('taxable');
  await card('Tillbyggnad lager').locator('button:has-text("Slutjämka")').click();
  await owner.locator('.flash').first().waitFor();
  t = nb(await owner.locator('.flash').first().innerText());
  assert(t.includes('för19år') && t.includes('ytterligareavdrag190000,00kr'), 'momspliktig försäljning: 1/20 × 19 år × 50 %: ' + t);
  await owner.goto(JK + '/rapporter/moms/avancerat#jamkning');
  await card('Fräsmaskin').locator('select[name=disposal]').selectOption('exempt');
  await card('Fräsmaskin').locator('button:has-text("Slutjämka")').click();
  await owner.locator('.flash').first().waitFor();
  t = nb(await owner.locator('.flash').first().innerText());
  assert(t.includes('för4år') && t.includes('återbetalning40000,00kr'), 'uttag ur verksamheten: 1/5 × 4 år × 100 %: ' + t);
  await owner.goto(JK + '/rapporter/moms/avancerat#jamkning');
  assert(await owner.locator('.inv-disposed').count() === 2 && !(await card('Fräsmaskin').locator('button:has-text("Jämka")').count()), 'slutjämkade investeringar kan inte jämkas igen');
  log('jämkning: 20 år för ny-, till- och ombyggnad, beloppsgränser, slutjämkning vid försäljning med moms (+190 000 kr) och uttag (−40 000 kr)');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 26: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
