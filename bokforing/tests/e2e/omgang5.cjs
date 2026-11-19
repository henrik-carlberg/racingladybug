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

  pushServer.close();
  await browser.close();
  console.log('Omgång 5: alla steg gick igenom');
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
