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

  //@@NEXT@@
  await browser.close();
  appServer.close();
  console.log('Omgång 10: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
