// End-to-end, omgång 13: föreningar, fastighet och uthyrning, K3 och kassaflödesanalys, import och tull, företagsinloggning.
const { chromium } = require('playwright');
const http = require('node:http');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const text = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); const sel = (await page.locator('main').count()) ? 'main' : 'body'; return (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').replace(/ /g, ' '); };
const iso = (d) => d.toISOString().slice(0, 10);
const day = (n) => iso(new Date(Date.now() - n * 864e5));
const YEAR = new Date().getFullYear();

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

const mailServer = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"m1"}'); }); }).listen(3303);

// Identitetsleverantör (OIDC) för företagsinloggning
const crypto = require('node:crypto');
const { privateKey: idpKey, publicKey: idpPub } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const idpJwk = { ...idpPub.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const IDP = 'http://localhost:3317';
const idp = { codes: {}, amr: ['pwd', 'mfa'] };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idpServer = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const u = new URL(req.url, IDP);
    const send = (c, j) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (u.pathname === '/.well-known/openid-configuration') return send(200, { issuer: IDP, authorization_endpoint: `${IDP}/authorize`, token_endpoint: `${IDP}/token`, jwks_uri: `${IDP}/jwks` });
    if (u.pathname === '/jwks') return send(200, { keys: [idpJwk] });
    if (u.pathname === '/authorize') {
      const code = crypto.randomBytes(8).toString('hex');
      idp.codes[code] = { nonce: u.searchParams.get('nonce'), email: u.searchParams.get('login_hint'), client: u.searchParams.get('client_id'), challenge: u.searchParams.get('code_challenge') };
      res.writeHead(302, { location: `${u.searchParams.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(u.searchParams.get('state'))}` }); return res.end();
    }
    if (u.pathname === '/token' && req.method === 'POST') {
      if (req.headers.authorization !== 'Basic ' + Buffer.from('bok-sso:sso-secret').toString('base64')) return send(401, { error: 'invalid_client' });
      const p = new URLSearchParams(b); const c = idp.codes[p.get('code')]; delete idp.codes[p.get('code')];
      if (!c || crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') !== c.challenge) return send(400, { error: 'invalid_grant' });
      const now = Math.floor(Date.now() / 1000);
      const head = b64u({ alg: 'RS256', kid: 'k1', typ: 'JWT' }), body = b64u({ iss: IDP, aud: c.client, sub: 'u-' + c.email, email: c.email, email_verified: true, nonce: c.nonce, iat: now, exp: now + 300, amr: idp.amr });
      const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), idpKey).toString('base64url');
      return send(200, { access_token: 'at', token_type: 'Bearer', id_token: `${head}.${body}.${sig}` });
    }
    send(404, {});
  });
}).listen(3317);

