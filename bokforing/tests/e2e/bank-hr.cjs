// End-to-end: bankkoppling (mot en fejkad Enable Banking-server), bankavstämning, filimport,
// e-signering och HR-modulen. Körs efter flow.cjs, api.cjs och passkey.cjs mot samma databas.
// Servern startas med ENABLEBANKING_API_URL=http://localhost:3301, ENABLEBANKING_APP_ID=test-app och
// ENABLEBANKING_PRIVATE_KEY = base64(PEM) för nyckeln vars publika del ges i EB_PUBLIC_KEY (base64 PEM).
const { chromium } = require('playwright');
const http = require('http');
const crypto = require('crypto');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PUBLIC_KEY = crypto.createPublicKey(Buffer.from(process.env.EB_PUBLIC_KEY, 'base64').toString());
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const waitMsg = (page, text) => page.waitForURL((u) => decodeURIComponent(u.toString()).includes(text), { timeout: 20000 });

// ---------- Fejkad Enable Banking ----------
const mock = { transactions: [], jwtErrors: 0, calls: [], deleted: false };
function checkJwt(req) {
  const [h, p, s] = (req.headers.authorization ?? '').replace('Bearer ', '').split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  const ok = header.alg === 'RS256' && header.kid === 'test-app' && payload.aud === 'api.enablebanking.com' && payload.iss === 'enablebanking.com'
    && payload.exp - payload.iat <= 86400 && crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), PUBLIC_KEY, Buffer.from(s, 'base64url'));
  if (!ok) mock.jwtErrors++;
  return ok;
}
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://localhost:3301');
    const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url.pathname === '/auth-page') { // bankens inloggningssida (BankID) – skickar direkt tillbaka med code
      res.writeHead(302, { Location: `${url.searchParams.get('redirect')}?code=CODE123&state=${url.searchParams.get('state')}` });
      return res.end();
    }
    if (!checkJwt(req)) return json(401, { message: 'Bad JWT', code: 401, error: 'UNAUTHORIZED' });
    mock.calls.push(`${req.method} ${url.pathname}`);
    if (url.pathname === '/aspsps') return json(200, { aspsps: [{ name: 'Testbanken', country: 'SE', psu_types: ['business', 'personal'], maximum_consent_validity: 7776000 }] });
    if (url.pathname === '/auth' && req.method === 'POST') {
      const b = JSON.parse(body);
      if (!b.state || !b.redirect_url || b.aspsp.name !== 'Testbanken' || !b.access.valid_until) return json(422, { message: 'bad auth body' });
      return json(200, { url: `http://localhost:3301/auth-page?state=${b.state}&redirect=${encodeURIComponent(b.redirect_url)}`, authorization_id: 'auth-1' });
    }
    if (url.pathname === '/sessions' && req.method === 'POST') {
      if (JSON.parse(body).code !== 'CODE123') return json(400, { message: 'wrong code', error: 'WRONG_AUTHORIZATION_CODE' });
      return json(200, { session_id: 'sess-1', accounts: [{ uid: 'acc-1', account_id: { iban: 'SE4550000000058398257466' }, name: 'Företagskonto', currency: 'SEK', cash_account_type: 'CACC' }],
        access: { valid_until: new Date(Date.now() + 90 * 86400e3).toISOString() }, aspsp: { name: 'Testbanken', country: 'SE' }, psu_type: 'business' });
    }
    if (url.pathname === '/accounts/acc-1/transactions') {
      // två sidor via continuation_key
      const half = Math.ceil(mock.transactions.length / 2);
      if (url.searchParams.get('continuation_key') === 'p2') return json(200, { transactions: mock.transactions.slice(half), continuation_key: null });
      return json(200, { transactions: mock.transactions.slice(0, half), continuation_key: 'p2' });
    }
    if (url.pathname === '/accounts/acc-1/balances') return json(200, { balances: [{ name: 'Bokfört', balance_type: 'CLBD', balance_amount: { amount: '50000.00', currency: 'SEK' }, reference_date: '2026-06-30' }] });
    if (url.pathname === '/sessions/sess-1' && req.method === 'DELETE') { mock.deleted = true; return json(200, { message: 'OK' }); }
    json(404, { message: 'not found' });
  });
}).listen(3301);

