// End-to-end, omgång 5: inlärd kontering, mönster och förslag, ångra, hjälp i sammanhanget och kontroller,
// pushnotiser, kommentarer och frågor till kunden, flytt från andra program och årsredovisning i iXBRL.
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

  // ================= Del 1: inlärd kontering =================
  await owner.goto(B + '/leverantorer');
  await owner.fill('input[name=name]', 'Lärbolaget AB');
  await owner.click('button:has-text("Spara leverantör")');
  await owner.waitForURL(/ok=/);
  const registerInvoice = async (no, total, vat, account, amount) => {
    await owner.goto(B + '/leverantorsfakturor/ny');
    await owner.selectOption('select[name=supplier_id]', { label: 'Lärbolaget AB' });
    await owner.fill('input[name=invoice_number]', no);
    await owner.fill('input[name=due_date]', monthsAgo(-1));
    await owner.fill('input[name=total]', total);
    await owner.fill('input[name=vat]', vat);
    await owner.fill('input[name=account_0]', account);
    await owner.fill('input[name=amount_0]', amount);
    await owner.click('button:has-text("Registrera och bokför")');
    await owner.waitForURL(/ok=/);
  };
  await registerInvoice('LB-1', '1250', '250', '5410', '1000');
  await registerInvoice('LB-2', '625', '125', '5410', '500');
  await owner.goto(B + '/leverantorsfakturor/ny');
  const supplierId = await owner.locator('select[name=supplier_id] option', { hasText: 'Lärbolaget AB' }).getAttribute('value');
  await owner.goto(B + `/leverantorsfakturor/ny?leverantor=${supplierId}`);
  await owner.locator('.learned').waitFor();
  assert((await owner.locator('.learned').innerText()).includes('konto 5410, 25 % moms'), 'inlärd kontering visas');
  assert(await owner.inputValue('input[name=account_0]') === '5410', 'kontot ifyllt');
  await owner.fill('input[name=total]', '2500');
  await owner.locator('input[name=total]').blur();
  assert((await owner.inputValue('input[name=vat]')).replace(/\s/g, '') === '500,00', 'momsen räknas ut: ' + await owner.inputValue('input[name=vat]'));
  assert((await owner.inputValue('input[name=amount_0]')).replace(/\s/g, '') === '2000,00', 'beloppet exkl. moms');
  log('leverantörsfaktura: kontot och momsen fylls i som de två senaste gångerna');

  const receipt = async (desc) => {
    await owner.goto(B + '/kvitto');
    await owner.fill('input[name=total]', '89');
    await owner.click('button:has-text("Facklitteratur och tidningar")');
    await owner.fill('input[name=description]', desc);
    await owner.click('button:has-text("Bokför kvitto")');
    await owner.waitForURL(/ok=/);
  };
  await receipt('Pressbyrån Centralen');
  await receipt('Pressbyrån Centralen');
  await owner.goto(B + '/kvitto');
  await owner.fill('input[name=description]', 'Pressbyrån centralen');
  await owner.locator('.learned').waitFor();
  assert(await owner.locator('button:has-text("Facklitteratur och tidningar"):not(.secondary)').count(), 'kategorin vald som förra gångerna');
  assert(await owner.inputValue('select[name=vat_rate]') === '6', 'momsen som förra gångerna');
  log('kvitto: samma butik får samma kategori och moms');

  // ================= Del 1: mönster och förslag =================
  const voucher = async (date) => {
    await owner.goto(B + '/verifikationer/ny');
    await owner.fill('input[name=date]', date);
    await owner.fill('input[name=description]', 'Hyra förråd');
    const rows = owner.locator('tbody tr');
    await rows.nth(0).locator('input').nth(0).fill('5010');
    await rows.nth(0).locator('input').nth(1).fill('3000');
    await rows.nth(1).locator('input').nth(0).fill('1930');
    await rows.nth(1).locator('input').nth(2).fill('3000');
    await owner.click('button:text-is("Bokför")');
    await owner.waitForURL(/verifikationer\/\d+/);
  };
  for (const n of [3, 2, 1]) await voucher(monthsAgo(n));
  await owner.goto(B);
  t = await text(owner);
  assert(t.includes('Förslag') && t.includes('Bokför ”Hyra förråd” igen?'), 'förslag om återkommande verifikation: ' + t.slice(0, 800));
  await owner.locator('.suggestion:has-text("Hyra förråd") a.btn').click();
  await owner.waitForURL(/kopiera=\d+/);
  assert(await owner.inputValue('input[name=description]') === 'Hyra förråd', 'beskrivningen ifylld');
  assert(await owner.locator('tbody tr').nth(0).locator('input').nth(0).inputValue() === '5010', 'kontona ifyllda');
  await owner.goto(B);
  await owner.locator('.suggestion:has-text("Hyra förråd") button:has-text("Inte nu")').click();
  await owner.locator('.suggestion:has-text("Hyra förråd")').waitFor({ state: 'detached' });
  log('återkommande verifikation föreslås på översikten, fylls i med ett klick och kan avfärdas');

  // ================= Del 1: ångra =================
  await owner.goto(B + '/fakturor');
  const draftHref = await owner.locator('tbody a[href*="/fakturor/"]:text-is("Utkast")').first().getAttribute('href');
  await owner.goto(BASE + draftHref);
  await owner.click('button:has-text("Ta bort utkast")');
  await owner.waitForURL(/fakturor$/);
  await owner.locator('.toast:has-text("Utkastet tas bort") button:has-text("Ångra")').click();
  await owner.waitForTimeout(7000);
  await owner.goto(BASE + draftHref);
  assert((await text(owner)).includes('Bokför faktura'), 'utkastet finns kvar efter ångra');
  await owner.click('button:has-text("Ta bort utkast")');
  await owner.waitForURL(/fakturor$/);
  await owner.locator('.toast').waitFor({ state: 'detached', timeout: 20000 });
  await owner.waitForLoadState('networkidle');
  const gone = await owner.goto(BASE + draftHref);
  assert(gone.status() === 404, 'utkastet borttaget när tiden gått: ' + gone.status());
  log('ta bort utkast kan ångras i några sekunder, sedan tas det bort');

  // ================= Del 2: hjälp, tomma sidor och kontroller =================
  await owner.goto(B + '/bank/avstamning');
  await owner.locator('h1 details.help summary').click();
  assert((await owner.locator('h1 details.help .help-pop').innerText()).includes('Varje transaktion på bankkontot'), 'ordförklaring visas');
  log('ordförklaring med frågetecken (bankavstämning)');

  const fresh = await (await browser.newContext()).newPage();
  fresh.setDefaultTimeout(20000);
  await fresh.goto(BASE + '/register');
  await fresh.fill('input[name=name]', 'Nya Nilsson');
  await fresh.fill('input[name=email]', 'ny.omg5@example.com');
  await fresh.fill('input[name=password]', 'nyttlosen123');
  await fresh.check('input[name=terms]');
  await fresh.click('button:has-text("Skapa konto")');
  await fresh.waitForURL(BASE + '/');
  await fresh.fill('input[name=name]', 'Nystartat AB');
  await fresh.fill('input[name=orgnr]', orgnr('559912345'));
  await fresh.fill('input[name=fy_start]', '2026-01-01');
  await fresh.click('button:has-text("Skapa bolag")');
  await fresh.waitForURL(/kom-igang/);
  const NB = fresh.url().match(/(.*\/c\/\d+)/)[1];
  await fresh.goto(NB + '/fakturor');
  t = await text(fresh);
  assert(t.includes('Här hamnar dina kundfakturor') && await fresh.locator('.empty-state a:has-text("Skapa första fakturan")').count(), 'tom sida för kundfakturor: ' + t.slice(0, 400));
  await fresh.goto(NB + '/leverantorsfakturor');
  assert((await text(fresh)).includes('Inga leverantörsfakturor än'), 'tom sida för leverantörsfakturor');
  await fresh.goto(NB + '/bank/avstamning');
  assert((await text(fresh)).includes('Allt är avstämt'), 'tom bankavstämning');
  log('tomma sidor visar vad man gör först (nytt bolag)');

  await owner.goto(B + `/leverantorsfakturor/ny?leverantor=${supplierId}`);
  await owner.fill('input[name=invoice_number]', 'LB-1');
  await owner.fill('input[name=total]', '1250');
  await owner.locator('input[name=total]').blur();
  await owner.locator('.check-item.error:has-text("redan registrerat")').waitFor();
  assert(await owner.locator('.check-item.warn:has-text("samma belopp")').count(), 'varning för samma belopp');
  assert(await owner.locator('button:has-text("Registrera och bokför")').isDisabled(), 'kan inte registrera dubblett');
  await owner.fill('input[name=invoice_number]', 'LB-3');
  await owner.fill('input[name=invoice_date]', '2019-03-01');
  await owner.locator('.check-item.error:has-text("inget räkenskapsår")').waitFor();
  log('leverantörsfaktura: varning för dubblett, samma belopp och datum utan räkenskapsår');

  await owner.goto(B + '/verifikationer/ny');
  await owner.fill('input[name=description]', 'Kontrolltest');
  const vr = owner.locator('tbody tr');
  await vr.nth(0).locator('input').nth(0).fill('5410');
  await vr.nth(0).locator('input').nth(1).fill('1000');
  await vr.nth(1).locator('input').nth(0).fill('2640');
  await vr.nth(1).locator('input').nth(1).fill('200');
  await owner.click('button:has-text("+ Rad")');
  await vr.nth(2).locator('input').nth(0).fill('1930');
  await vr.nth(2).locator('input').nth(2).fill('1200');
  await owner.locator('.check-item.warn:has-text("20 %")').waitFor();
  assert(!(await owner.locator('button:text-is("Bokför")').isDisabled()), 'varning stoppar inte bokföringen');
  log('verifikation: varning när momsen inte är 25, 12 eller 6 %');

  // ================= Del 3: pushnotiser =================
  // En egen "pushtjänst" på localhost tar emot notiserna; enheten har riktiga nycklar så att innehållet kan dekrypteras
  const pushed = [];
  const pushServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { pushed.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(201); res.end(); });
  }).listen(3306);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const authSecret = crypto.randomBytes(16);
  const device = { endpoint: 'http://localhost:3306/push/agare', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') } };
  const post = (data, origin = BASE) => owner.request.post(`${BASE}/api/push`, { headers: { origin, 'content-type': 'application/json' }, data: JSON.stringify(data) });
  assert((await post(device)).status() === 200, 'enheten registreras');
  assert((await post({ ...device, endpoint: 'https://evil.example/push' })).status() === 400, 'okänd pushtjänst nekas');
  assert((await post(device, 'https://evil.example')).status() === 403, 'annan webbplats nekas');
  const decrypt = (m) => JSON.parse(require('http_ece').decrypt(m.body, { version: 'aes128gcm', privateKey: ecdh, authSecret }).toString());
  const waitPush = async (n) => { for (let i = 0; i < 50 && pushed.length < n; i++) await owner.waitForTimeout(200); assert(pushed.length >= n, `notis ${n} kom inte fram (${pushed.length})`); return pushed[n - 1]; };

  await owner.goto(`${BASE}/konto#notiser`);
  assert((await text(owner)).includes('1 enhet tar emot notiser'), 'enheten syns på kontosidan');
  await owner.click('button:has-text("Skicka en testnotis")');
  await owner.waitForURL(/ok=/);
  let m = await waitPush(1);
  assert(String(m.headers.authorization).startsWith('vapid t='), 'VAPID-signerad');
  assert(decrypt(m).title === 'Testnotis', 'testnotisen kan dekrypteras: ' + JSON.stringify(decrypt(m)));
  log('enheten registreras, testnotis skickas krypterad och signerad; okända pushtjänster och andra webbplatser nekas');

  await owner.goto(B + '/fakturor?status=booked');
  const openInv = await owner.locator('tbody a[href*="/fakturor/"]').first().getAttribute('href');
  await owner.goto(BASE + openInv);
  await owner.click('form:has(input[name=amount]) button');
  await owner.waitForURL(/ok=/);
  m = await waitPush(2);
  const paid = decrypt(m);
  assert(paid.title === 'Kunden har betalat' && paid.url === openInv, 'notis när kunden betalar: ' + JSON.stringify(paid));
  log('notis när en kund betalar, med länk till fakturan');

  // Avstängd notistyp skickas inte
  await owner.goto(`${BASE}/konto#notiser`);
  await owner.uncheck('input[name=paid]');
  await owner.click('form:has(input[name=paid]) button:has-text("Spara")');
  await owner.waitForURL(/ok=/);
  await owner.goto(B + '/fakturor?status=booked');
  await owner.goto(BASE + await owner.locator('tbody a[href*="/fakturor/"]').first().getAttribute('href'));
  await owner.click('form:has(input[name=amount]) button');
  await owner.waitForURL(/ok=/);
  await owner.waitForTimeout(2000);
  assert(pushed.length === 2, 'ingen notis när typen är avstängd: ' + pushed.length);
  log('notistyper kan väljas bort');

  // ================= Del 4: kommentarer, @nämn och underlag =================
  const klara = await accept(browser, await invite(owner, B, 'klara.omg5@example.com', 'accountant'), 'Klara Konsult', 'konsultlosen1');
  await owner.goto(B + '/verifikationer');
  await owner.locator('tbody a:has-text("Hyra förråd")').first().click().catch(async () => { await owner.locator('tbody tr:has-text("Hyra förråd") a').first().click(); });
  await owner.waitForURL(/verifikationer\/\d+/);
  const voucherUrl = owner.url();
  const box = owner.locator('textarea[name=body]');
  await box.click();
  await box.pressSequentially('@Kla');
  await owner.locator('.mention-list li:has-text("Klara Konsult")').waitFor();
  await box.press('Enter');
  await box.pressSequentially('kan du kolla momsen på den här?');
  assert((await box.inputValue()).startsWith('@Klara Konsult kan du'), 'namnet infogas: ' + await box.inputValue());
  await owner.click('button:has-text("Skicka kommentar")');
  await owner.waitForURL(/ok=/);
  assert((await owner.locator('.comment').innerText()).includes('kan du kolla momsen'), 'kommentaren visas');
  await klara.goto(B);
  t = await text(klara);
  assert(t.includes('Kommentarer där du nämns'), 'konsulten får en att göra-punkt: ' + t.slice(0, 500));
  await klara.goto(B + '/kommentarer');
  assert((await text(klara)).includes('Ny – du nämns'), 'kommentaren står först och är markerad');
  await klara.locator('a.comment-row').first().click();
  await klara.waitForURL(/verifikationer\/\d+/);
  assert((await klara.locator('.comment b.mention').count()) > 0, '@nämnandet markeras');
  await klara.locator('textarea[name=body]').fill('Momsen ser rätt ut, ingen moms på hyran.');
  await klara.click('button:has-text("Skicka kommentar")');
  await klara.waitForURL(/ok=/);
  await klara.goto(B);
  assert(!(await text(klara)).includes('Kommentarer där du nämns'), 'läst när tråden visats');
  await owner.goto(voucherUrl);
  assert((await owner.locator('.comment').count()) === 2, 'båda kommentarerna i tråden');
  log('kommentar på verifikation med @nämn: förslag när man skriver, att göra-punkt och notislista för den som nämns, svar i tråden');

  await klara.goto(B + '/bank/avstamning');
  const card = klara.locator('.card[id^=t]').first();
  const cardId = await card.getAttribute('id');
  await card.locator('button:has-text("Begär underlag")').click();
  await klara.waitForURL(/ok=/);
  assert(await klara.locator(`#${cardId} .badge:has-text("Underlag begärt")`).count(), 'kortet visar att underlag är begärt');
  await owner.goto(B);
  assert((await text(owner)).includes('Underlag att skicka in'), 'kunden får en att göra-punkt');
  await owner.goto(B + '/fragor');
  const q = owner.locator('.card:has(.badge:has-text("Underlag behövs"))').first();
  const OUT = process.argv[2] || require('node:os').tmpdir();
  const receiptFile = require('node:path').join(OUT, 'kvitto-omg5.png');
  require('node:fs').writeFileSync(receiptFile, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  await q.locator('input[type=file]').setInputFiles(receiptFile);
  await q.locator('button:has-text("Svara")').click();
  await owner.waitForURL(/ok=/);
  const link = owner.locator('a:has-text("Visa underlaget")').first();
  const res = await owner.request.get(BASE + await link.getAttribute('href'));
  assert(res.status() === 200 && res.headers()['content-type'].includes('image/png'), 'underlaget kan öppnas');
  await klara.goto(B + '/bank/avstamning');
  assert(await klara.locator(`#${cardId} .badge:has-text("Underlag inskickat")`).count(), 'byrån ser att underlaget kommit');
  log('byrån begär underlag för en banktransaktion, kunden svarar med en bild som sparas som underlag');

  // ================= Del 5: flytt från annat program och iXBRL =================
  await owner.goto(B + '/kom-igang');
  await owner.click('a:has-text("Flytta bokföringen, kunderna och de obetalda fakturorna")');
  await owner.waitForURL(/kom-igang\/flytt/);
  await owner.click('a.btn:has-text("Fortnox")');
  await owner.waitForURL(/program=fortnox/);
  t = await text(owner);
  assert(t.includes('I Fortnox:') && t.includes('Bokföringen (SIE-fil)') && t.includes('Importerat: import.se'), 'guiden visar Fortnox-instruktioner och att SIE-filen är importerad: ' + t.slice(0, 900));
  await owner.click('a:has-text("Visa kontrollen")');
  await owner.waitForURL(/flytt\/kontroll/);
  t = await text(owner);
  assert(t.includes('Ingående balanser') && /Alla \d+ konton stämmer/.test(t), 'ingående balanser stämmer mot SIE-filen: ' + t.slice(0, 900));
  assert(t.includes('Obetalda fakturor mot bokföringen') && t.includes('kundfordringar 1510') && t.includes('leverantörsskulder 2440'), 'reskontrorna jämförs');
  log('flyttguide för Fortnox med status per steg, kontroll av saldon mot SIE-filen och av reskontrorna');

  await owner.goto(B + '/bokslut');
  const fyHref = await owner.locator('a[href*="/bokslut/"]').first().getAttribute('href');
  const fyid = fyHref.match(/bokslut\/(\d+)/)[1];
  await owner.goto(B + `/bokslut/${fyid}/arsredovisning`);
  assert(await owner.locator('a:has-text("Ladda ner iXBRL")').count(), 'knapp för iXBRL');
  const xr = await owner.request.get(B + `/bokslut/${fyid}/arsredovisning/ixbrl`);
  assert(xr.status() === 200 && xr.headers()['content-type'].includes('application/xhtml+xml'), 'iXBRL-filen laddas ner: ' + xr.status());
  assert(/arsredovisning-\d{10}-\d{4}\.xhtml/.test(xr.headers()['content-disposition']), 'filnamn med organisationsnummer och år');
  const xml = await xr.text();
  const check = await owner.evaluate((src) => {
    const doc = new DOMParser().parseFromString(src, 'application/xhtml+xml');
    if (doc.getElementsByTagName('parsererror').length) return { error: doc.getElementsByTagName('parsererror')[0].textContent };
    const IX = 'http://www.xbrl.org/2013/inlineXBRL', XBRLI = 'http://www.xbrl.org/2003/instance';
    const facts = [...doc.getElementsByTagNameNS(IX, 'nonFraction')];
    const ctx = new Set([...doc.getElementsByTagNameNS(XBRLI, 'context')].map((c) => c.getAttribute('id')));
    const missing = facts.filter((f) => !ctx.has(f.getAttribute('contextRef'))).length;
    const v = (name, c) => facts.find((f) => f.getAttribute('name') === name && f.getAttribute('contextRef') === c)?.textContent.replace(/\s/g, '');
    return { facts: facts.length, missing, assets: v('se-gen-base:Tillgangar', 'balans0'), eqLiab: v('se-gen-base:EgetKapitalSkulder', 'balans0'), name: doc.getElementsByTagNameNS(IX, 'nonNumeric')[0]?.textContent };
  }, xml);
  assert(!check.error, 'giltig XML: ' + check.error);
  assert(check.facts > 10 && check.missing === 0, 'alla siffror märkta med befintliga kontexter: ' + JSON.stringify(check));
  assert(check.assets && check.assets === check.eqLiab, 'balansräkningen balanserar i iXBRL: ' + JSON.stringify(check));
  assert(check.name === 'Testbolaget AB', 'företagsnamnet märkt');
  log('årsredovisning som iXBRL: giltig XHTML, siffror märkta med kontexter och balanserad balansräkning');

  pushServer.close();
  await browser.close();
  console.log('Omgång 5: alla steg gick igenom');
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
