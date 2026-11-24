// End-to-end: SIE-import, att göra-listan, tvåstegsverifiering, GDPR (biträdesavtal, export, radering, gallring) och PWA.
const { chromium } = require('playwright');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = process.argv[2] || '/tmp';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const text = async (page) => { await page.waitForLoadState('networkidle'); await page.waitForSelector('main h1, h1'); const m = (await page.locator('main').count()) ? page.locator('main').first() : page.locator('body'); return (await m.textContent()).replace(/\s+/g, ' '); };
const login = async (p, email, pw) => {
  await p.goto(BASE + '/login');
  await p.fill('input[name=email]', email);
  await p.fill('input[name=password]', pw);
  await p.click('form button:has-text("Logga in")');
};
function totp(secret, t = Date.now()) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, v = 0; const key = [];
  for (const ch of secret.replace(/\s/g, '')) { v = (v << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { key.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = createHmac('sha1', Buffer.from(key)).update(msg).digest(); const o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(20000);
  await login(page, 'agare@example.com', 'hemligtlosen1');
  await page.waitForURL(BASE + '/');
  const B = `${BASE}/c/1`;

  // ---------- PWA ----------
  const man = await (await page.request.get(BASE + '/manifest.webmanifest')).json();
  assert(man.name === 'Ordna' && man.display === 'standalone' && man.icons.length === 2, 'manifest: ' + JSON.stringify(man));
  for (const f of ['/sw.js', '/offline.html', '/icon.svg']) assert((await page.request.get(BASE + f)).status() === 200, f);
  log('PWA: manifest, ikon, service worker och offlinesida');

  // ---------- Att göra ----------
  await page.goto(B);
  let t = await text(page);
  assert(t.includes('Att göra') && t.includes('Godkänn personuppgiftsbiträdesavtalet') && t.includes('Slå på tvåstegsverifiering'), 'att göra: ' + t.slice(0, 2000));
  log('översikten visar att göra-lista med biträdesavtal och tvåstegsverifiering');

  // ---------- GDPR: biträdesavtal ----------
  await page.goto(B + '/installningar/gdpr');
  await page.waitForURL(/installningar\/gdpr/);
  t = await text(page);
  assert(t.includes('Inte godkänt') && t.includes('Underbiträde') && t.includes('Register över behandlingar'), 'gdpr-sida: ' + t.slice(0, 1500));
  await page.click('button:has-text("Godkänn avtalet")');
  await page.waitForURL(/ok=/);
  t = await text(page);
  assert(t.includes('Godkänt') && !t.includes('Inte godkänt'), 'godkänt avtal: ' + page.url() + ' ' + t.slice(0, 1500));
  await page.goto(B);
  assert(!(await text(page)).includes('Godkänn personuppgiftsbiträdesavtalet'), 'försvinner från att göra');
  log('personuppgiftsbiträdesavtal godkänt och borta från att göra-listan');

  // ---------- Gallring ----------
  await page.goto(B + '/integrationer');
  await page.fill('input[name=name]', 'Trygghet');
  for (const s of ['payroll:write', 'accounting:read']) await page.check(`input[name=scopes][value="${s}"]`);
  await page.click('button:has-text("Skapa API-nyckel")');
  const token = (await page.locator('.flash.ok code').textContent({ timeout: 10000 })).trim();
  const api = async (method, p, body) => {
    const res = await fetch(`${BASE}/api/v1${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  const emp = await api('POST', '/employees', { first_name: 'Gammal', last_name: 'Kollega', personal_number: '19121212-1212', employment_start: '2010-01-01', employment_end: '2015-06-30', active: false, monthly_salary: 2500000, tax_table: 32 });
  assert(emp.status === 201, 'anställd: ' + JSON.stringify(emp));
  await page.goto(B + '/installningar/gdpr');
  t = await text(page);
  assert(t.includes('Gammal Kollega – slutade 2015-06-30'), 'gallringslista: ' + t.slice(-1500));
  await page.click('button:has-text("Gallra 1 tidigare anställda")');
  await page.waitForURL(/ok=/);
  t = await text(page);
  assert(t.includes('gallrade') && t.includes('Det finns inget att gallra'), 'gallrat: ' + t.slice(0, 800));
  log('gallring: anställd som slutade 2015 avidentifieras');

  // ---------- SIE-import ----------
  const sie = ['#FLAGGA 0', '#PROGRAM "Gammalt program" 9.1', '#FORMAT PC8', '#SIETYP 4', '#FNAMN "Testbolaget AB"', '#ORGNR 556026-9986',
    '#RAR 0 20230101 20231231', '#KONTO 1930 "Företagskonto"', '#KONTO 2081 "Aktiekapital"', '#KONTO 6993 "Testkostnad från SIE"', '#KONTO 3001 "Försäljning 25 %"',
    '#IB 0 1930 50000.00', '#IB 0 2081 -50000.00',
    '#VER A 1 20230115 "Sålt"', '{', '   #TRANS 1930 {} 1250.00', '   #TRANS 3001 {} -1000.00', '   #TRANS 2611 {} -250.00', '}',
    '#VER A 2 20230220 "Köpt \\"grejer\\""', '{', '   #TRANS 6993 {} 400.00', '   #TRANS 1930 {} -400.00', '}', ''].join('\r\n');
  const latin = Buffer.from(sie.replace(/ö/g, '\x94').replace(/Ö/g, '\x99').replace(/å/g, '\x86').replace(/ä/g, '\x84'), 'latin1');
  const file = path.join(OUT, 'import.se');
  fs.writeFileSync(file, latin);
  await page.goto(B + '/kom-igang/sie-import');
  await page.setInputFiles('input[type=file]', file);
  await page.click('button:has-text("Läs in och förhandsgranska")');
  await page.waitForURL(/sie-import\?id=\d+/);
  t = await text(page);
  assert(t.includes('Testbolaget AB') && t.includes('2023-01-01 – 2023-12-31 (läggs upp vid import)') && t.includes('Verifikationer2 (serie A: 2)') && t.includes('tillgångar 50 000,00 kr')
    && t.includes('Lägg till 1 nya konton'), 'förhandsgranskning: ' + t.slice(0, 2500));
  await page.click('button:has-text("Importera")');
  await page.waitForURL(/ok=/);
  t = await text(page);
  assert(t.includes('Importen är klar: 1 nya konton, ingående balanser, 2 verifikationer'), 'import: ' + t.slice(0, 1000));
  const bal = await api('GET', '/reports/balances?from=2023-01-01&to=2023-12-31');
  const row = (n) => (bal.json.data ?? bal.json.accounts ?? bal.json).find?.((r) => r.account === n);
  assert(row(1930)?.closing_balance === 5085000 && row(6993)?.change === 40000 && row(3001)?.change === -100000, 'saldon efter import: ' + JSON.stringify(bal.json).slice(0, 800));
  log('SIE 4 (PC8) importerad: räkenskapsår 2023, nytt konto, IB 50 000 kr, 2 verifikationer; bank UB 50 850 kr');
  await page.goto(B + '/kom-igang/sie-import');
  await page.setInputFiles('input[type=file]', file);
  await page.click('button:has-text("Läs in och förhandsgranska")');
  await page.waitForURL(/sie-import\?id=\d+/);
  t = await text(page);
  assert(t.includes('året har redan 2 verifikationer') && t.includes('redan registrerade för året'), 'dubbelimport: ' + t.slice(0, 2000));
  assert(await page.locator('input[name=vouchers]').isDisabled() && await page.locator('input[name=opening]').isDisabled(), 'kan inte importera igen');
  log('samma fil igen: verifikationer och IB kan inte importeras en gång till');

  // ---------- Tvåstegsverifiering ----------
  const u = await (await browser.newContext()).newPage();
  u.setDefaultTimeout(20000);
  await u.goto(BASE + '/register');
  await u.fill('input[name=name]', 'Tvåstegs Test');
  await u.fill('input[name=email]', 'tva@example.com');
  await u.fill('input[name=password]', 'tvastegslosen1');
  await u.check('input[name=terms]');
  await u.click('form button');
  await u.waitForURL((x) => !x.pathname.startsWith('/register'));
  await u.goto(BASE + '/konto');
  await u.click('button:has-text("Slå på tvåstegsverifiering")');
  await u.waitForSelector('code.totp-secret');
  const secret = (await u.locator('code.totp-secret').textContent()).replace(/\s/g, '');
  await u.fill('input[name=code]', '000000');
  await u.click('button:has-text("Slå på")');
  await u.waitForURL(/error=/);
  await u.fill('input[name=code]', totp(secret));
  await u.click('button:has-text("Slå på")');
  await u.waitForURL(/ok=/);
  const codes = (await u.locator('pre.backup-codes').textContent()).trim().split(/\s+/);
  assert(codes.length === 10, 'reservkoder: ' + codes);
  t = await text(u);
  assert(t.includes('10 oanvända reservkoder'), 'på');
  log('tvåstegsverifiering på med QR/nyckel och 10 reservkoder');

  await u.click('button:has-text("Logga ut")');
  await u.waitForURL(/login/);
  await login(u, 'tva@example.com', 'tvastegslosen1');
  await u.waitForURL(/\/login\/kod/);
  await u.fill('input[name=code]', '123456');
  await u.click('button:has-text("Logga in")');
  await u.waitForURL(/error=/);
  await u.goto(BASE + '/konto');
  assert(u.url().includes('/login'), 'inte inloggad utan kod');
  await login(u, 'tva@example.com', 'tvastegslosen1');
  await u.waitForURL(/\/login\/kod/);
  await u.fill('input[name=code]', totp(secret));
  await u.click('button:has-text("Logga in")');
  await u.waitForURL((x) => !x.pathname.startsWith('/login'));
  log('inloggning kräver engångskod: fel kod nekas, rätt kod släpper in');

  await u.goto(BASE + '/konto');
  await u.click('button:has-text("Logga ut")');
  await u.waitForURL(/login/);
  await login(u, 'tva@example.com', 'tvastegslosen1');
  await u.waitForURL(/\/login\/kod/);
  await u.fill('input[name=code]', codes[0].toUpperCase());
  await u.click('button:has-text("Logga in")');
  await u.waitForURL((x) => !x.pathname.startsWith('/login'));
  assert(decodeURIComponent(u.url()).includes('reservkod'), 'meddelande om reservkod');
  await u.goto(BASE + '/konto');
  await u.click('button:has-text("Logga ut")');
  await login(u, 'tva@example.com', 'tvastegslosen1');
  await u.waitForURL(/\/login\/kod/);
  await u.fill('input[name=code]', codes[0]);
  await u.click('button:has-text("Logga in")');
  await u.waitForURL(/error=/);
  await u.fill('input[name=code]', codes[1]);
  await u.click('button:has-text("Logga in")');
  await u.waitForURL((x) => !x.pathname.startsWith('/login'));
  log('reservkod fungerar en gång');

  // ---------- Export och radering ----------
  const ex = await u.request.get(BASE + '/konto/export');
  const data = await ex.json();
  assert(ex.status() === 200 && data.user.email === 'tva@example.com' && data.user.two_factor === true && Array.isArray(data.activity_log), 'export: ' + JSON.stringify(data).slice(0, 500));
  log('registerutdrag (JSON) nedladdat');

  await page.goto(BASE + '/konto');
  await page.click('summary:has-text("Radera mitt konto")');
  await page.fill('form:has(input[name=confirm]) input[name=password]', 'hemligtlosen1');
  await page.fill('input[name=confirm]', 'RADERA');
  await page.click('button:has-text("Radera kontot")');
  await page.waitForURL(/error=/);
  assert(decodeURIComponent(page.url()).includes('ensam ägare'), 'ensam ägare kan inte radera: ' + page.url());
  log('ensam ägare kan inte radera sitt konto');

  await u.goto(BASE + '/konto');
  await u.click('summary:has-text("Radera mitt konto")');
  await u.fill('form:has(input[name=confirm]) input[name=password]', 'tvastegslosen1');
  await u.fill('input[name=confirm]', 'RADERA');
  await u.click('button:has-text("Radera kontot")');
  await u.waitForURL(/login\?ok=/);
  await login(u, 'tva@example.com', 'tvastegslosen1');
  await u.waitForURL(/error=/);
  log('kontot raderat och anonymiserat – går inte att logga in');

  await browser.close();
  console.log('Alla trygghetstester gick igenom');
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
