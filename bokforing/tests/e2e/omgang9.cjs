// End-to-end, omgång 9: årshjul, verifiering av firmatecknare, betalningar från appen, egna rapporter, revisorns arbetsyta.
const { chromium } = require('playwright');
const http = require('node:http');
const crypto = require('node:crypto');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const text = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); const sel = (await page.locator('main').count()) ? 'main' : 'body'; return (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').replace(/ /g, ' '); };
const iso = (d) => d.toISOString().slice(0, 10);
/** Samma dag i månaden n månader bakåt (sista dagen om månaden är kortare) */
const monthsAgo = (n) => { const t = new Date(); const y = t.getUTCFullYear(), m = t.getUTCMonth() - n; const len = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return iso(new Date(Date.UTC(y, m, Math.min(t.getUTCDate(), len)))); };

/** Organisationsnummer med rätt kontrollsiffra */
const orgnr = (base9) => { let sum = 0; [...base9].forEach((c, i) => { let d = Number(c) * (i % 2 === 0 ? 2 : 1); sum += d > 9 ? d - 9 : d; }); return base9 + ((10 - (sum % 10)) % 10); };

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
  const today = iso(new Date()), year = today.slice(0, 4);
  const addDays = (d, n) => iso(new Date(Date.parse(d) + n * 864e5));

  // ================= Del 1: årshjul och månadshjul =================
  await owner.goto(B + '/arshjul');
  t = await text(owner);
  assert(await owner.locator('.wheel svg').count() === 1 && t.includes('Skatter och deklarationer') && t.includes('Lön') && t.includes(`${year}`), 'årshjulet visas: ' + t.slice(0, 600));
  assert(await owner.locator('.wheel-dot').count() > 5, 'aktiviteter som punkter i hjulet');
  assert((await owner.locator('.wheel svg title#wheel-title').textContent()).includes('aktiviteter'), 'hjulet har en beskrivning för skärmläsare');
  log('årshjulet visar modulernas återkommande aktiviteter i en ring per modul');

  const addAct = async (f) => {
    const form = owner.locator('form.new-activity');
    for (const [k, v] of Object.entries(f)) {
      const el = form.locator(`[name=${k}]`);
      if (await el.evaluate((e) => e.tagName) === 'SELECT') await el.selectOption(v); else await el.fill(v);
    }
    await form.locator('button:has-text("Lägg till i årshjulet")').click();
    await owner.locator(`table td:has-text("${f.title}")`).first().waitFor();
  };
  const nextYear = String(Number(year) + 1);
  await addAct({ title: 'Lönesamtal', module: 'lon', recurrence: 'yearly', day: '15', month: '3', start_date: today });
  await addAct({ title: 'Avstämning med banken', module: 'bokslut', recurrence: 'monthly', day: '5', start_date: today });
  await addAct({ title: 'Påminnelsetest', module: 'allmant', recurrence: 'once', start_date: addDays(today, 3), remind_days: '3' });
  t = await text(owner);
  assert(t.includes('Lönesamtal') && t.includes('Varje år, 15 mars') && t.includes('Avstämning med banken') && t.includes('Varje månad, dag 5'), 'egna aktiviteter listas: ' + t.slice(-1500));
  log('egna återkommande aktiviteter: varje år, varje månad och en gång, med ansvarig och påminnelse');

  await owner.goto(`${B}/arshjul?vy=lista&ar=${nextYear}`);
  t = await text(owner);
  assert(t.includes(`${nextYear}-03-15`) && t.includes('Lönesamtal') && (await owner.locator('tr.wheel-item:has-text("Avstämning med banken")').count()) === 12, 'nästa år: lönesamtal i mars och bankavstämning varje månad: ' + t.slice(0, 600));
  await owner.goto(`${B}/arshjul?vy=lista&ar=${nextYear}&m=lon`);
  t = await text(owner);
  assert(t.includes('Lönesamtal') && t.includes('Lönekörning') && (await owner.locator('tr.wheel-item:has-text("Avstämning med banken")').count()) === 0 && !t.includes('Momsdeklaration'), 'filter på modulen Lön: ' + t.slice(0, 800));
  log('listvy per år och filter per modul (bara Lön)');

  const dec = `${year}-12`;
  await owner.goto(`${B}/arshjul?vy=manad&ar=${year}&manad=12`);
  t = await text(owner);
  assert(await owner.locator('.wheel svg').count() === 1 && t.includes('december') && t.includes(`${dec}-05`), 'månadshjulet för december: ' + t.slice(0, 800));
  const row = owner.locator(`tr.wheel-item:has-text("Avstämning med banken")`).first();
  await row.locator('button:has-text("Markera klar")').click();
  await owner.locator(`tr.wheel-item.done:has-text("Avstämning med banken")`).waitFor();
  log('månadshjul med dagarna runt hjulet; ett tillfälle bockas av');

  await owner.goto(`${B}/arshjul?vy=lista&ar=${year}&m=skatt`);
  const vatRow = owner.locator('tr.wheel-item:not(.done):has-text("Momsdeklaration")').first();
  const vatTitle = (await vatRow.locator('td').nth(2).innerText()).trim();
  await vatRow.locator('button:has-text("Markera klar")').click();
  await owner.locator(`tr.wheel-item.done:has-text("${vatTitle}")`).first().waitFor();
  await owner.goto(B + '/deadlines?visa=alla');
  t = await text(owner);
  assert(!t.includes(vatTitle) || new RegExp(`Klara.*${vatTitle}`).test(t), 'samma deadline är klar i deadlinelistan');
  log('deadline som bockas av i årshjulet är också klar i deadlinelistan');

  await owner.goto(`${B}/arshjul?vy=lista`);
  await owner.click('button:has-text("kalenderlänk")');
  await owner.waitForURL(/kalender=/);
  const cal = (await owner.locator('code.calendar-url').textContent()).trim();
  const ics = await owner.request.get(cal);
  const icsText = await ics.text();
  assert(ics.status() === 200 && ics.headers()['content-type'].includes('text/calendar') && icsText.includes('BEGIN:VCALENDAR') && icsText.includes('SUMMARY:Lönesamtal (Lön)') && icsText.includes('DTSTART;VALUE=DATE:'), 'iCal: ' + icsText.slice(0, 400));
  assert((await owner.request.get(BASE + '/kalender?t=' + 'x'.repeat(32))).status() === 404, 'okänd kalenderlänk');
  await owner.click('button:has-text("Skapa ny kalenderlänk")');
  await owner.waitForFunction((old) => { const c = document.querySelector('code.calendar-url'); return c && c.textContent.trim() !== old; }, cal);
  assert((await owner.request.get(cal)).status() === 404, 'gamla länken slutar gälla');
  log('årshjulet som kalender (iCal) med personlig länk som kan bytas');

  const cron = async () => (await (await owner.request.get(`${BASE}/api/cron/daily`, { headers: { authorization: 'Bearer testcron' } })).json()).arshjul;
  assert(await cron() >= 1 && await cron() === 0, 'påminnelse skickas en gång tre dagar före');
  log('påminnelse till den ansvarige tre dagar före, bara en gång');

  //@@NEXT@@
  await browser.close();
  console.log('Omgång 9: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
