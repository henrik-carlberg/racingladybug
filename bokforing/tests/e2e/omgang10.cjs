// End-to-end, omgång 10: öppen plattform (OAuth), företagskort och utlägg, skatt och bokslut, betalt snabbare, sök och arkiv.
const { chromium } = require('playwright');
const http = require('node:http');
const crypto = require('node:crypto');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const text = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); const sel = (await page.locator('main').count()) ? 'main' : 'body'; return (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').replace(/ /g, ' '); };
const iso = (d) => d.toISOString().slice(0, 10);
const dec = (u) => decodeURIComponent(String(u).replace(/\+/g, ' '));

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

// Appens server: tar emot återkomsten och webhooks
const appSrv = { cb: [], hooks: [] };
const appServer = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/cb') appSrv.cb.push(Object.fromEntries(u.searchParams));
    if (u.pathname === '/hook') appSrv.hooks.push(b);
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok');
  });
}).listen(3399);

// Enable Banking (betalningar)
const ebp = { got: [], status: {} };
const ebServer = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (!/^Bearer .+\..+\..+$/.test(req.headers.authorization || '')) return send(401, {});
    if (req.method === 'POST' && req.url === '/payments') { const j = JSON.parse(b); const id = 'PAY-' + (ebp.got.length + 1); ebp.got.push({ id, ...j }); ebp.status[id] = 'ACTC'; return send(201, { payment_id: id, url: `${j.redirect_url}?state=${encodeURIComponent(j.state)}` }); }
    const m = /^\/payments\/(.+)$/.exec(req.url);
    if (m && ebp.status[m[1]]) return send(200, { payment_id: m[1], status: ebp.status[m[1]] });
    send(404, {});
  });
}).listen(3301);

