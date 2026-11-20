// End-to-end, omgång 21: ränteavdragsbegränsning, expertskatt och SINK, personaloptioner, fusion, högkostnadsskydd.
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
    await owner.waitForURL(/verifikationer\/\d+/);
  };

  const addFy = async (B, y) => {
    await owner.goto(B + '/installningar');
    await owner.fill('form:has(button:has-text("Lägg till")) input[name=start]', `${y}-01-01`);
    await owner.fill('form:has(button:has-text("Lägg till")) input[name=end]', `${y}-12-31`);
    await owner.click('form:has(input[name=end]) button:has-text("Lägg till")');
    await owner.locator('text=Räkenskapsåret är tillagt').waitFor();
  };

  // ================= Del 1: ränteavdragsbegränsning =================
  const RA = await newCompany('Belånade AB', 559010000);
  await addFy(RA, YEAR - 1);
  await voucher(RA, 'Lån', [[1930, 100000000], [2350, -100000000]], `${YEAR - 1}-01-02`);
  await voucher(RA, 'Räntor', [[8410, 6000000], [1930, -6000000]], `${YEAR - 1}-12-30`);
  await voucher(RA, 'Försäljning', [[1930, 5000000], [3001, -5000000]], `${YEAR - 1}-06-01`);
  await voucher(RA, 'Försäljning i år', [[1930, 20000000], [3001, -20000000]], `${YEAR}-03-01`);
  await voucher(RA, 'Räntor i år', [[8410, 1000000], [1930, -1000000]], `${YEAR}-06-30`);
  await owner.goto(RA + '/bokslut/ranteavdrag');
  const il = async (y, c) => nb(await owner.locator(`.il-row[data-year="${y}"] .${c}`).innerText());
  assert(await il(YEAR - 1, 'il-deductible') === '1500000,00' && await il(YEAR - 1, 'il-nondeductible') === '4500000,00' && await il(YEAR - 1, 'il-saved') === '4500000,00', 'EBITDA-regeln: ' + await owner.locator('.il-years').innerText());
  assert(await il(YEAR, 'il-deductible') === '1000000,00' && await il(YEAR, 'il-used') === '0,00' && await il(YEAR, 'il-saved') === '4500000,00', 'förenklingsregeln: sparat får inte användas');
  await owner.fill('input[name=simplification]', '0');
  await owner.click('button:has-text("Spara")');
  await owner.locator('text=Andelen av förenklingsbeloppet är sparad').waitFor();
  assert(await il(YEAR, 'il-used') === '4500000,00' && await il(YEAR, 'il-saved') === '0,00', 'sparat räntenetto används inom EBITDA-utrymmet');
  log('ränteavdragsbegränsning: 30 % av skattemässig EBITDA, förenklingsregeln 5 mkr och sparat negativt räntenetto som används när det finns utrymme');

  // ================= Del 2: expertskatt och SINK =================
  const SK = await newCompany('Internationella AB', 559020000);
  await owner.goto(SK + '/installningar');
  await owner.fill('input[name=phone]', '08-123456');
  await owner.click('form:has(input[name=phone]) button:has-text("Spara")');
  await owner.waitForURL(/ok=/);
  const emp = async (first, last, pn) => {
    await owner.goto(SK + '/lon/anstallda');
    await owner.fill('input[name=first_name]', first); await owner.fill('input[name=last_name]', last);
    await owner.fill('input[name=personal_number]', pn); await owner.fill('input[name=monthly_salary]', '40000'); await owner.fill('input[name=tax_table]', '32');
    await owner.click('form:has(input[name=first_name]) button:has-text("Spara")');
    await owner.waitForURL(/ok=/);
  };
  await emp('Eva', 'Expert', '19811218-9876');
  await emp('Sam', 'Sink', '19' + orgnrFor('790315123'));
  const decide = async (name, kind, from, to) => {
    await owner.goto(SK + '/lon/sarskild-skatt');
    const r = owner.locator(`.st-row[data-name="${name}"]`);
    await r.locator('select[name=kind]').selectOption(kind); await r.locator('input[name=decision]').fill('FSN 123');
    await r.locator('input[name=valid_from]').fill(from); await r.locator('input[name=valid_to]').fill(to);
    await r.locator('button:has-text("Spara")').click();
    await owner.locator('.flash').first().waitFor();
    return owner.locator('.flash').first().innerText();
  };
  assert((await decide('Eva Expert', 'expert', `${YEAR}-01-01`, `${YEAR + 6}-01-01`)).includes('högst 5 år'), 'expertskatt längst fem år');
  await decide('Eva Expert', 'expert', `${YEAR}-01-01`, `${YEAR + 4}-12-31`);
  await decide('Sam Sink', 'sink', `${YEAR}-01-01`, `${YEAR}-12-31`);
  await owner.goto(SK + '/lon');
  await owner.fill('input[name=period]', `${YEAR}-${String(MONTH).padStart(2, '0')}`);
  await owner.fill('input[name=payment_date]', day(0));
  await owner.click('button:has-text("Ny lönekörning")');
  await owner.waitForURL(/lon\/\d+\?ok/);
  const runUrl = owner.url().split('?')[0];
  await owner.click('button:has-text("Bokför lönekörning")');
  await owner.locator('text=Lönekörningen är bokförd').waitFor();
  const xml = await (await owner.context().request.get(runUrl + '/agi')).text();
  const iu = (pn) => xml.split('<agd:IU>').find((b) => b.includes(pn)) || '';
  const eva = iu('198112189876'), sam = iu('19' + orgnrFor('790315123').replace('-', ''));
  assert(eva.includes('faltkod="011">30000<') && eva.includes('faltkod="001"'), 'expertskatt: 75 % redovisas: ' + eva.slice(0, 900));
  assert(sam.includes('faltkod="274">10000<') && !sam.includes('faltkod="001"'), 'SINK 25 % i ruta 274: ' + sam.slice(0, 900));
  log('expertskatt redovisar 75 % av lönen i AGI och SINK ger 25 % särskild inkomstskatt i ruta 274; beslut längre än fem år nekas');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 21: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
