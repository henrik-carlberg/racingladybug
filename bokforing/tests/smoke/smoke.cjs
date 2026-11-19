// Kontroll efter deploy: loggar in med ett testkonto i produktion och öppnar de viktigaste sidorna.
// Ändrar ingenting. Användning: SMOKE_URL=https://… SMOKE_EMAIL=… SMOKE_PASSWORD=… [SMOKE_VERSION=<commit>] node tests/smoke/smoke.cjs
const { chromium } = require('playwright');
const URL0 = (process.env.SMOKE_URL || '').replace(/\/$/, '');
const { SMOKE_EMAIL: email, SMOKE_PASSWORD: password, SMOKE_VERSION: version } = process.env;
if (!URL0 || !email || !password) { console.log('SMOKE_URL, SMOKE_EMAIL och SMOKE_PASSWORD behövs – hoppar över'); process.exit(0); }

(async () => {
  const results = [];
  const fail = (m) => { results.push(['✘', m]); };
  // 1. Hälsa och rätt version
  const h = await (await fetch(`${URL0}/api/health`)).json().catch(() => null);
  if (!h?.ok) fail('hälsokontrollen svarar inte ok: ' + JSON.stringify(h));
  else if (version && !String(version).startsWith(h.version) && !String(h.version).startsWith(String(version).slice(0, 7))) fail(`fel version i produktion: ${h.version}, väntade ${version}`);
  else results.push(['✔', `hälsa ok, version ${h.version}, databas ${h.db_ms} ms`]);
  // 2. Inloggning och sidor
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(30000);
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  try {
    await page.goto(`${URL0}/login`);
    await page.fill('input[name=email]', email);
    await page.fill('input[name=password]', password);
    await page.click('form:has(input[name=password]) button');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    results.push(['✔', 'inloggning']);
    const link = await page.locator('a[href^="/c/"]').first().getAttribute('href').catch(() => null);
    const cid = link?.match(/\/c\/(\d+)/)?.[1];
    if (!cid) fail('testkontot har inget bolag');
    else {
      for (const p of ['', '/fakturor', '/leverantorsfakturor', '/bank/avstamning', '/verifikationer', '/rapporter', '/lon', '/kvitto', '/installningar/status']) {
        const t0 = Date.now();
        const r = await page.goto(`${URL0}/c/${cid}${p}`);
        const ms = Date.now() - t0;
        const body = await page.locator('body').innerText();
        if (!r || r.status() >= 400) fail(`${p || '/'} svarade ${r?.status()}`);
        else if (/Application error|Internal Server Error|Något gick fel/i.test(body)) fail(`${p || '/'} visar ett fel`);
        else if (!(await page.locator('h1').count())) fail(`${p || '/'} saknar rubrik`);
        else results.push(['✔', `${p || '/ (översikt)'} ${ms} ms`]);
      }
    }
  } catch (e) { fail('avbrutet: ' + e.message); }
  await browser.close();
  if (consoleErrors.length) fail('fel i webbläsaren: ' + consoleErrors.slice(0, 3).join(' | '));
  for (const [s, m] of results) console.log(s, m);
  if (results.some(([s]) => s === '✘')) { console.error('Kontrollen efter deploy misslyckades'); process.exit(1); }
  console.log('Kontrollen efter deploy gick igenom');
})();