(async () => {
  const browser = await chromium.launch();
  const owner = await login(browser, 'agare@example.com', 'hemligtlosen1');
  const B = `${BASE}/c/1`;
  let t;

  // ================= Del 1: öppen plattform =================
  await owner.goto(BASE + '/utvecklare');
  await owner.fill('form.new-app input[name=name]', 'Testappen');
  await owner.fill('form.new-app input[name=homepage]', 'https://testappen.example');
  await owner.fill('form.new-app input[name=description]', 'Synkar fakturor till säljsystemet');
  await owner.fill('form.new-app textarea[name=redirect_uris]', 'http://localhost:3399/cb');
  await owner.click('button:has-text("Registrera app")');
  await owner.locator('code.client-secret').waitFor();
  const clientId = (await owner.locator('code.client-id').textContent()).trim(), secret = (await owner.locator('code.client-secret').textContent()).trim();
  assert(/^app_/.test(clientId) && /^appsec_/.test(secret), 'klient-id och hemlighet');
  assert(!owner.url().includes('appsec_'), 'hemligheten hamnar inte i adressen');
  log('utvecklaren registrerar en app och får klient-id och hemlighet (visas en gång)');

  const verifier = crypto.randomBytes(40).toString('base64url'), challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const auth = (o = {}) => `${BASE}/oauth/authorize?` + new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: 'http://localhost:3399/cb', scope: 'sales:read hooks:write', state: 'st-1', code_challenge: challenge, code_challenge_method: 'S256', ...o });
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(auth());
  await anon.waitForURL(/\/login\?next=/);
  await anon.fill('input[name=email]', 'agare@example.com'); await anon.fill('input[name=password]', 'hemligtlosen1');
  await anon.click('form button:has-text("Logga in")');
  await anon.waitForURL(/\/oauth\/authorize/);
  t = await text(anon);
  assert(t.includes('Koppla Testappen') && t.includes('Synkar fakturor') && t.includes('Läsa kunder och kundfakturor') && t.includes('hooks:write') && t.includes('localhost:3399'), 'samtyckessidan: ' + t.slice(0, 800));
  log('inloggning leder tillbaka till samtyckessidan som visar appen, behörigheterna och vart användaren skickas');

  await anon.selectOption('select[name=company_id]', { label: 'Testbolaget AB (556026-9986)' });
  await anon.click('button:has-text("Godkänn")');
  await anon.waitForURL(/localhost:3399\/cb/);
  const cb = appSrv.cb.pop();
  assert(cb.code && cb.state === 'st-1', 'kod och state tillbaka till appen: ' + JSON.stringify(cb));
  const tokenReq = (body) => fetch(BASE + '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  const bad = await tokenReq({ grant_type: 'authorization_code', code: cb.code, redirect_uri: 'http://localhost:3399/cb', client_id: clientId, client_secret: secret, code_verifier: 'x'.repeat(50) });
  assert(bad.status === 400 && bad.json.error === 'invalid_grant', 'fel PKCE-verifierare: ' + JSON.stringify(bad));
  // En kod som har prövats med fel verifierare är förbrukad – godkänn igen
  await anon.goto(auth()); await anon.selectOption('select[name=company_id]', { label: 'Testbolaget AB (556026-9986)' }); await anon.click('button:has-text("Godkänn")'); await anon.waitForURL(/localhost:3399\/cb/);
  const code = appSrv.cb.pop().code;
  const tk = await tokenReq({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:3399/cb', client_id: clientId, client_secret: secret, code_verifier: verifier });
  assert(tk.status === 200 && /^oat_/.test(tk.json.access_token) && /^ort_/.test(tk.json.refresh_token) && tk.json.scope === 'sales:read hooks:write', 'token: ' + JSON.stringify(tk));
  assert((await tokenReq({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:3399/cb', client_id: clientId, client_secret: secret, code_verifier: verifier })).json.error === 'invalid_grant', 'koden kan bara användas en gång');
  assert((await tokenReq({ grant_type: 'authorization_code', code: 'x', redirect_uri: 'http://localhost:3399/cb', client_id: clientId, client_secret: 'fel', code_verifier: verifier })).status === 401, 'fel klienthemlighet');
  log('koden växlas mot token med PKCE och hemlighet; fel verifierare och återanvänd kod avvisas');

  const api = (tok, method, path, body) => fetch(`${BASE}/api/v1${path}`, { method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  let access = tk.json.access_token;
  assert((await api(access, 'GET', '/customers')).status === 200, 'läsa kunder');
  const w = await api(access, 'POST', '/customers', { name: 'Ska inte gå' });
  assert(w.status === 403 && w.json.error.code === 'insufficient_scope', 'skriva kräver sales:write: ' + JSON.stringify(w));
  const hook = await api(access, 'POST', '/hooks', { target_url: 'http://localhost:3399/hook', event: 'invoice.paid' });
  assert(hook.status === 201 && hook.json.event === 'invoice.paid', 'REST hook: ' + JSON.stringify(hook));
  const noHook = await api(access, 'POST', '/hooks', { target_url: 'http://localhost:3399/hook', event: 'employee.updated' });
  assert(noHook.status === 400 && noHook.json.error.message.includes('Behörighet saknas'), 'hook utan läsrätt till området: ' + JSON.stringify(noHook));
  log('appen anropar API:et inom sina behörigheter och prenumererar (REST hook) bara på händelser den får läsa');

  const rf = await tokenReq({ grant_type: 'refresh_token', refresh_token: tk.json.refresh_token, client_id: clientId, client_secret: secret });
  assert(rf.status === 200 && rf.json.access_token !== access, 'ny token med refresh-token');
  assert((await tokenReq({ grant_type: 'refresh_token', refresh_token: tk.json.refresh_token, client_id: clientId, client_secret: secret })).json.error === 'invalid_grant', 'refresh-token byts vid användning');
  access = rf.json.access_token;
  log('refresh-token ger ny åtkomst och kan bara användas en gång');

  await owner.goto(B + '/installningar/appar');
  t = await text(owner);
  assert(t.includes('Testappen') && t.includes('sales:read') && t.includes('1 prenumerationer') && /GET \/customers/.test(t) && t.includes('403'), 'kopplade appar och anropslogg: ' + t.slice(0, 1500));
  await owner.click('section.app:has-text("Testappen") button:has-text("Koppla bort")');
  await owner.waitForURL(/ok=/);
  assert((await api(access, 'GET', '/customers')).status === 401, 'bortkopplad app har ingen åtkomst');
  assert((await owner.locator('section.app').count()) === 0, 'appen borta ur listan');
  log('bolaget ser appens behörigheter, användning och anrop – och kopplar bort den (åtkomst och prenumerationer upphör)');

  await anon.goto(auth());
  await anon.click('button:has-text("Avbryt")');
  await anon.waitForURL(/localhost:3399\/cb/);
  assert(appSrv.cb.pop().error === 'access_denied', 'nekat');
  await anon.goto(auth({ redirect_uri: 'https://evil.example/cb' }));
  assert((await text(anon)).includes('Återkomstadressen är inte registrerad'), 'okänd återkomstadress');
  await anon.goto(auth({ code_challenge_method: 'plain' }));
  assert((await text(anon)).includes('PKCE med S256 krävs'), 'PKCE krävs');
  log('användaren kan neka; okända återkomstadresser och avsaknad av PKCE avvisas');

  await owner.goto(BASE + '/utvecklare');
  await owner.click('button:has-text("Skapa testbolag")');
  await owner.waitForURL(/\/c\/\d+$/);
  assert((await text(owner)).includes('Demobolaget AB'), 'testbolag');
  log('utvecklaren skapar ett testbolag att prova appen mot');

  // ================= Del 2: företagskort och utlägg =================
  const day = (n) => iso(new Date(Date.now() - n * 864e5));
  await owner.goto(B + '/kort');
  assert((await text(owner)).includes('Inget bankkonto är markerat som företagskort'), 'inga kort ännu');
  const crow = owner.locator('tr:has-text("Företagskort")').last();
  await crow.locator('input[name=is_card]').check();
  await crow.locator('select[name=holder]').selectOption({ label: 'Ägare Testsson' });
  await crow.locator('button:has-text("Spara")').click();
  await owner.locator('tr.card-row:has-text("Företagskort")').waitFor();
  const camt = (rows) => `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>${rows.map(([amt, d, ref, txt]) =>
    `<Ntry><Amt Ccy="SEK">${amt}</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${d}</Dt></BookgDt><AcctSvcrRef>${ref}</AcctSvcrRef><NtryDtls><TxDtls><RmtInf><Ustrd>${txt}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`).join('')}</Stmt></BkToCstmrStmt></Document>`;
  const importCard = async (rows) => {
    await owner.goto(B + '/bank');
    const r = owner.locator('tr:has-text("Företagskort")').first();
    await r.locator('input[type=file]').setInputFiles({ name: 'kort.xml', mimeType: 'application/xml', buffer: Buffer.from(camt(rows)) });
    await r.locator('button:has-text("Importera")').click();
    await owner.locator('.flash.ok').first().waitFor();
  };
  await importCard([['125.00', day(1), 'KORT-1', 'KORTKOP ICA MAXI XK'], ['349.00', day(5), 'KORT-2', 'KORTKOP CLAS OHLSON XK']]);
  await owner.goto(B + '/kvitto');
  await owner.fill('input[name=total]', '125');
  await owner.fill('input[name=date]', day(1));
  await owner.click('button:has-text("Kontorsmaterial")');
  await owner.fill('input[name=description]', 'Fika ICA');
  await owner.click('button:has-text("Bokför kvitto")');
  await owner.locator('text=Kvittot är bokfört').first().waitFor();
  await owner.goto(B + '/kort');
  t = await text(owner);
  assert(/\d+ st · /.test(t) && t.includes('ICA MAXI XK') && t.includes('CLAS OHLSON XK'), 'två kortköp saknar kvitto: ' + t.slice(0, 1200));
  await owner.click('button:has-text("Koppla kvitton till kortköp")');
  await owner.locator('text=/\\d+ kortköp kopplades till kvitton/').waitFor();
  t = await text(owner);
  assert(!t.includes('ICA MAXI XK') && t.includes('CLAS OHLSON XK'), 'redan bokfört kvitto kopplas till köpet: ' + t.slice(0, 1200));
  log('bankkonto markeras som företagskort; kortköp kopplas automatiskt till redan bokförda kvitton (belopp och datum)');

  await owner.click('tr.missing-tx:has-text("CLAS OHLSON XK") a:has-text("Fota kvitto")');
  await owner.locator('.card-tx').waitFor();
  assert(await owner.inputValue('input[name=total]') === '349,00' && await owner.inputValue('input[name=date]') === day(5), 'belopp och datum förifyllda');
  await owner.click('button:has-text("Kontorsmaterial")');
  await owner.setInputFiles('input[type=file][name=file]', { name: 'kvitto.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
  await owner.click('button:has-text("Bokför kvitto")');
  await owner.locator('text=Kvittot är bokfört och kopplat till kortköpet').waitFor();
  assert(!(await text(owner)).includes('CLAS OHLSON XK'), 'köpet har kvitto');
  log('”Fota kvitto” på ett kortköp: förifyllt belopp och datum, kvittot bokförs och stäms av mot köpet direkt');

  await importCard([['89.00', day(3), 'KORT-3', 'KORTKOP PARKERING XK']]);
  const cronDaily = async () => (await (await owner.request.get(`${BASE}/api/cron/daily`, { headers: { authorization: 'Bearer testcron' } })).json()).kortkvitton;
  const k1 = await cronDaily(), k2 = await cronDaily();
  assert(k1 && k1.reminded >= 1 && k2.reminded === 0, 'påminnelse om kvitto en gång: ' + JSON.stringify([k1, k2]));
  log('kortinnehavaren påminns (pushnotis) om kortköp som saknar kvitto efter två dagar, inte varje natt');

  // Körjournal → milersättning, traktamente från tider, utbetalning via banken
  await owner.goto(B + '/m/utlagg/korjournal');
  const trip = async (o) => {
    await owner.selectOption('select[name=employee_id]', { label: 'Anna Andersson' });
    await owner.fill('input[name=date]', o.date);
    await owner.selectOption('select[name=vehicle]', o.vehicle);
    await owner.fill('input[name=from]', o.from); await owner.fill('input[name=to]', o.to); await owner.fill('input[name=purpose]', o.purpose);
    if (o.km) await owner.fill('input[name=km]', o.km);
    if (o.odo) { await owner.fill('input[name=odo_start]', o.odo[0]); await owner.fill('input[name=odo_end]', o.odo[1]); }
    const n = await owner.locator('tr.trip').count();
    await owner.click('button:has-text("Spara resa")');
    await owner.waitForFunction((n) => document.querySelectorAll('tr.trip').length > n, n);
  };
  await trip({ date: day(4), vehicle: 'private', from: 'Kontoret', to: 'Kund Borås', purpose: 'Kundmöte', km: '42' });
  await trip({ date: day(3), vehicle: 'private', from: 'Kontoret', to: 'Mässan', purpose: 'Mässa', odo: ['1000', '1080'] });
  await trip({ date: day(2), vehicle: 'company', from: 'Kontoret', to: 'Lager', purpose: 'Leverans', km: '15' });
  t = await text(owner);
  assert(t.includes('Egen bil 122 km') && t.includes('företagets bil 15 km') && t.includes('mätare 1000–1080'), 'körjournal: ' + t.slice(0, 1500));
  await owner.goto(B + '/m/utlagg');
  await owner.selectOption('select[name=employee_id]', { label: 'Anna Andersson' });
  await owner.fill('input[name=title]', 'Resa Borås ZK');
  await owner.click('button:has-text("Skapa")');
  await owner.locator('text=2 oersatta resor med egen bil').waitFor();
  const claimUrl = owner.url().split('?')[0];
  await owner.click('button:has-text("Lägg till resorna")');
  await owner.locator('text=2 resor från körjournalen är tillagda').waitFor();
  await owner.fill('input[name=depart]', `${day(3)}T07:00`);
  await owner.fill('input[name=return]', `${day(1)}T20:00`);
  await owner.fill('form:has-text("Traktamente") input[name=description]', 'Göteborg, mässa');
  await owner.click('button:has-text("Lägg till traktamente")');
  await owner.locator('text=3 hela, 0 halva dagar, 2 nätter').waitFor();
  t = await text(owner);
  assert(t.includes('Kontoret – Kund Borås, Kundmöte') && t.includes('105,00') && t.includes('200,00') && t.includes('1 200,00') && t.includes('1 505,00'), 'räkningen: ' + t.slice(0, 1800));
  log('körjournalens resor med egen bil blir milersättning med ett klick; traktamente räknas ut från avresa och hemkomst');

  await owner.click('button:has-text("Skicka in för attest")');
  await owner.locator('text=Räkningen är inskickad').waitFor();
  await owner.click('button:has-text("Attestera och bokför")');
  await owner.locator('text=Räkningen är attesterad och bokförd').waitFor();
  await owner.selectOption('form.pay-bank select[name=pay_account]', { label: 'Företagskonto' });
  await owner.click('button:has-text("Betala med BankID")');
  await owner.locator('text=Godkänd – genomförs').waitFor();
  const exp = ebp.got[ebp.got.length - 1].payment_request.credit_transfer_transaction;
  assert(exp.length === 1 && exp[0].instructed_amount.amount === '1505.00' && JSON.stringify(exp[0]).includes('1234567890'), 'utbetalning till Annas konto: ' + JSON.stringify(exp));
  assert(!(await owner.locator('button:has-text("Betala med BankID")').count()), 'kan inte betalas två gånger medan den väntar');
  ebp.status[ebp.got[ebp.got.length - 1].id] = 'ACSC';
  await owner.goto(claimUrl);
  await owner.click('button:has-text("Hämta status från banken")');
  await owner.waitForURL(/Status/);
  await owner.locator('.bank-payments .badge:has-text("Genomförd och bokförd")').waitFor();
  t = await text(owner);
  assert(t.includes('Utbetald') && /verifikation/.test(t), 'räkningen är utbetald och bokförd: ' + t.slice(0, 1500));
  log('attesterat utlägg betalas till den anställdas konto via banken med BankID och bokförs när banken genomfört betalningen');

  //@@NEXT@@
  await browser.close();
  appServer.close(); ebServer.close();
  console.log('Omgång 10: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