(async () => {
  const browser = await chromium.launch();
  const owner = await login(browser, 'agare@example.com', 'hemligtlosen1');
  const B = `${BASE}/c/1`;
  let t;

  // ================= Del 1: föreningar =================
  await owner.goto(B + '/forening');
  await owner.click('button.enable-association');
  await owner.locator('text=Föreningsläget är på').waitFor();
  const addM = async (name, email, category, joined) => {
    await owner.goto(B + '/forening');
    await owner.fill('form:has(button:has-text("Lägg till medlem")) input[name=name]', name);
    await owner.fill('form:has(button:has-text("Lägg till medlem")) input[name=email]', email);
    await owner.fill('form:has(button:has-text("Lägg till medlem")) input[name=category]', category);
    await owner.fill('form:has(button:has-text("Lägg till medlem")) input[name=joined]', joined);
    await owner.click('button:has-text("Lägg till medlem")');
    await owner.locator('text=är registrerad').waitFor();
  };
  await addM('Anna Medlem', 'anna@example.com', 'Ordinarie', `${YEAR}-01-10`);
  await addM('Bert Ungdom', 'bert@example.com', 'Ungdom', `${YEAR}-02-01`);
  await addM('Cilla Ledig', '', 'Ordinarie', `${YEAR - 2}-05-01`);
  t = await text(owner);
  assert(/1 Anna Medlem Ordinarie/.test(t) && /3 Cilla Ledig/.test(t) && (await owner.locator('.member-count').innerText()) === '3', 'medlemsregister: ' + t.slice(0, 1500));
  await owner.locator('tr.member:has-text("Cilla Ledig") button:has-text("Utträde")').click();
  await owner.locator('text=Utträdet är registrerat').waitFor();
  log('medlemsregister med löpnummer, kategori, inträde och utträde');

  const setRate = async (cat, amt) => {
    await owner.goto(B + '/forening');
    await owner.fill('form:has(button:has-text("Spara")):has(input[name=amount]) input[name=category]', cat);
    await owner.fill('form:has(input[name=amount]):has(input[name=category]) input[name=amount]', amt);
    await owner.click('form:has(input[name=amount]):has(input[name=category]) button:has-text("Spara")');
    await owner.locator('text=Avgiften är sparad').waitFor();
  };
  await setRate('Ordinarie', '300');
  await setRate('Ungdom', '100');
  await owner.goto(B + '/forening');
  await owner.click('button:has-text("Avisera")');
  await owner.locator('text=2 avier är skapade och bokförda').waitFor();
  t = await text(owner);
  assert(/Anna Medlem 300,00/.test(t) && /Bert Ungdom 100,00/.test(t) && !/Cilla Ledig 300/.test(t), 'avier: ' + t.slice(0, 2500));
  assert((await owner.locator('tr.fee .fee-status').first().innerText()) === 'Obetald', 'status');
  await owner.click('button:has-text("Avisera")');
  await owner.locator('.flash.error, .flash:has-text("inga medlemmar att avisera")').first().waitFor();
  log('medlemsavgiften aviseras per kategori som momsfri faktura med OCR – en gång per medlem och år');

  await owner.locator('tr.fee:has-text("Anna Medlem") a').click();
  await owner.waitForURL(/\/fakturor\/\d+/);
  t = await text(owner);
  assert(t.includes('Medlemsavgift') && t.includes('300,00'), 'fakturan: ' + t.slice(0, 1500));
  // Betalning registreras som vanligt (Swish/autogiro/bankgiro matchar OCR-numret)
  await owner.click('button:has-text("Registrera inbetalning")');
  await owner.locator('text=Inbetalningen är bokförd').waitFor();
  await owner.goto(B + '/forening');
  assert((await owner.locator('tr.fee:has-text("Anna Medlem") .fee-status').innerText()) === 'Betald', 'betald');
  await owner.goto(B + '/rapporter/huvudbok?account=3890');
  t = await text(owner);
  assert(t.includes('3890') && t.includes('400,00'), 'huvudbok 3890: ' + t.slice(0, 1500));
  log('betald avgift syns i medlemsregistret och intäkten är bokförd på 3890 Medlemsavgifter');

  await owner.goto(B + '/forening');
  await owner.selectOption('select[name=kind]', 'grant');
  await owner.fill('input[name=donor]', 'Kommunen');
  await owner.fill('form:has(input[name=donor]) input[name=amount]', '5000');
  await owner.fill('form:has(input[name=donor]) input[name=purpose]', 'Ungdomsverksamhet');
  await owner.check('input[name=restricted]');
  await owner.fill('form:has(input[name=donor]) input[name=date]', day(0));
  await owner.click('button:has-text("Bokför")');
  await owner.locator('text=Bidraget är bokfört').waitFor();
  t = await text(owner);
  assert(/Bidrag Kommunen Ungdomsverksamhet.*ändamålsbestämt.*5[\s ]000,00/.test(t) && t.includes('varav ändamålsbestämt 5 000,00'), 'bidrag: ' + t.slice(0, 2500));
  await owner.locator('tr.gift a:has-text("Verifikation")').click();
  await owner.waitForURL(/\/verifikationer\/\d+/);
  t = await text(owner);
  assert(t.includes('1930') && t.includes('3980') && t.includes('5 000,00'), 'verifikation bidrag: ' + t.slice(0, 1500));
  log('bidrag och gåvor bokförs mot 3980/3985 och ändamålsbestämda medel visas separat');

  await owner.goto(B + '/forening');
  await owner.fill('form:has(button:has-text("Spara årsmötet")) input[name=date]', `${YEAR + 1}-03-15`);
  await owner.fill('form:has(button:has-text("Spara årsmötet")) input[name=place]', 'Klubbhuset');
  await owner.click('button:has-text("Spara årsmötet")');
  await owner.locator('text=Årsmötet är sparat').waitFor();
  assert((await owner.locator('.notice-deadline').innerText()) === `${YEAR + 1}-03-01`, 'sista kallelsedag');
  await owner.click('button:has-text("Skicka kallelse")');
  await owner.locator('text=Kallelsen är skickad till').waitFor();
  t = await text(owner);
  assert(/Kallelsen är skickad till \d av 2 medlemmar/.test(t) && (await owner.locator('.notice-sent').count()) === 1, 'kallelse: ' + t.slice(0, 1000));
  log('kallelse till årsmötet med dagordning skickas till aktiva medlemmar, med sista dag enligt stadgarna');

  await owner.fill('textarea[name=text]', 'Föreningen har haft träningar varje vecka.');
  await owner.fill('input[name=board_name_0]', 'Ordförande Olle');
  await owner.fill('input[name=board_email_0]', 'olle@example.com');
  await owner.click('form:has(textarea[name=text]) button:has-text("Skapa för underskrift")');
  await owner.waitForURL(/\/dokument\/\d+/);
  t = await text(owner);
  assert(t.includes('Verksamhetsberättelse') && t.includes('Ordförande Olle'), 'verksamhetsberättelse: ' + t.slice(0, 1500));
  await owner.goto(B + '/forening');
  await owner.fill('input[name=auditor_name_0]', 'Revisor Rut');
  await owner.click('form:has(input[name=auditor_name_0]) button:has-text("Skapa för underskrift")');
  await owner.waitForURL(/\/dokument\/\d+/);
  t = await text(owner);
  assert(t.includes('Revisionsberättelse') && t.includes('Revisor Rut'), 'revisionsberättelse: ' + t.slice(0, 1500));
  await owner.goto(B + '/forening');
  assert((await owner.locator('a:has-text("Visa verksamhetsberättelsen")').count()) === 1 && (await owner.locator('a:has-text("Visa revisionsberättelsen")').count()) === 1, 'länkar');
  log('verksamhetsberättelse med RR/BR och revisionsberättelse skapas som dokument för digital underskrift');

  await owner.click('button:has-text("Stäng av föreningsläget")');
  await owner.locator('text=Föreningsläget är av').waitFor();

  // ================= Del 2: fastighet och uthyrning =================
  await owner.goto(B + '/fastighet');
  await owner.fill('form:has(button:has-text("Lägg upp fastighet")) input[name=name]', 'Kv. Eken 1');
  await owner.fill('input[name=designation]', 'Staden Eken 1:1');
  await owner.click('button:has-text("Lägg upp fastighet")');
  await owner.locator('text=Fastigheten är upplagd').waitFor();
  const addP = async (name, kind, area, vat) => {
    await owner.goto(B + '/fastighet');
    const f = owner.locator('form:has(button:has-text("Lägg till lokal"))');
    await f.locator('input[name=name]').fill(name); await f.locator('select[name=kind]').selectOption(kind); await f.locator('input[name=area]').fill(area);
    if (vat) { await f.locator('input[name=vat_liable]').check(); await f.locator('input[name=vat_from]').fill(`${YEAR}-01-01`); }
    await f.locator('button').click();
    await owner.locator('text=Lokalen är upplagd').waitFor();
  };
  await addP('Lokal A', 'lokal', '300', true);
  await addP('Lägenhet 1', 'bostad', '100', false);
  for (const [y, v] of [['2024', '400'], [String(YEAR - 1), '420']]) {
    await owner.goto(B + '/fastighet');
    await owner.fill('form:has(input[name=value]) input[name=year]', y); await owner.fill('input[name=value]', v);
    await owner.click('form:has(input[name=value]) button:has-text("Spara")');
    await owner.locator('text=Indexet är sparat').waitFor();
  }
  const addL = async (premiseLabel, rent, billing, idxYear, dep) => {
    await owner.goto(B + '/fastighet');
    await owner.selectOption('select[name=premise_id]', { label: premiseLabel });
    await owner.selectOption('select[name=customer_id]', { index: 0 });
    await owner.fill('form:has(input[name=base_rent]) input[name=start_date]', `${YEAR}-01-01`);
    await owner.fill('input[name=base_rent]', rent); await owner.selectOption('select[name=billing]', billing);
    if (idxYear) await owner.fill('input[name=index_year]', idxYear);
    if (dep) await owner.fill('input[name=deposit]', dep);
    await owner.click('button:has-text("Lägg upp avtalet")');
    await owner.locator('text=Hyresavtalet är upplagt').waitFor();
  };
  await addL('Kv. Eken 1: Lokal A', '120000', 'quarter', '2024', '30000');
  await addL('Kv. Eken 1: Lägenhet 1', '96000', 'month', '', '');
  await owner.goto(B + '/fastighet');
  await addL('Kv. Eken 1: Lokal A', '1000', 'month', '', '').catch(() => {});
  t = await text(owner);
  assert(t.includes('Lokalen är redan uthyrd'), 'dubbel uthyrning ska stoppas: ' + t.slice(0, 500));
  await owner.goto(B + '/fastighet');
  t = await text(owner);
  assert((await owner.locator('tr.lease:has-text("Lokal A") .lease-rent').innerText()).replace(/[\s ]/g, '').startsWith('126000,00') && (await owner.locator('.deductible').innerText()).replace(/[\s ]/g, '') === '75%', 'indexhyra/avdragsrätt: ' + t.slice(0, 2000));
  log('fastighet med lokaler, frivillig skattskyldighet per lokal, indexuppräknad hyra och avdragsrätt efter momspliktig yta');

  await owner.fill('input[name=month]', `${YEAR}-10`);
  await owner.click('button:has-text("Skapa hyresavier")');
  await owner.locator('text=2 hyresavier är skapade och bokförda').waitFor();
  t = await text(owner);
  assert(new RegExp(`${YEAR}-Q4 .* 31[\\s ]500,00 39[\\s ]375,00`).test(t) && new RegExp(`${YEAR}-10 .* 8[\\s ]000,00 8[\\s ]000,00`).test(t), 'avier: ' + t.slice(-1500));
  await owner.fill('input[name=month]', `${YEAR}-10`);
  await owner.click('button:has-text("Skapa hyresavier")');
  await owner.locator('.flash.error, .flash:has-text("inga hyror att avisera")').first().waitFor();
  await owner.fill('input[name=month]', `${YEAR}-11`);
  await owner.click('button:has-text("Skapa hyresavier")');
  await owner.locator('text=1 hyresavier är skapade och bokförda').waitFor();
  log('hyresavier per kvartal och månad med OCR: lokalen med moms 25 % på 3913, bostaden momsfri på 3911 – kvartalsavtal bara i kvartalets första månad');

  await owner.click('tr.lease:has-text("Lokal A") button:has-text("Mottagen")');
  await owner.locator('text=Depositionen är bokförd som skuld').waitFor();
  assert((await owner.locator('.deposit-held').innerText()).replace(/[\s ]/g, '').startsWith('30000,00'), 'innestående');
  await owner.fill('input[name=retained]', '5000');
  await owner.click('button:has-text("Återbetala")');
  await owner.locator('text=Återbetalningen av depositionen är bokförd').waitFor();
  await owner.goto(B + '/rapporter/huvudbok?account=2891');
  t = await text(owner);
  assert(t.includes('Deposition') && t.includes('Återbetald deposition') && t.includes('30 000,00'), 'huvudbok 2891: ' + t.slice(0, 1500));
  log('deposition bokförs som skuld på 2891 och återbetalas med kvarhållen del som intäkt');

  await owner.goto(B + '/fastighet');
  await owner.locator('summary:has-text("Komponentavskrivning")').click();
  await owner.fill('form:has(button:has-text("Lägg upp komponenterna")) input[name=cost]', '10000000');
  await owner.fill('form:has(button:has-text("Lägg upp komponenterna")) input[name=land]', '2000000');
  await owner.click('button:has-text("Lägg upp komponenterna")');
  await owner.locator('text=5 komponenter är upplagda i anläggningsregistret – avskrivning 147 200 kr per år').waitFor();
  t = await text(owner);
  assert(/Stomme och grund 4[\s ]000[\s ]000,00 100 40[\s ]000,00/.test(t), 'komponenter: ' + t.slice(0, 3000));
  await owner.goto(B + '/anlaggningar');
  t = await text(owner);
  assert(t.includes('Kv. Eken 1: Tak') && t.includes('Kv. Eken 1: Installationer'), 'anläggningsregistret: ' + t.slice(0, 1500));
  log('byggnaden delas upp i komponenter med egen nyttjandeperiod i anläggningsregistret, marken skrivs inte av');

  // ================= Del 3: K3 och kassaflödesanalys =================
  await owner.goto(B + '/bokslut');
  await owner.locator(`tr:has-text("${YEAR}-01-01") a:has-text("Öppna")`).click();
  await owner.waitForURL(/\/bokslut\/\d+$/);
  const FY = owner.url().replace(/.*\/bokslut\//, '');
  await owner.goto(`${B}/bokslut/${FY}/kassaflode`);
  t = await text(owner);
  assert(t.includes('Den löpande verksamheten') && t.includes('Investeringsverksamheten') && t.includes('Finansieringsverksamheten') && (await owner.locator('.cf-check').innerText()) === 'Stämmer', 'kassaflöde: ' + t.slice(0, 2500));
  assert((await owner.locator('table.cashflow thead th').count()) === 14, 'tolv månader + året');
  log('kassaflödesanalys enligt indirekt metod per månad och för året – stäms av mot likvida medel');

  await owner.goto(`${B}/bokslut/${FY}/k3`);
  t = await text(owner);
  assert((await owner.locator('.framework').innerText()) === 'K2' && t.includes('Jämförelsetalen räknas om') && t.includes('Komponentavskrivning') && t.includes('Uppskjuten skatt'), 'förklaring: ' + t.slice(0, 2000));
  await owner.click('button:has-text("Byt till K3")');
  await owner.locator('.flash.error, .flash:has-text("Bekräfta")').first().waitFor();
  await owner.check('input[name=confirm]');
  await owner.click('button:has-text("Byt till K3")');
  await owner.locator('text=Bolaget tillämpar nu K3').waitFor();
  log('byte K2 → K3 med förklaring av vad som ändras för just det här bolaget och krav på bekräftelse');

  for (const [l, a] of [['Byggnad: bokfört över skattemässigt värde', '100000'], ['Underskottsavdrag', '-50000']]) {
    await owner.goto(`${B}/bokslut/${FY}/k3`);
    await owner.fill('input[name=label]', l); await owner.fill('form:has(input[name=label]) input[name=amount]', a);
    await owner.click('form:has(input[name=label]) button:has-text("Lägg till")');
    await owner.locator('text=Den temporära skillnaden är sparad').waitFor();
  }
  await owner.goto(`${B}/bokslut/${FY}/k3`);
  const nb = (s) => s.replace(/[\s\u00a0\u202f]/g, '');
  assert(nb(await owner.locator('.dt-liability').innerText()) === '20600,00' && nb(await owner.locator('.dt-asset').innerText()) === '10300,00', 'uppskjuten skatt');
  await owner.click('button:has-text("Bokför uppskjuten skatt")');
  await owner.locator('text=Den uppskjutna skatten är bokförd').waitFor();
  assert((await owner.locator('button:has-text("Bokför uppskjuten skatt")').count()) === 0, 'redan bokförd');
  await owner.goto(B + '/rapporter/huvudbok?account=8940');
  t = await text(owner);
  assert(t.includes('Uppskjuten skatt') && t.includes('10 300,00'), 'huvudbok 8940: ' + t.slice(0, 1200));
  log('uppskjuten skatt på temporära skillnader bokförs mot 2240/1370/8940 – bara förändringen');

  await owner.goto(`${B}/bokslut/${FY}/arsredovisning`);
  t = await text(owner);
  assert(t.includes('BFNAR 2012:1') && t.includes('Kassaflödesanalys') && t.includes('Kassaflöde från den löpande verksamheten') && t.includes('Uppskjuten skatt') && t.includes('Kv. Eken 1: Tak') && t.includes('Viktiga uppskattningar och bedömningar'), 'K3-årsredovisning: ' + t.slice(0, 3000));
  assert((await owner.locator('a:has-text("Ladda ner iXBRL")').count()) === 0, 'iXBRL dold för K3');
  log('årsredovisning enligt K3 med kassaflödesanalys, komponenter, uppskjuten skatt och utökade noter');

  await owner.goto(`${B}/bokslut/${FY}/k3`);
  await owner.click('button:has-text("Byt tillbaka till K2")');
  await owner.locator('text=Bolaget tillämpar nu K2').waitFor();

  // ================= Del 4: import och tull =================
  const M = `${B}/m/lager`;
  await owner.goto(M + '/artiklar');
  await owner.fill('input[name=sku]', 'T-100'); await owner.fill('input[name=name]', 'Importsko');
  await owner.fill('input[name=purchase_price]', '300'); await owner.fill('input[name=sales_price]', '799');
  await owner.selectOption('select[name=supplier_id]', { index: 1 });
  await owner.fill('input[name=opening_qty]', '0');
  await owner.click('button:has-text("Lägg upp artikel")');
  await owner.locator('text=Artikeln är upplagd').waitFor();
  await owner.goto(M + '/inkop');
  await owner.selectOption('select[name=product_0]', await owner.locator('select[name=product_0] option:has-text("T-100 ")').first().getAttribute('value'));
  await owner.fill('input[name=qty_0]', '100'); await owner.fill('input[name=price_0]', '300');
  await owner.click('button:has-text("Skapa inköpsorder")');
  await owner.locator('text=Inköpsordern är skapad').waitFor();
  await owner.click('button:has-text("Markera som skickad")');
  await owner.locator('text=markerad som skickad').waitFor();
  await owner.click('button:has-text("Registrera inleverans")');
  await owner.locator('text=Inleveransen är registrerad').waitFor();

  await owner.goto(B + '/tull');
  await owner.fill('input[name=decision_no]', 'TV-2026-0001');
  await owner.fill('form:has(input[name=decision_no]) input[name=date]', day(0));
  await owner.fill('input[name=description]', 'Skor från Kina');
  await owner.fill('input[name=customs_value]', '30000'); await owner.fill('input[name=duty]', '3600'); await owner.fill('input[name=freight_sweden]', '1400');
  await owner.fill('input[name=vat_stated]', '8750'); await owner.fill('input[name=freight_alloc]', '1400');
  const poOpt = await owner.locator('form:has(input[name=decision_no]) select[name=po_id] option').nth(1).getAttribute('value');
  await owner.selectOption('form:has(input[name=decision_no]) select[name=po_id]', poOpt);
  await owner.click('button:has-text("Bokför beslutet")');
  await owner.locator('text=Beslutet är bokfört: underlag 35 000,00 kr i ruta 50 och importmoms 8 750,00 kr').waitFor();
  t = await text(owner);
  assert(!t.includes('avviker från beslutet') && /TV-2026-0001 Skor från Kina.* 30[\s ]000,00 3[\s ]600,00 35[\s ]000,00 8[\s ]750,00/.test(t), 'beslut: ' + t.slice(0, 2500));
  await owner.locator('tr.decision a:has-text("TV-2026-0001")').click();
  await owner.waitForURL(/\/verifikationer\/\d+/);
  t = await text(owner);
  assert(['4545', '4549', '2615', '2645', '5720', '2895'].every((a) => t.includes(a)), 'verifikation: ' + t.slice(0, 1500));
  await owner.goto(`${B}/rapporter/moms?from=${day(0).slice(0, 7)}-01&to=${day(0)}`);
  t = await text(owner);
  assert(/50 Beskattningsunderlag vid import 35[\s\u00a0]000 /.test(t) && /60 Utgående moms 25 % på import i ruta 50 8[\s\u00a0]750 /.test(t), 'momsrapport: ' + t.slice(0, 2500));
  log('Tullverkets beslut bokförs: underlag i ruta 50, importmoms i ruta 60 och avdrag i ruta 48, tull som skuld till Tullverket');

  await owner.goto(B + '/tull');
  await owner.click('tr.decision:has-text("TV-2026-0001") button:has-text("Fördela på varorna")');
  await owner.locator('text=5 000,00 kr i tull och frakt är fördelat på 1 artiklar, varav 5 000,00 kr till lagervärdet').waitFor();
  t = await text(owner);
  assert(/T-100 Importsko 100 5[\s ]000,00 300,00 350,00/.test(t), 'landed cost: ' + t.slice(-2000));
  assert((await owner.locator('tr.decision:has-text("TV-2026-0001") button:has-text("Fördela på varorna")').count()) === 0 && (await owner.locator('tr.decision .allocated').count()) === 1, 'fördelas bara en gång');
  log('tull och frakt fördelas på inköpsorderns varor – snittpriset och lagervärdet blir landed cost');

  await owner.fill('form:has(button:has-text("Spara besked")) input[name=month]', day(0).slice(0, 7));
  await owner.fill('form:has(button:has-text("Spara besked")) input[name=amount]', '3500');
  await owner.click('button:has-text("Spara besked")');
  await owner.locator('text=Tullverkets besked är sparat').waitFor();
  assert((await owner.locator(`tr.rec-row:has-text("${day(0).slice(0, 7)}") .rec-status`).innerText()).startsWith('Avviker'), 'avvikelse');
  await owner.goto(B + '/tull');
  await owner.fill('form:has(button:has-text("Spara besked")) input[name=month]', day(0).slice(0, 7));
  await owner.fill('form:has(button:has-text("Spara besked")) input[name=amount]', '3600');
  await owner.click('button:has-text("Spara besked")');
  await owner.locator('text=Tullverkets besked är sparat').waitFor();
  await owner.goto(B + '/tull');
  assert((await owner.locator(`tr.rec-row:has-text("${day(0).slice(0, 7)}") .rec-status`).innerText()) === 'Stämmer', 'stämmer');
  log('avstämning per månad mot Tullverkets besked och mot ruta 50/60 i bokföringen');

  // ================= Del 5: företagsinloggning och åtkomstskydd =================
  const S = B + '/installningar/inloggning';
  const saveSso = async (page, enforce) => {
    await page.goto(S);
    await page.selectOption('select[name=provider]', 'oidc');
    await page.fill('input[name=issuer]', IDP); await page.fill('input[name=client_id]', 'bok-sso');
    if (await page.locator('.sso-status').count() === 0) await page.fill('input[name=client_secret]', 'sso-secret');
    await page.fill('input[name=domains]', 'example.com');
    if (enforce) await page.check('input[name=enforce]'); else await page.uncheck('input[name=enforce]');
    await page.click('button:has-text("Koppla företagsinloggning"), form:has(input[name=client_id]) button:has-text("Spara")');
  };
  await saveSso(owner, false);
  await owner.locator('text=Företagsinloggningen är sparad och leverantören svarar').waitFor();
  assert((await owner.locator('.redirect-uri').innerText()).endsWith('/api/sso/callback'), 'omdirigeringsadress');
  await saveSso(owner, true);
  await owner.locator('.flash.error, .flash:has-text("Logga in med SSO en gång")').first().waitFor();
  await owner.goto(S);
  await owner.click('button:has-text("Kräv tvåstegsverifiering")');
  await owner.locator('.flash.error, .flash:has-text("Logga in med tvåstegsverifiering")').first().waitFor();
  log('SSO kopplas med leverantörens konfiguration – SSO- och tvåstegskrav går inte att slå på så att ägaren stänger ute sig själv');

  const sso = await (await browser.newContext()).newPage();
  sso.setDefaultTimeout(20000);
  await sso.goto(BASE + '/login');
  await sso.click('summary:has-text("Logga in med SSO")');
  await sso.fill('details.sso input[name=email]', 'agare@example.com');
  await sso.click('button:has-text("Fortsätt till företagets inloggning")');
  await sso.waitForURL(BASE + '/c/1');
  await sso.goto(BASE + '/login');
  await sso.click('summary:has-text("Logga in med SSO")');
  await sso.fill('details.sso input[name=email]', 'okand@example.com');
  await sso.click('button:has-text("Fortsätt till företagets inloggning")');
  await sso.locator('text=Det finns ingen företagsinloggning för e-postadressen').waitFor();
  log('inloggning via bolagets identitetsleverantör (OIDC med PKCE) – bara befintliga användare i bolaget');

  await sso.goto(S);
  await sso.click('button:has-text("Kräv tvåstegsverifiering")');
  await sso.locator('text=Alla måste nu använda tvåstegsverifiering i bolaget').waitFor();
  await owner.goto(B);
  await owner.waitForURL(/\/konto/);
  assert((await text(owner)).includes('Bolaget kräver tvåstegsverifiering'), 'tvåstegskrav');
  log('krav på tvåstegsverifiering per bolag: inloggning med bara lösenord skickas till kontot för att slå på den');

  await saveSso(sso, true);
  await sso.locator('text=Företagsinloggningen är sparad').waitFor();
  const kons = await (await browser.newContext()).newPage();
  kons.setDefaultTimeout(20000);
  await kons.goto(BASE + '/login');
  await kons.fill('form:has(input[name=password]) input[name=email]', 'konsult@example.com'); await kons.fill('input[name=password]', 'fel-lösenord');
  await kons.click('form button:has-text("Logga in")');
  await kons.locator('text=Fel e-post eller lösenord').waitFor();
  await kons.fill('form:has(input[name=password]) input[name=email]', 'konsult@example.com'); await kons.fill('input[name=password]', 'konsultlosen1');
  await kons.click('form button:has-text("Logga in")');
  await kons.waitForURL(BASE + '/');
  await kons.goto(B);
  await kons.waitForURL(/\/\?error=/);
  assert((await text(kons)).includes('Bolaget kräver att du loggar in med företagets inloggning (SSO)'), 'SSO-krav: ' + (await text(kons)).slice(0, 500));
  log('krav på SSO för bolagets domäner – lösenordsinloggning släpps inte in i bolaget');

  await sso.goto(S);
  t = await text(sso);
  assert(t.includes('Aktiva sessioner') && /konsult@example\.com/.test(t) && /Misslyckad \(Fel lösenord\)/.test(t) && /Agare|Ägare/.test(t), 'sessioner/logg: ' + t.slice(-3000));
  assert((await sso.locator('tr.session:has-text("SSO") .muted:has-text("Den här")').count()) === 1, 'egen session');
  await sso.locator('tr.session:has-text("konsult@example.com") button:has-text("Logga ut")').first().click();
  await sso.locator('text=Sessionen är utloggad från bolaget').waitFor();
  await kons.goto(B);
  await kons.waitForURL(/\/\?error=/);
  assert((await text(kons)).includes('Du har loggats ut från bolaget'), 'utloggad');
  log('aktiva sessioner per bolag med fjärrutloggning och inloggningslogg med misslyckade försök');

  await sso.setExtraHTTPHeaders({ 'x-real-ip': '203.0.113.10' });
  await sso.goto(S);
  await sso.fill('textarea[name=ip_allowlist]', '198.51.100.0/24');
  await sso.click('button:has-text("Spara IP-begränsning")');
  await sso.locator('text=Din nuvarande adress (203.0.113.10) finns inte med').waitFor();
  await sso.fill('textarea[name=ip_allowlist]', '203.0.113.0/24\n198.51.100.0/24');
  await sso.click('button:has-text("Spara IP-begränsning")');
  await sso.locator('text=IP-begränsningen är sparad').waitFor();
  await sso.setExtraHTTPHeaders({ 'x-real-ip': '192.0.2.50' });
  await sso.goto(B);
  await sso.waitForURL(/\/\?error=/);
  assert((await text(sso)).includes('Bolaget tillåter bara inloggning från vissa nätverk'), 'IP-spärr');
  await sso.setExtraHTTPHeaders({ 'x-real-ip': '198.51.100.7' });
  await sso.goto(S);
  await sso.fill('textarea[name=ip_allowlist]', '');
  await sso.click('button:has-text("Spara IP-begränsning")');
  await sso.locator('text=IP-begränsningen är sparad').waitFor();
  log('IP-begränsning per bolag med skydd mot att stänga ute sig själv');

  await sso.goto(BASE + '/konto');
  await sso.waitForURL(/\/login/);
  await sso.goto(BASE + '/');
  assert((await text(sso)).includes('Den inloggningen gäller bara det bolaget'), 'SSO-sessionens startsida');
  log('en SSO-session gäller bara bolaget som företagsinloggningen gjordes för – inte kontot eller andra bolag');

  await sso.goto(S);
  await sso.click('button:has-text("Sluta kräva")');
  await sso.locator('text=Tvåstegsverifiering krävs inte längre').waitFor();
  await sso.click('button:has-text("Ta bort företagsinloggningen")');
  await sso.locator('text=Företagsinloggningen är borttagen').waitFor();

  await owner.goto(BASE + '/konto/sessioner');
  const before = await owner.locator('tr.my-session').count();
  assert(before >= 2 && (await owner.locator('tr.my-session:has-text("Den här enheten")').count()) === 1, 'mina sessioner');
  await owner.locator('tr.my-session button:has-text("Logga ut")').first().click();
  await owner.locator('text=Sessionen är utloggad').waitFor();
  assert((await owner.locator('tr.my-session').count()) === before - 1, 'en session mindre');
  log('mina sessioner: se var kontot är inloggat och logga ut andra enheter');

  //@@NEXT@@
  await browser.close(); mailServer.close(); idpServer.close();
  console.log('Omgång 13: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
