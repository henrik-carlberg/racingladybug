// End-to-end-test av hela flödet mot en TOM databas och en körande server.
// Kör: npm run build && npm start (i annat fönster), sedan: BASE_URL=http://localhost:3000 npm run test:e2e
const { chromium } = require('playwright');
const fs = require('fs');
const { execFileSync } = require('child_process');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = process.argv[2] || require('os').tmpdir();
const XSD = require('path').join(__dirname, '../fixtures/agi/arbetsgivardeklaration_1.1.xsd');
const log = (...a) => console.log('✔', ...a);

async function expectNoError(page, step) {
  const err = await page.locator('.flash.error').first().textContent({ timeout: 300 }).catch(() => null);
  if (err) throw new Error(`${step}: ${err}`);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

  // Registrera ägare
  await page.goto(BASE + '/register');
  await page.fill('input[name=name]', 'Ägare Testsson');
  await page.fill('input[name=email]', 'agare@example.com');
  await page.fill('input[name=password]', 'hemligtlosen1');
  await page.click('button:has-text("Skapa konto")');
  await page.waitForURL(BASE + '/');
  log('registrerad');

  // Bolag
  await page.fill('input[name=name]', 'Testbolaget AB');
  await page.fill('input[name=orgnr]', '5560269986');
  await page.fill('input[name=fy_start]', '2026-01-01');
  await page.click('button:has-text("Skapa bolag")');
  await page.waitForURL(/installningar/);
  await expectNoError(page, 'bolag');
  const cid = page.url().match(/\/c\/(\d+)/)[1];
  const B = `${BASE}/c/${cid}`;
  await page.fill('input[name=address]', 'Storgatan 1');
  await page.fill('input[name=postal_code]', '111 22');
  await page.fill('input[name=city]', 'Stockholm');
  await page.fill('input[name=phone]', '0701234567');
  await page.fill('input[name=bankgiro]', '123-4567');
  await page.fill('input[name=vat_number]', 'SE556026998601');
  await page.click('form:has(input[name=address]) button:has-text("Spara")');
  await page.waitForURL(/ok=/);
  log('bolag skapat', cid);

  // Kund + faktura
  await page.goto(B + '/kunder');
  await page.fill('input[name=name]', 'Kund AB');
  await page.fill('input[name=email]', 'kund@example.com');
  await page.click('button:has-text("Spara kund")');
  await page.waitForURL(/ok=/);
  await page.goto(B + '/fakturor/ny');
  await page.selectOption('select[name=customer_id]', { label: 'Kund AB' });
  await page.fill('input[name=invoice_date]', '2026-05-10');
  const row = page.locator('tbody tr').first();
  await row.locator('td:nth-child(1) input').fill('Konsulttimmar');
  await row.locator('td:nth-child(2) input').fill('10');
  await row.locator('td:nth-child(3) input').fill('h');
  await row.locator('td:nth-child(4) input').fill('950');
  await page.click('button:has-text("Spara utkast")');
  await page.waitForURL(/fakturor\/\d+\?ok/);
  await page.click('button:has-text("Bokför faktura")');
  await page.waitForURL(/ok=/);
  await expectNoError(page, 'bokför faktura');
  const invText = await page.locator('.doc').textContent();
  if (!invText.includes('11 875,00') && !invText.includes('11 875,00')) throw new Error('fel fakturabelopp: ' + invText.slice(0, 400));
  if (!invText.includes('Godkänd för F-skatt')) throw new Error('F-skatt saknas');
  log('faktura bokförd', invText.match(/OCR(\d+)/)?.[1]);
  await page.screenshot({ path: OUT + '/faktura.png', fullPage: true });
  await page.fill('input[name=date]', '2026-05-30');
  await page.click('button:has-text("Registrera inbetalning")');
  await page.waitForURL(/ok=/);
  await expectNoError(page, 'inbetalning');
  log('inbetalning');

  // Leverantör + faktura + attest + betalning
  await page.goto(B + '/leverantorer');
  await page.fill('input[name=name]', 'Hyresvärden AB');
  await page.fill('input[name=bankgiro]', '555-1234');
  await page.fill('input[name=default_account]', '5010');
  await page.click('button:has-text("Spara leverantör")');
  await page.waitForURL(/ok=/);
  await page.goto(B + '/leverantorsfakturor/ny');
  await page.selectOption('select[name=supplier_id]', { label: 'Hyresvärden AB' });
  await page.fill('input[name=invoice_number]', 'H-2026-05');
  await page.fill('input[name=invoice_date]', '2026-05-01');
  await page.fill('input[name=due_date]', '2026-05-31');
  await page.fill('input[name=payment_reference]', '12345678');
  await page.fill('input[name=total]', '10000');
  await page.click('button:has-text("25 % moms")');
  await page.click('button:has-text("Registrera och bokför")');
  await page.waitForURL(/leverantorsfakturor\/\d+\?ok/);
  await expectNoError(page, 'levfaktura');
  await page.click('button:has-text("Attestera")');
  await page.waitForURL(/ok=/);
  await page.goto(B + '/leverantorsfakturor/betalning');
  await page.fill('input[name=date]', '2026-05-29');
  await page.click('button:has-text("Bokför valda som betalda")');
  await page.waitForURL(/ok=/);
  await expectNoError(page, 'betalning');
  log('leverantörsfaktura attesterad och betald');

  // Skattetabell + anställd + lön
  await page.goto(B + '/lon/skattetabeller');
  await page.fill('input[name=year]', '2026');
  await page.fill('input[name=tables]', '32');
  await page.click('button:has-text("Hämta från Skatteverket")');
  await page.waitForURL(/(ok|error)=/, { timeout: 60000 });
  await expectNoError(page, 'skattetabell');
  log('skattetabell 32 hämtad');
  await page.goto(B + '/lon/anstallda');
  await page.fill('input[name=first_name]', 'Anna');
  await page.fill('input[name=last_name]', 'Andersson');
  await page.fill('input[name=personal_number]', '19811218-9876');
  await page.fill('input[name=monthly_salary]', '35000');
  await page.fill('input[name=tax_table]', '32');
  await page.click('form:has(input[name=first_name]) button:has-text("Spara")');
  await page.waitForURL(/ok=/);
  await expectNoError(page, 'anställd');
  await page.goto(B + '/lon');
  await page.fill('input[name=period]', '2026-05');
  await page.fill('input[name=payment_date]', '2026-05-25');
  await page.click('button:has-text("Ny lönekörning")');
  await page.waitForURL(/lon\/\d+\?ok/);
  await expectNoError(page, 'lönekörning');
  // lägg till övertid
  await page.fill('input[name=desc_1]', 'Övertid');
  await page.fill('input[name=amount_1]', '100');
  await page.click('button:has-text("Spara och räkna om")');
  await page.waitForLoadState('networkidle');
  await expectNoError(page, 'lönespec');
  const runText = await page.locator('main').textContent();
  log('lönespec', runText.match(/Skatt \(Tabell 32, kolumn 1\)([\d\s ,]+)/)?.[1]);
  await page.click('button:has-text("Bokför lönekörning")');
  await page.waitForURL(/ok=/);
  await expectNoError(page, 'bokför lön');
  await page.screenshot({ path: OUT + '/lon.png', fullPage: true });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('a:has-text("Ladda ner AGI-fil")')]);
  const agiPath = OUT + '/agi.xml';
  await dl.saveAs(agiPath);
  execFileSync('xmllint', ['--noout', '--schema', XSD, agiPath], { stdio: 'pipe' });
  log('AGI validerar mot XSD');

  // Moms
  await page.goto(B + '/rapporter/moms?from=2026-04-01&to=2026-06-30');
  const vatText = await page.locator('table').textContent();
  log('moms', vatText.replace(/\s+/g, ' ').slice(0, 300));
  await page.click('button:has-text("Bokför momsavräkning")');
  await page.waitForURL(/verifikationer\/\d+\?ok/);
  await expectNoError(page, 'momsavräkning');
  await page.goto(B + '/rapporter/moms?from=2026-04-01&to=2026-06-30');
  if (!(await page.locator('text=Momsen för perioden är avräknad').count())) throw new Error('avräkning syns inte');
  log('momsavräkning');

  // Manuell verifikation + rättelse
  await page.goto(B + '/verifikationer/ny');
  await page.fill('input[name=date]', '2026-06-02');
  await page.fill('input[name=description]', 'Kontorsmaterial kvitto');
  const r1 = page.locator('tbody tr').nth(0), r2 = page.locator('tbody tr').nth(1);
  await r1.locator('td:nth-child(1) input').fill('6110');
  await r1.locator('td:nth-child(3) input').fill('400');
  await r2.locator('td:nth-child(1) input').fill('1930');
  await page.click('button:has-text("Balansera")');
  await page.click('button:has-text("Bokför")');
  await page.waitForURL(/verifikationer\/\d+\?ok/);
  await page.fill('input[name=reason]', 'Fel konto');
  await page.click('button:has-text("Bokför rättelse")');
  await page.waitForURL(/ok=/);
  await expectNoError(page, 'rättelse');
  log('manuell verifikation + rättelse');

  // Rapporter
  await page.goto(B + '/rapporter?fy=&from=2026-01-01&to=2026-12-31');
  const rep = await page.locator('main').textContent();
  await page.screenshot({ path: OUT + '/rapport.png', fullPage: true });
  log('rapport', rep.match(/Beräknat resultat([-\d\s ,]+)/)?.[1], '| tillgångar', rep.match(/Summa tillgångar([-\d\s ,]+)/)?.[1], '| resultat bal', rep.match(/Årets resultat hittills([-\d\s ,]+)/)?.[1]);
  await page.goto(B + '/rapporter/export');
  const [sie] = await Promise.all([page.waitForEvent('download'), page.click('a:has-text("Ladda ner SIE 4")')]);
  await sie.saveAs(OUT + '/export.se');
  log('SIE', fs.statSync(OUT + '/export.se').size, 'bytes');

  // Bjud in redovisningskonsult
  await page.goto(B + '/installningar');
  await page.fill('form:has(select[name=role]) input[name=email]', 'konsult@example.com');
  await page.click('button:has-text("Skapa inbjudan")');
  await page.waitForURL(/invite=/);
  const link = (await page.locator('code').textContent()).trim();
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(link);
  await p2.fill('input[name=name]', 'Konsult Kallesson');
  await p2.fill('input[name=password]', 'konsultlosen1');
  await p2.click('button:has-text("Acceptera")');
  await p2.waitForURL(BASE + '/');
  await p2.goto(B + '/installningar');
  if (await p2.locator('button:has-text("Skapa inbjudan")').count()) throw new Error('konsult ska inte kunna bjuda in');
  await p2.goto(B + '/verifikationer');
  const n = await p2.locator('tbody tr').count();
  log('konsult inloggad, ser', n, 'verifikationer, kan inte bjuda in');
  // Fri registrering ska vara stängd
  await p2.goto(BASE + '/register');
  const ctx3 = await browser.newContext(); const p3 = await ctx3.newPage();
  await p3.goto(BASE + '/register');
  await p3.fill('input[name=name]', 'X'); await p3.fill('input[name=email]', 'x@example.com'); await p3.fill('input[name=password]', 'xxxxxxxxxxxx');
  await p3.click('button:has-text("Skapa konto")');
  await p3.waitForURL(/error=/);
  log('registrering stängd för nya');
  // Konsult kommer inte åt annat bolags id
  const resp = await p2.goto(`${BASE}/c/9999`);
  log('okänt bolag ->', resp.status());
  await browser.close();
})().catch((e) => { console.error('FEL:', e.message); process.exit(1); });
