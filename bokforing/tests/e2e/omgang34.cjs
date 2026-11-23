// End-to-end, omgång 34: tidsbokning, service- och garantiärenden, konvertibler och teckningsoptioner, underkonsulter, remburser och bankgarantier.
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

  // ================= Del 1: tidsbokning =================
  const TB = await newCompany('Salong Saxen AB', 559900000);
  await owner.goto(TB + '/tidsbokning');
  await owner.fill('input[name=weekdays]', '1,2,3,4,5,6,7'); await owner.fill('input[name=no_show_pct]', '50');
  await owner.click('button:has-text("Aktivera tidsbokning")'); await owner.locator('text=Inställningarna är sparade').waitFor();
  for (const [n, m, p] of [['Klippning', '45', '500'], ['Konsultation', '30', '300']]) {
    await owner.goto(TB + '/tidsbokning');
    await owner.fill('form:has(button:has-text("Lägg upp tjänst")) input[name=name]', n); await owner.fill('input[name=minutes]', m); await owner.fill('form:has(button:has-text("Lägg upp tjänst")) input[name=price]', p);
    await owner.click('button:has-text("Lägg upp tjänst")'); await owner.locator('text=Tjänsten är upplagd').waitFor();
  }
  await owner.goto(TB + '/tidsbokning');
  const link = (await owner.locator('.bk-link code').innerText()).trim();
  const D = day(-3);
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(BASE + link + `?date=${D}`);
  const kl = guest.locator('.pb-service[data-name="Klippning"]');
  await kl.locator('select[name=time]').selectOption('10:00');
  await kl.locator('input[name=customer_name]').fill('Anna Kund'); await kl.locator('input[name=customer_email]').fill('anna@example.com');
  await kl.locator('button:has-text("Boka")').click(); await guest.locator('text=Klippning är bokad').waitFor();
  const opts = await guest.locator('.pb-service[data-name="Klippning"] select[name=time] option').allInnerTexts();
  assert(!opts.includes('10:00') && !opts.includes('10:30') && opts.includes('10:45') && opts.includes('09:15') && !opts.includes('09:30'), 'lediga tider utan krock: ' + opts.slice(0, 12).join(','));
  await guest.close();
  const staffBook = async (service, d, time, name) => {
    await owner.goto(TB + `/tidsbokning?date=${d}`);
    const f = owner.locator('form:has(button:text-is("Boka"))');
    await f.locator('select[name=service_id]').selectOption({ label: service }); await f.locator('input[name=date]').fill(d); await f.locator('input[name=time]').fill(time);
    await f.locator('input[name=customer_name]').fill(name); await f.locator('button').click();
  };
  await staffBook('Konsultation (30 min)', D, '10:15', 'Krock'); await owner.locator('text=Tiden är redan bokad').waitFor();
  await staffBook('Klippning (45 min)', day(-5), '13:00', 'Bertil Kund'); await owner.locator('text=Klippning är bokad').waitFor();
  await staffBook('Klippning (45 min)', D, '14:00', 'Cecilia Kund'); await owner.locator('text=Klippning är bokad').waitFor();
  const bk = (n) => owner.locator(`.bk-row[data-customer="${n}"]`);
  for (const n of ['Anna Kund', 'Bertil Kund', 'Cecilia Kund']) {
    await owner.goto(TB + `/tidsbokning?date=${D}`);
    await bk(n).locator('button:has-text("Förskott betalt")').click(); await owner.locator('text=är bokfört som förutbetald intäkt').waitFor();
  }
  assert(nb(await owner.locator('.bk-advance').innerText()) === '1200,00', 'tre förskott à 400 kr exkl. moms på 2420');
  await bk('Bertil Kund').locator('button:has-text("Avboka")').click(); await owner.locator('text=0,00 kr behålls, 500,00 kr betalas tillbaka').waitFor();
  await owner.goto(TB + `/tidsbokning?date=${D}`);
  await bk('Cecilia Kund').locator('button:has-text("Uteblev")').click(); await owner.locator('text=250,00 kr behålls, 250,00 kr betalas tillbaka').waitFor();
  await owner.goto(TB + `/tidsbokning?date=${D}`);
  await bk('Anna Kund').locator('button:has-text("Utförd")').click(); await owner.locator('text=Tjänsten är utförd och intäktsförd').waitFor();
  assert(nb(await owner.locator('.bk-advance').innerText()) === '0,00', 'förskotten är upplösta');
  assert(nb(await owner.locator('.bk-stats tr[data-service="Klippning"]').innerText()) === 'Klippning11750,00', 'statistik: ' + await owner.locator('.bk-stats').innerText());
  await owner.goto(TB + '/verifikationer');
  await owner.locator('tr:has-text("Uteblivet besök") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('2420') && t.includes('400,00') && t.includes('2611') && t.includes('50,00') && t.includes('200,00'), 'behållen avgift och återbetalning: ' + t.slice(0, 700));
  log('tidsbokning: publik bokningslänk med lediga tider utan krock, förskott som förutbetald intäkt med moms vid betalning, avbokning i tid, uteblivet besök med avgift, intäkt vid utförd tjänst');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 34: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
