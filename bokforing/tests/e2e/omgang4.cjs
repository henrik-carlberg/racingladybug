// End-to-end, omgång 4: behörighet per användare, attest i två steg, ändringshistorik och att revisorn inte kan ändra något
// ens när formuläret skickas utan JavaScript.
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const waitMsg = (page, text) => page.waitForURL((u) => decodeURIComponent(u.toString()).replace(/ /g, ' ').includes(text), { timeout: 20000 });
const text = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); const sel = (await page.locator('main').count()) ? 'main' : 'body'; return (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').replace(/ /g, ' '); };

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

  // ---- Revisor utan JavaScript ----
  await accept(browser, await invite(owner, B, 'revisor.omg4@example.com', 'auditor'), 'Ulla Granskare', 'granskarlosen1');
  const nojs = await login(browser, 'revisor.omg4@example.com', 'granskarlosen1', { javaScriptEnabled: false });
  await nojs.goto(B + '/kunder');
  await nojs.fill('input[name=name]', 'Kund utan JS');
  await nojs.click('button:has-text("Spara kund")');
  await nojs.waitForLoadState('load');
  assert(decodeURIComponent(nojs.url()).includes('Revisorn har läsbehörighet'), 'formulär utan JavaScript nekas: ' + nojs.url());
  await owner.goto(B + '/kunder');
  assert(!(await text(owner)).includes('Kund utan JS'), 'ingen kund skapad');
  log('revisorn nekas även när formuläret skickas utan JavaScript');

  // ---- Begränsad konsult ----
  const kons = await accept(browser, await invite(owner, B, 'konsult.omg4@example.com', 'accountant'), 'Kim Fakturerare', 'fakturalosen1');
  await owner.goto(B + '/installningar');
  const row = owner.locator('tr:has-text("Kim Fakturerare")');
  await row.locator('summary').click();
  for (const p of ['purchasing', 'attest', 'payments', 'payroll', 'ledger']) await row.locator(`input[value=${p}]`).uncheck();
  await row.locator('button:has-text("Spara behörigheter")').click();
  await waitMsg(owner, 'Behörigheterna är sparade');
  assert((await text(owner)).includes('Begränsad (1 av 6)'), 'begränsning visas');
  await kons.goto(B);
  const nav = await kons.locator('nav').innerText();
  assert(nav.includes('Kundfakturor') && !nav.includes('Lönekörningar') && !nav.includes('Verifikationer'), 'menyn visar bara det tillåtna: ' + nav);
  await kons.goto(B + '/lon');
  await kons.waitForURL((u) => !u.pathname.endsWith('/lon'));
  assert(decodeURIComponent(kons.url()).includes('Du saknar behörighet'), 'lönesidan nekas: ' + kons.url());
  await kons.goto(B + '/kunder');
  await kons.fill('input[name=name]', 'Konsultens kund');
  await kons.click('button:has-text("Spara kund")');
  await waitMsg(kons, 'Kunden är sparad');
  log('konsult med begränsad behörighet ser och gör bara kundfakturor');

  // ---- Attest i två steg ----
  await owner.goto(B + '/installningar');
  await owner.fill('input[name=attest_threshold]', '5000');
  await owner.check('input[name=attest_not_registrant]');
  await owner.click('form:has(input[name=attest_threshold]) button:has-text("Spara")');
  await waitMsg(owner, 'Attestreglerna är sparade');
  await owner.goto(B + '/leverantorsfakturor/ny');
  await owner.selectOption('select[name=supplier_id]', { label: 'Hyresvärden AB' });
  await owner.fill('input[name=invoice_number]', 'H-ATTEST-1');
  await owner.fill('input[name=invoice_date]', '2026-11-10');
  await owner.fill('input[name=due_date]', '2026-12-10');
  await owner.fill('input[name=total]', '12500');
  await owner.click('button:has-text("25 % moms")');
  await owner.click('button:has-text("Registrera och bokför")');
  await owner.waitForURL(/leverantorsfakturor\/\d+\?ok/);
  const siUrl = owner.url().split('?')[0];
  await owner.click('button:has-text("Attestera")');
  await waitMsg(owner, 'registrerat fakturan får inte attestera');
  const att = await accept(browser, await invite(owner, B, 'attest1.omg4@example.com', 'accountant'), 'Anna Attest', 'attestlosen11');
  const att2 = await accept(browser, await invite(owner, B, 'attest2.omg4@example.com', 'accountant'), 'Bo Attest', 'attestlosen22');
  await att.goto(siUrl);
  assert(await att.locator('button:has-text("Attestera (1 av 2)")').count(), 'två attester krävs');
  await att.click('button:has-text("Attestera")');
  await waitMsg(att, 'Första attesten är gjord');
  await att.click('button:has-text("Attestera")');
  await waitMsg(att, 'redan attesterat');
  await att2.goto(siUrl);
  await att2.click('button:has-text("Attestera (2 av 2)")');
  await waitMsg(att2, 'attesterad för betalning');
  let t = await text(att2);
  assert(t.includes('Historik') , 'historik finns');
  await att2.locator('details.history summary').click();
  t = await text(att2);
  assert(t.includes('Första attest') && t.includes('Anna Attest') && t.includes('Attesterad') && t.includes('Bo Attest'), 'historik med båda attesterna: ' + t.slice(-800));
  log('attest i två steg av olika personer, registreraren får inte attestera, historik');

  // ---- Ändringshistorik på kund ----
  await owner.goto(B + '/kunder');
  await owner.click('a:has-text("Konsultens kund")');
  await owner.waitForURL(/kunder\/\d+/);
  await owner.fill('input[name=city]', 'Umeå');
  await owner.click('button:text-is("Spara")');
  await waitMsg(owner, 'Kunden är sparad');
  await owner.goto(B + '/kunder');
  await owner.click('a:has-text("Konsultens kund")');
  await owner.locator('details.history summary').click();
  t = await text(owner);
  assert(t.includes('ort: – → Umeå') && t.includes('Kim Fakturerare'), 'kundhistorik: ' + t.slice(-600));
  log('ändringshistorik visar vem som ändrade vad');

  // ================= Del 2: automatisering =================
  // ---- Bankens avisering (camt.054) ----
  await owner.goto(B + '/leverantorsfakturor/ny');
  await owner.selectOption('select[name=supplier_id]', { label: 'Hyresvärden AB' });
  await owner.fill('input[name=invoice_number]', 'H-CAMT-1');
  await owner.fill('input[name=invoice_date]', '2026-11-12');
  await owner.fill('input[name=due_date]', '2026-11-30');
  await owner.fill('input[name=total]', '1250');
  await owner.click('button:has-text("25 % moms")');
  await owner.click('button:has-text("Registrera och bokför")');
  await owner.waitForURL(/leverantorsfakturor\/\d+\?ok/);
  const siId = owner.url().match(/leverantorsfakturor\/(\d+)/)[1];
  await att.goto(`${B}/leverantorsfakturor/${siId}`);
  await att.click('button:has-text("Attestera")');
  await waitMsg(att, 'attesterad för betalning');
  const camt = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn><Ntfctn><Ntry><Amt Ccy="SEK">1250.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-11-29</Dt></BookgDt><NtryDtls><TxDtls><Refs><EndToEndId>LF${siId}</EndToEndId></Refs><Amt Ccy="SEK">1250.00</Amt></TxDtls></NtryDtls></Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;
  await owner.goto(B + '/leverantorsfakturor/betalning');
  await owner.setInputFiles('form:has-text("camt.054") input[name=file]', { name: 'camt054.xml', mimeType: 'application/xml', buffer: Buffer.from(camt) });
  await owner.click('button:has-text("Läs in")');
  await waitMsg(owner, '1 betalningar bokförda');
  await owner.goto(`${B}/leverantorsfakturor/${siId}`);
  t = await text(owner);
  assert(t.includes('Betald') && t.includes('2026-11-29'), 'leverantörsfakturan betald via camt.054: ' + t.slice(0, 600));
  log('bankens avisering (camt.054) bokför betalningen på bankens datum');

  // ---- Mottagen e-faktura ----
  const ubl = `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID><cbc:ID>EF-7781</cbc:ID><cbc:IssueDate>2026-11-14</cbc:IssueDate><cbc:DueDate>2026-12-14</cbc:DueDate><cbc:DocumentCurrencyCode>SEK</cbc:DocumentCurrencyCode>
<cac:AccountingSupplierParty><cac:Party><cac:PartyName><cbc:Name>Elbolaget</cbc:Name></cac:PartyName><cac:PartyTaxScheme><cbc:CompanyID>SE559900112201</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>Elbolaget i Norden AB</cbc:RegistrationName><cbc:CompanyID>5599001122</cbc:CompanyID></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
<cac:AccountingCustomerParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Testbolaget AB</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
<cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode><cbc:PaymentID>778100</cbc:PaymentID><cac:PayeeFinancialAccount><cbc:ID>55551234</cbc:ID><cac:FinancialInstitutionBranch><cbc:ID>9900</cbc:ID></cac:FinancialInstitutionBranch></cac:PayeeFinancialAccount></cac:PaymentMeans>
<cac:TaxTotal><cbc:TaxAmount currencyID="SEK">500.00</cbc:TaxAmount></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="SEK">2500.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
<cac:InvoiceLine><cbc:ID>1</cbc:ID><cac:Item><cbc:Name>El november</cbc:Name></cac:Item></cac:InvoiceLine></Invoice>`;
  await owner.goto(B + '/leverantorsfakturor/inkorg');
  await owner.setInputFiles('input[name=files]', { name: 'efaktura.xml', mimeType: 'application/xml', buffer: Buffer.from(ubl) });
  await owner.click('button:has-text("Ladda upp")');
  await owner.waitForURL(/ok=/);
  for (let i = 0; i < 30; i++) { t = await text(owner); if (t.includes('Elbolaget i Norden AB')) break; await owner.waitForTimeout(500); await owner.reload(); }
  assert(t.includes('Elbolaget i Norden AB') && t.includes('2 500,00'), 'e-faktura i inkorgen: ' + t.slice(0, 900));
  log('mottagen e-faktura (Peppol BIS/UBL) läses av direkt ur XML-filen');

  // ---- Skattekontot ----
  await owner.goto(B + '/skattekonto');
  await owner.fill('textarea[name=text]', 'Datum\tTransaktion\tBelopp\tSaldo\n2026-11-12\tMoms okt 2026\t-5 000\t-5 000\n2026-11-12\tInbetalning bokförd\t5 000\t0\n2026-11-14\tIntäktsränta\t3\t3');
  await owner.click('button:has-text("Läs in")');
  await waitMsg(owner, '3 nya transaktioner av 3');
  t = await text(owner);
  assert(t.includes('Moms okt 2026') && t.includes('Via banken') && await owner.inputValue('input[name^=account_] >> nth=0') !== '', 'skattekontot inläst: ' + t.slice(0, 900));
  await owner.click('button:has-text("Bokför markerade")');
  await waitMsg(owner, '2 transaktioner bokförda mot 1630');
  await owner.locator('td:text-is("Bokförd") >> nth=1').waitFor();
  t = await text(owner);
  assert(t.includes('Saldo 2026-11-14') && t.includes('Skillnad 5 000,00'), 'saldo jämförs (inbetalningen stäms av via banken): ' + t.slice(0, 900));
  log('skattekontot läses in, konteras och stäms av mot 1630');

  // ================= Del 3: överblick =================
  await owner.goto(B + '/rapporter/panel');
  t = await text(owner);
  assert(t.includes('Soliditet') && t.includes('Kassalikviditet') && t.includes('Kundernas betaltid') && (await owner.locator('svg.viz').count()) >= 2, 'instrumentpanel: ' + t.slice(0, 600));
  log('instrumentpanel med nyckeltal och diagram');
  await owner.goto(B + '/rapporter/budget?year=2027');
  await owner.click('button:has-text("Fyll från 2026")');
  await waitMsg(owner, 'Budgeten är ifylld från 2026 års utfall');
  await owner.goto(B + '/rapporter/budget?year=2026');
  await owner.fill('input[name=new_account]', '6110');
  await owner.fill('input[name=new_amount]', '12000');
  await owner.click('button:has-text("Spara budget")');
  await waitMsg(owner, 'Budgeten är sparad');
  t = await text(owner);
  assert(t.includes('Budget mot utfall hittills i år') && t.includes('6110'), 'budget mot utfall: ' + t.slice(0, 900));
  log('budget per konto och månad, förifylld från förra året, jämförd med utfallet');

  // ================= Del 4: engelska, mobil, tillgänglighet =================
  const { devices } = require('playwright');
  const mob = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  mob.setDefaultTimeout(20000);
  await mob.goto(BASE + '/login');
  await mob.fill('input[name=email]', 'konsult.omg4@example.com');
  await mob.fill('input[name=password]', 'fakturalosen1');
  await mob.click('form button:has-text("Logga in")');
  await mob.waitForURL(BASE + '/');
  await mob.goto(BASE + '/konto');
  await mob.selectOption('select[name=locale]', 'en');
  await mob.click('form:has(select[name=locale]) button');
  await waitMsg(mob, 'The setting has been saved');
  assert(await mob.locator('html').getAttribute('lang') === 'en', 'html lang=en');
  await mob.goto(B);
  await mob.click('label.navbtn');
  const navEn = await mob.locator('nav').innerText();
  assert(navEn.includes('Customer invoices') && navEn.includes('Overview') && !navEn.includes('Kundfakturor'), 'engelsk meny: ' + navEn.slice(0, 300));
  for (const u of ['', '/fakturor', '/kunder', '/kvitto']) {
    await mob.goto(B + u);
    const [sw, vw] = await mob.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert(sw <= vw + 1, `${u || 'översikt'} ryms i mobilen (${sw} > ${vw})`);
  }
  await mob.goto(B + '/kunder');
  assert((await text(mob)).includes('New customer') || (await text(mob)).includes('Save customer'), 'kundsidan på engelska');
  await mob.keyboard.press('Tab');
  assert((await mob.evaluate(() => document.activeElement?.className)) === 'skip-link', 'första tabbstoppet är hopplänken');
  log('gränssnitt på engelska, sidor ryms i mobilen, hopplänk för tangentbord');

  await browser.close();
  console.log('Omgång 4: alla steg gick igenom');
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
