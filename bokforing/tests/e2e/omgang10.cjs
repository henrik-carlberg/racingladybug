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

// Swish Handel, SMS (46elks) och inkassobolag
const sw = { got: [], status: {} };
const swServer = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const m = /^\/api\/v[12]\/paymentrequests\/([0-9A-F]{32})$/.exec(req.url);
    if (m && req.method === 'PUT') { const j = JSON.parse(b); sw.got.push({ id: m[1], ...j }); sw.status[m[1]] = 'CREATED';
      res.writeHead(201, j.payerAlias ? {} : { PaymentRequestToken: 'tok-' + m[1].slice(0, 6) }); return res.end(); }
    if (m && req.method === 'GET' && sw.status[m[1]]) { const r = sw.got.find((x) => x.id === m[1]); res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id: m[1], status: sw.status[m[1]], amount: Number(r.amount), paymentReference: 'SWREF1', datePaid: new Date().toISOString() })); }
    res.writeHead(404); res.end();
  });
}).listen(3312);
const sms = [];
const smsServer = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.headers.authorization === 'Basic ' + Buffer.from('sms-user:sms-pass').toString('base64')) sms.push(Object.fromEntries(new URLSearchParams(b)));
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}');
  });
}).listen(3313);
const ink = { cases: {}, got: [] };
const inkServer = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.headers.authorization !== 'Bearer ink-key') return send(401, { message: 'nyckel' });
    if (req.method === 'POST' && req.url === '/cases') { const j = JSON.parse(b); const id = 'C-' + (ink.got.length + 1); ink.got.push({ id, ...j }); ink.cases[id] = { status: 'registered' }; return send(201, { id, status: 'registered' }); }
    const m = /^\/cases\/([^/]+)(\/recall)?$/.exec(req.url);
    if (m && ink.cases[m[1]]) { if (m[2]) ink.cases[m[1]].status = 'recalled'; return send(200, ink.cases[m[1]]); }
    send(404, {});
  });
}).listen(3314);

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

  // ================= Del 3: skatt och bokslut som optimerar =================
  await owner.goto(B + '/verifikationer/ny');
  await owner.fill('input[name=date]', day(2));
  await owner.fill('input[name=description]', 'Engångsintäkt skatteplanering');
  const vr = owner.locator('tbody tr');
  await vr.nth(0).locator('td').nth(0).locator('input').fill('1930');
  await vr.nth(0).locator('td').nth(2).locator('input').fill('1222921,70');
  await vr.nth(1).locator('td').nth(0).locator('input').fill('3990');
  await vr.nth(1).locator('td').nth(3).locator('input').fill('1222921,70');
  await owner.click('button:text-is("Bokför")');
  await owner.waitForURL(/verifikationer\/\d+\?ok/);

  await owner.goto(B + '/skatt');
  t = await text(owner);
  assert(t.includes('Skattekontot framåt') && (t.includes('Saldot räcker') || /sätt in minst .* senast \d{4}-\d{2}-\d{2}/.test(t)), 'skattekontoprognos: ' + t.slice(0, 1500));
  await owner.fill('input[name=monthly]', '1000');
  await owner.click('.prelim button:has-text("Spara")');
  await owner.locator('text=Debiterad preliminärskatt är sparad').waitFor();
  t = await text(owner);
  assert(/Höj preliminärskatten till [\d\s ]+ kr i månaden/.test(t) && t.includes('Inbetalt med nuvarande F-skatt') && t.includes('12 000,00'), 'förslag på preliminärskatt: ' + t.slice(0, 2000));
  log('skattekontot framåt (moms, arbetsgivaravgifter, F-skatt) och förslag på ny preliminärskatt utifrån årets resultat');

  await owner.click('a:has-text("Bokslutsdispositioner för")');
  await owner.locator('.proposal[data-kind=periodiseringsfond]').waitFor();
  t = await text(owner);
  assert(t.includes('Resultat före dispositioner') && t.includes('Upp till 25 %') && t.includes('skjuter upp skatten i högst sex år') && /Skatten blir [\d\s ]+,\d\d kr lägre i år/.test(t), 'förslag med förklaring: ' + t.slice(0, 2000));
  const fondAcc = '212' + (Number(day(0).slice(3, 4)));
  assert(t.includes('kredit ' + fondAcc), 'fonden bokas på ' + fondAcc + ': ' + t.slice(0, 2000));
  await owner.click('.proposal[data-kind=periodiseringsfond] button');
  await owner.locator('text=Dispositionen är bokförd per bokslutsdagen').waitFor();
  assert((await owner.locator('.proposal[data-kind=periodiseringsfond]').count()) === 0 && (await owner.locator('tr.booked-appr:has-text("Periodiseringsfond")').count()) === 1, 'bokförd');
  await owner.click('tr.booked-appr:has-text("Periodiseringsfond") a');
  await owner.waitForURL(/verifikationer\/\d+/);
  t = await text(owner);
  assert(t.includes('8811') && t.includes(fondAcc) && t.includes('Periodiseringsfond'), 'verifikationen: ' + t.slice(0, 1200));
  log('bokslutsdispositioner föreslås med förklaring och skatteeffekt (periodiseringsfond 25 %) och bokförs med ett klick');

  await owner.goto(B + '/rapporter/moms');
  t = await text(owner);
  assert(t.includes('Avstämning ruta för ruta') && t.includes('Utgående moms stämmer mot försäljningen'), 'momsavstämning: ' + t.slice(0, 2000));
  log('momsdeklarationen stäms av ruta för ruta innan den lämnas in');

  // ================= Del 4: betalt snabbare =================
  await owner.goto(B + '/installningar/betalningar');
  await owner.check('input[name=swish_commerce]');
  await owner.selectOption('select[name=part_payment_max]', '3');
  await owner.fill('input[name=part_payment_min]', '1000');
  await owner.click('.pay-options button:has-text("Spara")');
  await owner.locator('text=Betalsätten är sparade').waitFor();
  await owner.goto(B + '/m/reskontra/installningar');
  await owner.check('input[name=sms]');
  await owner.click('button:has-text("Spara")');
  await owner.locator('.flash.ok').first().waitFor();
  await owner.goto(B + '/kunder/12');
  await owner.fill('input[name=phone]', '070-987 65 43');
  await owner.click('form button:text-is("Spara")');
  await owner.locator('text=Kunden är sparad').waitFor();
  await owner.goto(B + '/m/reskontra');
  await owner.click('tr:has-text("Portalkund AB") button:has-text("Påminnelse 1")');
  await owner.locator('text=/som SMS till \\+46709876543/').waitFor();
  const sm = sms[sms.length - 1];
  assert(sm && sm.to === '+46709876543' && /Påminnelse – faktura 1016 på 2 560,00 kr förföll/.test(sm.message.replace(/\s/g, ' ')) && /\/f\/[\w-]{20,}$/.test(sm.message), 'SMS-påminnelse: ' + JSON.stringify(sm));
  log('påminnelsen skickas även som SMS i samma serie, med länk till fakturan där kunden kan betala');

  await owner.goto(B + '/kunder/12');
  if (!(await owner.locator('code.portal-url').count())) { await owner.click('button:has-text("Skapa länk till kundportalen")'); await owner.locator('code.portal-url').waitFor(); }
  const portalUrl = (await owner.locator('code.portal-url').innerText()).replace(/^https?:\/\/[^/]+/, BASE);
  const cust = await (await browser.newContext()).newPage();
  await cust.goto(portalUrl);
  await cust.locator('.part-payment:has-text("faktura 1016")').waitFor();
  await cust.check('.part-payment input[name=n][value="3"]');
  await cust.click('.part-payment button:has-text("Dela upp betalningen")');
  await cust.locator('text=Betalningen är uppdelad').waitFor();
  assert(!(await cust.locator('.part-payment').count()), 'kan inte väljas två gånger');
  await cust.click('a:has-text("Faktura 1016")');
  await cust.locator('.installments').waitFor();
  t = await text(cust);
  assert(t.includes('Del 1') && t.includes('Del 3') && t.includes('833,00') && t.includes('834,00'), 'delbetalningsplanen syns på fakturan: ' + t.slice(0, 1500));
  log('kunden delar själv upp betalningen i kundportalen (3 delar, en månad mellan) och ser delarna på fakturan');

  assert((await text(cust)).includes('Betala 833,00 kr med Swish'), 'Swish för nästa del');
  await cust.fill('.swish-form input[name=phone]', '0701234567');
  await cust.click('button:has-text("Betala med Swish")');
  await cust.locator('.swish-wait').waitFor();
  const sr = sw.got[sw.got.length - 1];
  assert(sr.payeeAlias === '1234567890' && sr.amount === '833.00' && sr.payerAlias === '46701234567' && sr.currency === 'SEK' && sr.message === 'Faktura 1016' && /\/api\/swish\/callback$/.test(sr.callbackUrl), 'Swish-förfrågan: ' + JSON.stringify(sr));
  const swcb = async () => (await owner.request.post(BASE + '/api/swish/callback', { data: { id: sr.id, status: 'PAID', amount: 833 } })).status();
  assert(await swcb() === 200, 'callback');
  await cust.click('button:has-text("Jag har godkänt – kontrollera")');
  await cust.locator('.swish-wait').waitFor();
  log('Swish-förfrågan går till kundens app; ett falskt ”betald”-anrop gör ingenting – statusen hämtas från Swish');
  sw.status[sr.id] = 'PAID';
  assert(await swcb() === 200, 'callback 2');
  await cust.goto(cust.url());
  await cust.locator('.swish-paid').waitFor();
  t = await text(cust);
  assert(t.includes('833,00 kr är mottagen') && /Del 1 \S+ 833,00 Betald/.test(t), 'betald del: ' + t.slice(0, 1500));
  await owner.goto(B + '/fakturor/30');
  assert(/833,00/.test(await text(owner)), 'inbetalningen bokförd på fakturan');
  log('när Swish bekräftar bokförs inbetalningen på fakturan automatiskt och delen visas som betald');

  await owner.goto(B + '/m/reskontra');
  await owner.click('tr:has-text("Sen Betalare AB") button:has-text("Skicka till inkassobolaget")');
  await owner.locator('text=Fakturan är lämnad till inkassobolaget').waitFor();
  const ic = ink.got[0];
  assert(ic && ic.debtor.name === 'Sen Betalare AB' && ic.invoice.number === 1009 && ic.invoice.remaining === 1250000 && ic.reminders.length === 2 && ic.creditor.orgnr === '556026-9986', 'ärendet: ' + JSON.stringify(ic));
  t = await text(owner);
  assert(t.includes('Hos inkassobolaget') && t.includes('Registrerat hos inkassobolaget') && t.includes('C-1'), 'ärendet syns: ' + t.slice(0, 2000));
  const sign = (b) => 'sha256=' + crypto.createHmac('sha256', 'inksecret').update(b).digest('hex');
  const inkHook = async (b, sig) => (await owner.request.post(BASE + '/api/inkasso/webhook', { data: b, headers: { 'content-type': 'application/json', 'x-inkasso-signature': sig } })).status();
  assert(await inkHook('{"case_id":"C-1"}', 'sha256=00') === 401, 'osignerad webhook avvisas');
  ink.cases['C-1'] = { status: 'paid', status_text: 'Gäldenären har betalat', collected: 1250000 };
  assert(await inkHook('{"case_id":"C-1"}', sign('{"case_id":"C-1"}')) === 200, 'signerad webhook');
  await owner.goto(B + '/m/reskontra');
  t = await text(owner);
  assert(t.includes('Gäldenären har betalat') && /Betalt/.test(t) && !(await owner.locator('tr:has-text("Sen Betalare AB") button:has-text("Påminnelse")').count()), 'status tillbaka: ' + t.slice(0, 2000));
  await owner.goto(B + '/fakturor/20');
  assert(/Betald/.test(await text(owner)), 'fakturan är betald');
  log('inkasso lämnas via API; status kommer tillbaka (signerad webhook) och betalt hos inkassobolaget bokförs på fakturan');

  //@@NEXT@@
  await browser.close();
  appServer.close(); ebServer.close(); swServer.close(); smsServer.close(); inkServer.close();
  console.log('Omgång 10: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
