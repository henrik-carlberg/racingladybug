// End-to-end, omgång 6: ägare och 3:12 (K10, lön eller utdelning, utdelning), BankID, autogiro, e-postmallar och
// betalningsprognos, Excel-export, jämförelser och schemalagda rapporter, kvitton utan uppkoppling och prestanda.
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

(async () => {
  const browser = await chromium.launch();
  const owner = await login(browser, 'agare@example.com', 'hemligtlosen1');
  const B = `${BASE}/c/1`;
  let t;
  const year = new Date().getUTCFullYear();

  // ================= Del 1: ägare, K10 och utdelning =================
  // Balanserad vinst att dela ut
  await owner.goto(B + '/verifikationer/ny');
  await owner.fill('input[name=description]', 'Balanserad vinst (test)');
  const vr = owner.locator('tbody tr');
  await vr.nth(0).locator('input').nth(0).fill('1930');
  await vr.nth(0).locator('input').nth(1).fill('50000');
  await vr.nth(1).locator('input').nth(0).fill('2091');
  await vr.nth(1).locator('input').nth(2).fill('50000');
  await owner.click('button:text-is("Bokför")');
  await owner.waitForURL(/verifikationer\/\d+/).catch(async (e) => { throw new Error('verifikation: ' + (await owner.locator('main').innerText()).slice(0, 800)); });

  await owner.goto(B + '/agare');
  const addOwner = async (name, pnr, share) => {
    const f = owner.locator('form:has(button:has-text("Lägg till ägare"))');
    await f.locator('input[name=name]').fill(name);
    await f.locator('input[name=personal_number]').fill(pnr);
    await f.locator('input[name=share_pct]').fill(share);
    await f.locator('button:has-text("Lägg till ägare")').click();
    await owner.locator(`summary:has-text("${name}")`).waitFor();
  };
  await addOwner('Ägare Testsson', '19800101-0019', '60');
  await addOwner('Bo Delägare', '19770303-0408', '40');
  const f3 = owner.locator('form:has(button:has-text("Lägg till ägare"))');
  await f3.locator('input[name=name]').fill('För Mycket');
  await f3.locator('input[name=share_pct]').fill('5');
  await f3.locator('button:has-text("Lägg till ägare")').click();
  await owner.waitForURL(/error=/);
  assert(decodeURIComponent(owner.url()).includes('mer än 100 %'), 'ägarandelar över 100 % nekas');
  await owner.goto(B + `/agare?year=2026`);
  t = await text(owner);
  assert(t.includes('Gränsbelopp (K10) för inkomstår 2026') && t.includes('193 440') && t.includes('128 960'), 'grundbelopp 4 IBB fördelat 60/40: ' + t.slice(0, 1500));
  log('ägare med ägarandelar (högst 100 %) och gränsbelopp 2026 enligt de nya 3:12-reglerna');

  const calc = owner.locator('.card:has(table.payout), .card:has(label:has-text("Vinst att ta ut"))').first();
  await calc.locator('label:has-text("Vinst att ta ut") input').fill('500000');
  await calc.locator('table.payout tr.best').first().waitFor();
  t = await calc.innerText();
  assert(t.includes('Bara lön') && t.includes('Bara utdelning') && t.includes('Mest kvar'), 'räknaren jämför lön och utdelning: ' + t.slice(0, 600));
  log('räknare för lön eller utdelning visar vad som blir kvar');

  await owner.goto(B + '/agare#utdelning');
  const dec = owner.locator('form:has(button:has-text("Bokför beslutet"))');
  await dec.locator('input[name=amount]').fill('100000000');
  await dec.locator('button').click();
  await owner.waitForURL(/error=/);
  assert(decodeURIComponent(owner.url()).includes('fria egna kapitalet'), 'utdelning över fritt eget kapital nekas');
  await owner.goto(B + '/agare#utdelning');
  await owner.locator('form:has(button:has-text("Bokför beslutet")) input[name=amount]').fill('30000');
  await owner.locator('form:has(button:has-text("Bokför beslutet")) button').click();
  await owner.waitForURL(/ok=/);
  await owner.locator('form:has(button:has-text("Betala ut och bokför")) input[name=amount]').fill('30000');
  await owner.click('button:has-text("Betala ut och bokför")');
  await owner.locator('text=Kontrolluppgift KU31').waitFor();
  await owner.locator('td:has-text("18 000,00")').waitFor();
  t = await text(owner);
  assert(t.includes(`Kontrolluppgift KU31 för ${year}`) && t.includes('18 000,00') && t.includes('12 000,00'), 'KU31 fördelad efter ägarandel: ' + t.slice(-1200));
  log('utdelning beslutas (2091 → 2898), betalas ut och fördelas på ägarna, underlag för KU31');

  // ================= Del 2: BankID (fejkad OIDC-leverantör på localhost:3307) =================
  const ISS = 'http://localhost:3307';
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-1', alg: 'RS256', use: 'sig' };
  let person = { ssn: '198001010019', name: 'Ägare Testsson' };
  const codes = new Map();
  const idp = http.createServer((req, res) => {
    const u = new URL(req.url, ISS);
    const json = (o, st = 200) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/.well-known/openid-configuration') return json({ issuer: ISS, authorization_endpoint: ISS + '/authorize', token_endpoint: ISS + '/token', jwks_uri: ISS + '/jwks' });
    if (u.pathname === '/jwks') return json({ keys: [jwk] });
    if (u.pathname === '/authorize') {
      // "Användaren legitimerar sig" direkt och skickas tillbaka med en kod
      const code = crypto.randomBytes(12).toString('hex');
      codes.set(code, { nonce: u.searchParams.get('nonce'), challenge: u.searchParams.get('code_challenge'), redirect: u.searchParams.get('redirect_uri'), person: { ...person }, hint: u.searchParams.get('login_hint') });
      res.writeHead(302, { location: `${u.searchParams.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(u.searchParams.get('state'))}` });
      return res.end();
    }
    if (u.pathname === '/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const f = new URLSearchParams(body);
        const c = codes.get(f.get('code'));
        codes.delete(f.get('code'));
        if (req.headers.authorization !== 'Basic ' + Buffer.from('test-client:test-secret').toString('base64')) return json({ error: 'invalid_client' }, 401);
        if (!c || crypto.createHash('sha256').update(f.get('code_verifier') || '').digest('base64url') !== c.challenge || f.get('redirect_uri') !== c.redirect) return json({ error: 'invalid_grant' }, 400);
        const now = Math.floor(Date.now() / 1000);
        const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-1' })).toString('base64url');
        const pl = Buffer.from(JSON.stringify({ iss: ISS, aud: 'test-client', exp: now + 300, iat: now, nonce: c.nonce, sub: 'sub-' + c.person.ssn, ssn: c.person.ssn, name: c.person.name })).toString('base64url');
        json({ id_token: `${h}.${pl}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${pl}`), privateKey).toString('base64url')}`, token_type: 'Bearer' });
      });
      return;
    }
    res.writeHead(404); res.end();
  }).listen(3307);

  await owner.goto(`${BASE}/konto#bankid`);
  await owner.click('button:has-text("Koppla BankID")');
  await owner.waitForURL(/ok=/);
  assert(decodeURIComponent(owner.url()).includes('BankID är kopplat (19800101-****)'), 'BankID kopplat: ' + owner.url());
  assert(await owner.locator('.badge:has-text("Kopplat")').count(), 'kontosidan visar att BankID är kopplat');

  const anon = await (await browser.newContext()).newPage();
  anon.setDefaultTimeout(20000);
  await anon.goto(BASE + '/login');
  await anon.click('button:has-text("Fortsätt med BankID")');
  await anon.waitForURL(BASE + '/');
  assert((await text(anon)).includes('Testbolaget AB'), 'inloggad med BankID');
  person = { ssn: '199002024567', name: 'Okänd Person' };
  const anon2 = await (await browser.newContext()).newPage();
  await anon2.goto(BASE + '/login');
  await anon2.click('button:has-text("Fortsätt med BankID")');
  await anon2.waitForURL(/login\?error=/);
  assert(decodeURIComponent(anon2.url()).includes('Inget konto är kopplat'), 'okänt personnummer loggas inte in');
  const forged = await anon2.goto(`${BASE}/api/bankid/callback?state=falsk&code=falsk`);
  assert(decodeURIComponent(anon2.url()).includes('startades inte i den här webbläsaren'), 'svar som inte startats i webbläsaren nekas: ' + anon2.url() + ' ' + forged.status());
  log('BankID kopplas till kontot, inloggning med BankID, okänd person och förfalskat svar nekas');

  // Signering med BankID: inloggad och via länk
  await owner.goto(B + '/dokument');
  await owner.fill('input[name=title]', 'Styrelsebeslut om firmatecknare');
  await owner.fill('textarea[name=text]', 'Styrelsen beslutar att Ägare Testsson tecknar firman ensam.');
  await owner.fill('input[name=name_1]', 'Extern Revisor');
  await owner.fill('input[name=email_1]', 'extern.revisor@example.com');
  await owner.click('button:has-text("Skapa dokument")');
  await owner.waitForURL(/\/dokument\/\d+/);
  const docUrl = owner.url().split('?')[0];
  const link = (await owner.locator('code.mono').first().textContent()).trim();
  person = { ssn: '199002024567', name: 'Okänd Person' };
  await owner.click('button:has-text("Signera med BankID")');
  await owner.waitForURL(/error=/);
  assert(decodeURIComponent(owner.url()).includes('annan person'), 'annans BankID kan inte signera åt dig');
  person = { ssn: '198001010019', name: 'Ägare Testsson' };
  await owner.goto(docUrl);
  await owner.click('button:has-text("Signera med BankID")');
  await owner.waitForURL(/ok=/);
  assert(decodeURIComponent(owner.url()).includes('signerat med BankID'), 'signerat med BankID');
  assert([...codes.values()].length === 0, 'koderna används en gång');
  person = { ssn: '197203154321', name: 'Extern Revisor' };
  const ext = await (await browser.newContext()).newPage();
  ext.setDefaultTimeout(20000);
  await ext.goto(link);
  await ext.click('button:has-text("Signera med BankID")');
  await ext.locator('text=Du signerade dokumentet').waitFor();
  await owner.goto(docUrl);
  t = await text(owner);
  assert(/bankid/i.test(t) && !(await owner.locator('button:has-text("Signera med BankID")').count()), 'båda har signerat med BankID: ' + t.slice(0, 800));
  log('dokument signeras med BankID av inloggad undertecknare och via länk; fel person nekas');
  idp.close();

  // ================= Del 3: e-postmallar, autogiro =================
  await owner.goto(B + '/installningar/mallar');
  const inv = owner.locator('section#invoice');
  await inv.locator('input[name=subject]').fill('Faktura {fakturanummer} – tack för att du handlar hos {företag}');
  await inv.locator('textarea[name=body]').fill('Hej {kund}!\n\nAtt betala: {belopp} senast {förfallodatum}.\n{foo}\n\n{företag}');
  await inv.locator('button:has-text("Spara")').click();
  await owner.waitForURL(/ok=/);
  const inv2 = owner.locator('section#invoice');
  t = await inv2.innerText();
  assert(t.includes('Egen text') && t.includes('Faktura 1042 – tack för att du handlar hos Testbolaget AB') && t.includes('Hej Exempelkunden AB!') && t.includes('Okända fält: {foo}'), 'mall med förhandsvisning och varning: ' + t.slice(0, 600));
  await inv2.locator('button:has-text("Återställ standardtext")').click();
  await owner.locator('section#invoice .badge:has-text("Standardtext")').waitFor();
  log('e-postmall med fält, förhandsvisning, varning för okända fält och återställning');

  await owner.goto(B + '/fakturor?status=booked');
  const custName = (await owner.locator('tbody tr').first().locator('td').nth(1).innerText()).trim();
  await owner.goto(B + '/autogiro');
  await owner.fill('input[name=customer_no]', '123456');
  await owner.click('form:has(input[name=customer_no]) button');
  await owner.waitForURL(/ok=/);
  await owner.selectOption('select[name=customer_id]', { label: custName });
  await owner.fill('input[name=id_number]', '556026-9986');
  await owner.fill('input[name=clearing]', '8327');
  await owner.fill('input[name=account]', '9123456789');
  await owner.click('button:has-text("Registrera medgivande")');
  await owner.locator('button:has-text("Skapa medgivandefil"):not([disabled])').waitFor();
  await owner.click('button:has-text("Skapa medgivandefil")');
  await owner.waitForURL(/fil=\d+/);
  const mfile = await (await owner.request.get(BASE + await owner.locator('a:has-text("Ladda ner filen")').getAttribute('href'))).text();
  const ml = mfile.split('\r\n').filter(Boolean);
  assert(ml.length === 2 && ml.every((l) => l.length === 80) && ml[0].startsWith('01') && ml[0].includes('AUTOGIRO') && ml[1].startsWith('04'), 'medgivandefil: ' + JSON.stringify(ml));
  await owner.click('button:has-text("Godkänt av banken")');
  await owner.locator('.badge:has-text("Aktiv")').waitFor();
  const rows = owner.locator('form:has(button:has-text("Skapa dragningsfil")) tbody tr');
  assert(await rows.count() >= 1, 'obetalda fakturor kan dras');
  const firstInv = (await rows.first().locator('td').nth(1).innerText()).trim();
  for (let i = 1; i < await rows.count(); i++) await rows.nth(i).locator('input[type=checkbox]').uncheck();
  const before = owner.url();
  await owner.click('button:has-text("Skapa dragningsfil")');
  await owner.waitForURL((u) => /fil=\d+/.test(u.href) && u.href !== before);
  const dfile = await (await owner.request.get(BASE + await owner.locator('a:has-text("Ladda ner filen")').getAttribute('href'))).text();
  const tk82 = dfile.split('\r\n').find((l) => l.startsWith('82'));
  assert(tk82 && tk82.length === 80, 'dragningspost: ' + dfile);
  // Bankgirots återrapport: samma post med statuskod 0 (genomförd)
  const OUT = process.argv[2] || require('node:os').tmpdir();
  const resultFile = require('node:path').join(OUT, 'ag-retur.txt');
  require('node:fs').writeFileSync(resultFile, dfile.split('\r\n')[0] + '\r\n' + tk82.slice(0, 79) + '0\r\n', 'latin1');
  await owner.setInputFiles('form:has(button:has-text("Läs in och bokför")) input[type=file]', resultFile);
  await owner.click('button:has-text("Läs in och bokför")');
  await owner.waitForURL((u) => decodeURIComponent(u.href).includes('dragningar bokförda') || u.href.includes('error='));
  assert(decodeURIComponent(owner.url()).includes('1 dragningar bokförda som betalda'), 'återrapporten bokförs: ' + owner.url());
  await owner.locator('tr:has(.badge:has-text("Betald"))').first().waitFor({ timeout: 5000 }).catch(() => {});
  assert((await owner.locator('tr:has(.badge:has-text("Betald"))').count()) >= 1, 'dragningen är betald: ' + (await text(owner)).slice(-900));
  await owner.goto(B + '/fakturor?status=paid');
  assert((await text(owner)).includes(firstInv), 'fakturan är betald');
  log('autogiro: medgivande, medgivandefil, dragningsfil i Bankgirots format och återrapport som bokför betalningen');

  // ================= Del 4: jämförelser, Excel och schemalagda rapporter =================
  await owner.goto(B + '/rapporter?jmf=fjol');
  t = await text(owner);
  assert(t.includes('Förra året') && t.includes('Skillnad') && t.includes('Beräknat resultat'), 'jämförelse mot förra året: ' + t.slice(0, 600));
  await owner.goto(B + '/rapporter?jmf=budget');
  assert((await text(owner)).includes('Budget'), 'jämförelse mot budget');
  for (const [r, name] of [['rrbr&jmf=fjol', 'resultat-balans'], ['kundfakturor', 'kundfakturor'], ['verifikationer', 'verifikationer'], ['leverantorsfakturor', 'leverantorsfakturor'], ['kunder', 'kunder']]) {
    const x = await owner.request.get(`${B}/rapporter/xlsx?r=${r}`);
    const body = await x.body();
    assert(x.status() === 200 && x.headers()['content-type'].includes('spreadsheetml') && body.slice(0, 2).toString() === 'PK' && x.headers()['content-disposition'].includes(name), `Excel ${r}: ${x.status()}`);
  }
  assert((await owner.request.get(`${B}/rapporter/xlsx?r=hemligt`)).status() === 400, 'okänd rapport nekas');
  log('resultaträkning jämförs med förra året och budget, Excel-export av rapporter och listor');

  await owner.goto(B + '/rapporter/utskick');
  await owner.fill('input[name=recipients]', 'styrelsen@example.com, inte-en-adress');
  await owner.click('button:has-text("Spara utskick")');
  await owner.waitForURL(/error=/);
  assert(decodeURIComponent(owner.url()).includes('Ogiltig e-postadress'), 'ogiltig mottagare nekas');
  const sthlmDay = Number(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }).slice(8, 10));
  const day = Math.min(sthlmDay, 28);
  await owner.goto(B + '/rapporter/utskick');
  await owner.fill('input[name=recipients]', 'styrelsen@example.com, banken@example.com');
  await owner.fill('input[name=day]', String(day));
  await owner.click('button:has-text("Spara utskick")');
  await owner.locator('td:has-text("styrelsen@example.com, banken@example.com")').waitFor();
  const cron = await owner.request.get(`${BASE}/api/cron/daily`, { headers: { authorization: 'Bearer testcron' } });
  const cj = await cron.json();
  const out = cj.rapportutskick ?? cj.result?.rapportutskick ?? cj.out?.rapportutskick ?? JSON.stringify(cj).match(/"rapportutskick":\{[^}]*\}/)?.[0];
  assert(cron.status() === 200 && JSON.stringify(out).includes('"due"'), 'daglig körning hittar utskick: ' + JSON.stringify(cj).slice(0, 400));
  if (day === sthlmDay) assert(/"due":\s*[1-9]/.test(JSON.stringify(out)), 'utskicket är aktuellt i dag: ' + JSON.stringify(out));
  log('schemalagd månadsrapport: mottagare kontrolleras, utskicket hittas av den dagliga körningen');

  // ================= Del 5: kvitton utan uppkoppling och jobbkö =================
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await phoneCtx.addCookies(await owner.context().cookies());
  const phone = await phoneCtx.newPage();
  phone.setDefaultTimeout(20000);
  await phone.goto(B + '/kvitto');
  await phone.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await phone.waitForTimeout(1000);
  // 1) Formuläret på sidan när uppkopplingen försvinner
  await phoneCtx.setOffline(true);
  await phone.fill('input[name=total]', '120');
  await phone.click('button:has-text("Kontorsmaterial")');
  await phone.fill('input[name=description]', 'Pennor utan täckning');
  await phone.click('button:has-text("Bokför kvitto")');
  await phone.locator('text=kvittot är sparat i telefonen').waitFor();
  await phone.locator('.outbox:has-text("1 kvitto väntar")').waitFor();
  // 2) Sidan öppnas utan uppkoppling: service workern visar offlineformuläret
  await phone.goto(B + '/kvitto');
  await phone.locator('text=Du är utan uppkoppling').waitFor();
  await phone.fill('input[name=total]', '89');
  await phone.selectOption('select[name=category]', 'kontor');
  await phone.fill('input[name=description]', 'Block i källaren');
  await phone.click('button:has-text("Spara kvittot")');
  await phone.locator('text=2 kvitton väntar').waitFor();
  log('utan uppkoppling sparas kvitton i telefonen, även när sidan öppnas utan täckning');
  await phoneCtx.setOffline(false);
  await phone.goto(B + '/kvitto');
  await phone.locator('.outbox:has-text("2 kvitton från telefonen är bokförda")').waitFor({ timeout: 30000 });
  await phone.reload();
  t = await text(phone);
  assert(t.includes('Pennor utan täckning') && t.includes('Block i källaren'), 'kvittona är bokförda: ' + t.slice(-800));
  log('när uppkopplingen är tillbaka bokförs kvittona automatiskt');

  await owner.goto(BASE + '/drift');
  t = await text(owner);
  assert(t.includes('Jobbkö') && /0 misslyckade/.test(t), 'jobbkön utan fel: ' + t.slice(0, 500));
  log('jobbkö för bakgrundsarbete syns på driftsidan');

  await browser.close();
  console.log('Omgång 6: alla steg gick igenom');
})().catch((e) => { console.error('✘', e.message, (e.stack || '').split('\n').find((l) => l.includes('omgang6.cjs'))); process.exit(1); });
