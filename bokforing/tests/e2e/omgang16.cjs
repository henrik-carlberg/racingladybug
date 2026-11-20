// End-to-end, omgång 16: ekonomiska föreningar och stiftelser, bygg och entreprenad, lagervärdering, bidrag, stickprov för revision.
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

  // ================= Del 1: ekonomisk förening och stiftelse =================
  const E = await newCompany('Konsumtest ekonomisk förening', 769000000);
  await owner.goto(E + '/ekforening');
  await owner.selectOption('select[name=form]', 'ek');
  await owner.click('form:has(select[name=form]) button:has-text("Spara")');
  await owner.locator('text=Läget för ekonomisk förening är på').waitFor();
  await owner.fill('input[name=insats]', '500');
  await owner.click('form:has(input[name=insats]) button:has-text("Spara")');
  await owner.locator('text=Inställningarna är sparade').waitFor();
  for (const n of ['Alva Medlem', 'Berit Medlem']) {
    await owner.goto(E + '/ekforening');
    await owner.fill('form:has(button:has-text("Ny medlem")) input[name=name]', n);
    await owner.click('button:has-text("Ny medlem")');
    await owner.locator('text=är registrerad').waitFor();
  }
  for (const n of ['Alva Medlem', 'Berit Medlem']) {
    await owner.goto(E + '/ekforening');
    await owner.locator(`tr.coop-member:has-text("${n}") button:has-text("Insats betald")`).click();
    await owner.locator('text=Insatsen är bokförd').waitFor();
  }
  await owner.goto(E + '/ekforening');
  assert(nb(await owner.locator('.total-insats').innerText()) === '1000,00', 'summa insatser: ' + await owner.locator('.total-insats').innerText());
  await owner.goto(E + '/rapporter/huvudbok?account=2083');
  assert(nb(await text(owner)).includes('1000,00'), '2083: ' + (await text(owner)).slice(0, 1500));
  log('ekonomisk förening: medlemmar med insats enligt stadgarna, bokförd på 2083');

  await invoice(E, 'Alva Medlem', 30000);
  await invoice(E, 'Berit Medlem', 10000);
  await owner.goto(E + '/ekforening');
  t = nb(await owner.locator('table.refund-basis').innerText());
  assert(t.includes('AlvaMedlem30000,00') && t.includes('BeritMedlem10000,00'), 'underlag: ' + t);
  await owner.fill('form:has(button:has-text("Besluta och bokför återbäring")) input[name=total]', '4000');
  await owner.click('button:has-text("Besluta och bokför återbäring")');
  await owner.locator('text=Återbäringen är bokförd och fördelad').waitFor();
  t = nb(await owner.locator('.card.refund').innerText());
  assert(t.includes('AlvaMedlem:3000,00') && t.includes('BeritMedlem:1000,00'), 'fördelning: ' + t);
  await owner.goto(E + '/ekforening');
  await owner.click('.card.refund button:has-text("Betala ut")');
  await owner.locator('text=Återbäringen är utbetald').waitFor();
  await owner.goto(E + '/rapporter/huvudbok?account=3739');
  assert(nb(await text(owner)).includes('4000,00'), '3739');
  log('återbäring efter medlemmarnas köp: 3739 mot 2891, fördelad på öret och utbetald');

  await owner.goto(E + '/ekforening');
  await owner.locator('tr.coop-member:has-text("Berit Medlem") button:has-text("Uppsägning")').click();
  await owner.locator(`text=avgång ${YEAR + (MONTH === 12 ? 1 : 0)}-12-31`).waitFor();
  await owner.goto(E + '/ekforening');
  assert((await owner.locator('tr.coop-member:has-text("Berit Medlem") .status').innerText()).includes('Återbetalning från'), 'status');
  await owner.locator('tr.coop-member:has-text("Berit Medlem") input[name=date]').fill(day(0));
  await owner.locator('tr.coop-member:has-text("Berit Medlem") button:has-text("Betala tillbaka insatsen")').click();
  await owner.locator('text=Insatsen får betalas tillbaka tidigast').waitFor();
  log('utträde: avgång vid räkenskapsårets slut och insatsen betalas tillbaka först sex månader efter avgången');

  const F = await newCompany('Stiftelsen Test', 802000000);
  await owner.goto(F + '/ekforening');
  await owner.selectOption('select[name=form]', 'stiftelse');
  await owner.click('form:has(select[name=form]) button:has-text("Spara")');
  await owner.locator('text=Stiftelseläget är på').waitFor();
  await owner.fill('textarea[name=purpose]', 'Främja forskning om nyckelpigor');
  await owner.click('form:has(textarea[name=purpose]) button:has-text("Spara")');
  await owner.locator('text=Inställningarna är sparade').waitFor();
  await owner.fill('form:has(button:has-text("Bevilja")) input[name=recipient]', 'Insektsinstitutet');
  await owner.fill('form:has(button:has-text("Bevilja")) input[name=amount]', '5000');
  await owner.click('button:has-text("Bevilja")');
  await owner.locator('text=Bidraget är beviljat och bokfört').waitFor();
  await owner.goto(F + '/ekforening');
  await owner.click('tr.grant-row button:has-text("Betala ut")');
  await owner.locator('text=Bidraget är utbetalt').waitFor();
  await owner.goto(F + '/ekforening');
  assert((await owner.locator('tr.grant-row').innerText()).includes('Utbetalt'), 'utbetalt');
  t = nb(await owner.locator('tr.ff-row').first().innerText());
  assert(t.includes('5000,00'), 'ändamålskostnad i fullföljd: ' + t);
  log('stiftelse: ändamål, beviljade och utbetalda bidrag (6993/2895) och fullföljdskravet över fem år');

  //@@NEXT@@
  await browser.close(); mailServer.close();
  console.log('Omgång 16: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