function luhn(d) { let s = 0; for (let i = 0; i < d.length; i++) { let x = +d[d.length - 1 - i]; if (i % 2 === 0) { x *= 2; if (x > 9) x -= 9; } s += x; } return (10 - (s % 10)) % 10; }
const pnr = (base9) => `19${base9.slice(0, 6)}-${base9.slice(6)}${luhn(base9)}`;

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(20000);
  await page.goto(BASE + '/login');
  await page.fill('input[name=email]', 'agare@example.com');
  await page.fill('input[name=password]', 'hemligtlosen1');
  await page.click('form button:has-text("Logga in")');
  await page.waitForURL(BASE + '/');
  const B = `${BASE}/c/1`;

  // ---- Underlag för avstämning: en kundfaktura och en ej attesterad leverantörsfaktura ----
  await page.goto(B + '/kunder');
  await page.fill('input[name=name]', 'Bankkund AB');
  await page.click('button:has-text("Spara kund")');
  await waitMsg(page, 'Kunden är sparad');
  await page.goto(B + '/fakturor/ny');
  await page.selectOption('select[name=customer_id]', { label: 'Bankkund AB' });
  await page.fill('input[name=invoice_date]', '2026-06-01');
  const r = page.locator('tbody tr').first();
  await r.locator('td:nth-child(1) input').fill('Rådgivning');
  await r.locator('td:nth-child(4) input').fill('5000');
  await page.click('button:has-text("Spara utkast")');
  await waitMsg(page, 'Utkastet är sparat');
  await page.click('button:has-text("Bokför faktura")');
  await waitMsg(page, 'klar att skicka');
  const invoiceUrl = page.url().split('?')[0];
  const ocr = (await page.locator('td.mono').first().textContent()).trim();
  await page.goto(B + '/leverantorsfakturor/ny');
  await page.selectOption('select[name=supplier_id]', { label: 'Hyresvärden AB' });
  await page.fill('input[name=invoice_number]', 'H-2026-06');
  await page.fill('input[name=invoice_date]', '2026-06-01');
  await page.fill('input[name=due_date]', '2026-06-30');
  await page.fill('input[name=payment_reference]', '87654321');
  await page.fill('input[name=total]', '8000');
  await page.click('button:has-text("25 % moms")');
  await page.click('button:has-text("Registrera och bokför")');
  await waitMsg(page, 'registrerad och bokförd');
  const supplierUrl = page.url().split('?')[0];
  log('faktura', ocr, 'och leverantörsfaktura (ej attesterad) skapade');

  mock.transactions = [
    { entry_reference: 'T1', transaction_amount: { amount: '6250.00', currency: 'SEK' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-06-20', debtor: { name: 'Bankkund AB' }, remittance_information: [`OCR ${ocr}`] },
    { entry_reference: 'T2', transaction_amount: { amount: '8000.00', currency: 'SEK' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-06-29', creditor: { name: 'Hyresvärden AB' }, reference_number: '87654321' },
    { entry_reference: 'T3', transaction_amount: { amount: '125.00', currency: 'SEK' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-06-30', creditor: { name: 'Testbanken' }, remittance_information: ['Bankavgift juni'] },
    { entry_reference: 'T4', transaction_amount: { amount: '500.00', currency: 'SEK' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-06-30', remittance_information: ['Överföring från sparkonto'] },
    { entry_reference: 'T5', transaction_amount: { amount: '99.00', currency: 'SEK' }, credit_debit_indicator: 'DBIT', status: 'PDNG', booking_date: '2026-07-01' },
  ];

  // ---- Koppla bank (Open Banking) ----
  await page.goto(B + '/bank');
  await page.selectOption('select[name=aspsp]', 'Testbanken');
  await page.click('button:has-text("Koppla med BankID")');
  await waitMsg(page, 'Banken är kopplad');
  assert(mock.jwtErrors === 0, `ogiltiga JWT: ${mock.jwtErrors}`);
  assert(mock.calls.includes('POST /sessions') && mock.calls.includes('GET /accounts/acc-1/balances'), 'anrop: ' + mock.calls);
  const bankText = await page.locator('main').textContent();
  assert(bankText.includes('Företagskonto') && bankText.includes('50 000,00') && bankText.includes('Kopplad'), 'konto och saldo visas');
  log('bank kopplad via fejkad Enable Banking (JWT verifierad, 2 sidor transaktioner, saldo 50 000)');

  // ---- Avstämning ----
  await page.goto(B + '/bank/avstamning');
  assert((await page.locator('.card:has-text("100 %")').count()) === 2, 'två säkra förslag');
  await page.click('button:has-text("Stäm av säkra matchningar automatiskt")');
  await waitMsg(page, '2 transaktioner stämdes av automatiskt');
  await page.goto(invoiceUrl);
  assert(await page.locator('h1:has-text("Betald")').count(), 'kundfakturan är betald');
  await page.goto(supplierUrl);
  assert(await page.locator('text=Attesterad').count() && await page.locator('h1:has-text("Betald")').count(), 'leverantörsfakturan attesterad och betald');
  log('automatisk avstämning: kundfaktura (OCR) och leverantörsfaktura (OCR, auto-attest)');

  await page.goto(B + '/bank/avstamning');
  const fee = page.locator('.card:has-text("Bankavgift juni")');
  await fee.locator('summary:has-text("Bokför mot konto")').click();
  await fee.locator('input[name=account]').fill('6570');
  await fee.locator('button:text-is("Bokför")').click();
  await fee.waitFor({ state: 'detached' });
  const transfer = page.locator('.card:has-text("Överföring från sparkonto")');
  await transfer.locator('button:has-text("Ignorera")').click();
  await transfer.waitFor({ state: 'detached' });
  const left = await page.locator('.card:has(button:has-text("Ignorera"))').allTextContents();
  assert(left.length === 0, 'allt avstämt, kvar: ' + left.map((x) => x.slice(0, 150)).join(' | '));
  await page.goto(B + '/bank/avstamning?status=ignored');
  await page.click('button:has-text("Ångra")');
  await waitMsg(page, 'öppnad igen');
  assert(await page.locator('.card:has-text("Överföring från sparkonto")').count(), 'ignorerad kan öppnas igen');
  await page.locator('.card:has-text("Överföring från sparkonto") button:has-text("Ignorera")').click();
  await waitMsg(page, 'Transaktionen är avstämd');
  log('bokföring mot konto (6570), ignorera och ångra');

  // Ny hämtning ger inga dubbletter
  await page.goto(B + '/bank');
  await page.click('button:has-text("Hämta transaktioner")');
  await waitMsg(page, '0 nya transaktioner');
  log('ny synk utan dubbletter');

  // ---- Filimport (camt.053) ----
  await page.goto(B + '/bank');
  await page.fill('form:has(button:has-text("Lägg till")) input[name=name]', 'Sparkonto');
  await page.fill('form:has(button:has-text("Lägg till")) input[name=ledger_account]', '1940');
  await page.click('form:has(button:has-text("Lägg till")) button');
  await waitMsg(page, 'Bankkontot är tillagt');
  const camt = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Ntry><Amt Ccy="SEK">250.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-06-30</Dt></BookgDt><AcctSvcrRef>R-55</AcctSvcrRef><NtryDtls><TxDtls><RmtInf><Ustrd>Ränta</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>`;
  const row = page.locator('tr:has-text("Sparkonto")');
  await row.locator('input[type=file]').setInputFiles({ name: 'kontoutdrag.xml', mimeType: 'application/xml', buffer: Buffer.from(camt) });
  await row.locator('button:has-text("Importera")').click();
  await waitMsg(page, '1 transaktioner importerade');
  await page.goto(B + '/bank');
  await page.locator('tr:has-text("Sparkonto") input[type=file]').setInputFiles({ name: 'kontoutdrag.xml', mimeType: 'application/xml', buffer: Buffer.from(camt) });
  await page.locator('tr:has-text("Sparkonto") button:has-text("Importera")').click();
  await waitMsg(page, '1 fanns redan');
  log('camt.053-import och dubblettskydd');

  // Koppla bort
  await page.goto(B + '/bank');
  await page.click('button:has-text("Koppla bort")');
  await waitMsg(page, 'Banken är bortkopplad');
  assert(mock.deleted, 'sessionen ska tas bort hos leverantören');
  log('bank bortkopplad (session raderad hos leverantören)');

  // ---- HR: onboarding med e-signering ----
  await page.goto(B + '/moduler');
  await page.locator('.card:has(h2:text-is("HR")) button:has-text("Aktivera")').click();
  await waitMsg(page, 'Modulen är aktiverad');
  await page.goto(B + '/m/hr/ny/onboarding');
  const bertil = pnr('900101123');
  await page.fill('input[name=first_name]', 'Bertil');
  await page.fill('input[name=last_name]', 'Berg');
  await page.fill('input[name=personal_number]', bertil);
  await page.fill('input[name=email]', 'bertil@example.com');
  await page.fill('input[name=title]', 'Ekonomiassistent');
  await page.fill('input[name=department]', 'Ekonomi');
  await page.fill('input[name=employment_start]', '2026-12-01');
  await page.selectOption('select[name=employment_type]', 'provanstallning');
  await page.fill('input[name=monthly_salary]', '38000');
  await page.click('button:has-text("Starta onboarding")');
  await waitMsg(page, 'Onboarding startad');
  const processUrl = page.url().split('?')[0];
  assert(await page.locator('text=Väntar på signering').count(), 'avtalet väntar på signering');
  log('onboarding startad, anställningsavtal skickat');

  await page.click('a:has-text("Väntar på signering")');
  await page.waitForURL(/\/dokument\/\d+$/);
  const docUrl = page.url();
  const docText = await page.locator('.document-body').textContent();
  assert(docText.includes('Anställningsavtal') && docText.includes('Ekonomiassistent') && docText.includes('38 000,00 kr') && docText.includes('Provanställning'), 'avtalets innehåll');
  const signLink = (await page.locator('code.mono').first().textContent()).trim();
  // Arbetsgivaren signerar (intern, lösenord)
  await page.check('text=Jag har läst dokumentet och godkänner innehållet');
  await page.fill('input[type=password]', 'hemligtlosen1');
  await page.click('button:text-is("Signera")');
  await page.locator('text=Signerat 20').first().waitFor();
  log('arbetsgivaren signerade (inloggad, lösenord)');

  // Den anställda signerar via länk (utan konto)
  const ext = await (await browser.newContext()).newPage();
  await ext.goto(signLink);
  assert(await ext.locator('h1:has-text("Anställningsavtal – Bertil Berg")').count(), 'signeringssida');
  await ext.check('input[name=consent]');
  await ext.fill('input[name=signed_name]', 'Bertil B');
  await ext.click('button:has-text("Signera dokumentet")');
  await ext.waitForURL(/error=/);
  await ext.locator('.flash.error:has-text("fullständiga namn")').waitFor();
  await ext.check('input[name=consent]');
  await ext.fill('input[name=signed_name]', 'bertil berg');
  await ext.click('button:has-text("Signera dokumentet")');
  await ext.locator('text=Du signerade dokumentet').waitFor();
  log('anställd signerade via länk (fel namn nekades först)');

  await page.goto(docUrl);
  assert(await page.locator('text=Giltig – oförändrat').count(), 'förseglingen giltig');
  await page.click('a:has-text("Signerat dokument")');
  await page.waitForURL(/utskrift/);
  assert(await page.locator('text=Verifieringsbilaga').count() && await page.locator('text=Personlig länk och namnbekräftelse').count(), 'verifieringsbilaga');
  log('dokumentet förseglat, verifieringsbilaga med metoder');

  await page.goto(processUrl);
  assert(await page.locator('tr:has-text("Anställningsavtal signerat") >> text=Automatiskt').count(), 'signeringsuppgiften bockades av automatiskt');
  await page.goto(B + '/m/hr');
  assert(await page.locator('tr:has-text("Bertil Berg") >> text=Ej aktiv i lön').count(), 'inaktiv i lön före slutförande');
  await page.goto(processUrl);
  // bocka av en uppgift manuellt, slutför resten med force
  await page.locator('tr:has-text("Beställ dator") button').click();
  await page.waitForLoadState('networkidle');
  assert(await page.locator('tr:has-text("Beställ dator") >> text=Ägare Testsson').count(), 'manuell uppgift avbockad');
  await page.check('input[name=force]');
  await page.click('button:has-text("Slutför onboarding")');
  await waitMsg(page, 'Processen är slutförd');
  await page.goto(B + '/lon/anstallda');
  assert(!(await page.locator('tr:has-text("Berg") >> text=Inaktiv').count()), 'aktiv i lön efter onboarding');
  log('onboarding slutförd – checklista, automatisk avbockning, aktiverad i lön');

  // ---- Förflyttning ----
  await page.goto(B + '/m/hr/ny/forflyttning');
  await page.selectOption('select[name=employee_id]', { label: 'Bertil Berg – Ekonomiassistent' });
  await page.fill('input[name=effective_date]', '2027-01-01');
  await page.fill('input[name=new_title]', 'Redovisningsekonom');
  await page.fill('input[name=new_monthly_salary]', '42000');
  await page.click('button:has-text("Starta förflyttning")');
  await waitMsg(page, 'Förflyttning startad');
  assert(await page.locator('td:has-text("42 000,00 kr")').count(), 'ändringstabell');
  await page.check('input[name=force]');
  await page.click('button:has-text("Slutför förflyttning")');
  await waitMsg(page, 'Processen är slutförd');
  await page.goto(B + '/lon/anstallda');
  assert(await page.locator('tr:has-text("Berg") >> text=42 000,00').count(), 'ny lön i lönen');
  await page.goto(B + '/m/hr');
  assert(await page.locator('tr:has-text("Bertil Berg") >> text=Redovisningsekonom').count(), 'ny befattning');
  log('förflyttning: ny befattning och lön överförda');

  // ---- Offboarding ----
  await page.goto(B + '/m/hr/ny/offboarding');
  await page.selectOption('select[name=employee_id]', { label: 'Bertil Berg' });
  await page.fill('input[name=last_day]', '2027-03-31');
  await page.selectOption('select[name=reason]', 'egen');
  await page.click('button:has-text("Starta offboarding")');
  await waitMsg(page, 'Offboarding startad');
  await page.check('input[name=force]');
  await page.click('button:has-text("Slutför offboarding")');
  await waitMsg(page, 'Processen är slutförd');
  await page.goto(B + '/m/hr');
  assert(await page.locator('tr:has-text("Bertil Berg") >> text=2026-12-01 – 2027-03-31').count(), 'sista anställningsdag');
  log('offboarding: sista anställningsdag överförd');

  // ---- API: dokument och HR ----
  await page.goto(B + '/integrationer');
  await page.fill('input[name=name]', 'HR-system');
  for (const s of ['documents:write', 'hr:read', 'bank:read']) await page.check(`input[name=scopes][value="${s}"]`);
  await page.click('button:has-text("Skapa API-nyckel")');
  const token = (await page.locator('.flash.ok code').textContent()).trim();
  const api = async (m, p, b) => { const res = await fetch(`${BASE}/api/v1${p}`, { method: m, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { status: res.status, json: await res.json() }; };
  const procs = await api('GET', '/m/hr/processes');
  assert(procs.status === 200 && procs.json.data.length === 3, 'HR-processer via API: ' + JSON.stringify(procs.json).slice(0, 200));
  const d = await api('POST', '/documents', { title: 'Sekretessavtal', html: '<p>Hemligt</p><script>x</script>', send: true, signers: [{ name: 'Extern Konsult', email: 'k@example.com' }] });
  assert(d.status === 201 && d.json.status === 'pending' && d.json.signers[0].signing_url.includes('/sign/'), 'dokument via API: ' + JSON.stringify(d.json).slice(0, 300));
  const bt = await api('GET', '/bank/transactions?status=matched');
  assert(bt.json.data.length === 3, 'avstämda transaktioner via API');
  log('API: HR-processer, dokument med signeringslänk, banktransaktioner');

  // Avböja via länk
  await ext.goto(d.json.signers[0].signing_url);
  assert(!(await ext.locator('script').filter({ hasText: 'x' }).count()), 'skript ska vara borttaget');
  await ext.click('summary:has-text("Avböj")');
  await ext.fill('input[name=reason]', 'Fel villkor');
  await ext.click('button:has-text("Avböj")');
  await ext.locator('text=Du har avböjt').waitFor();
  const after = await api('GET', `/documents/${d.json.id}`);
  assert(after.status === 200 && after.json.status === 'declined' && after.json.signers[0].decline_reason === 'Fel villkor', 'status avböjt via API');
  log('avböjd signering');

  await browser.close();
  server.close();
})().catch((e) => { console.error('FEL:', e.message); server.close(); process.exit(1); });
