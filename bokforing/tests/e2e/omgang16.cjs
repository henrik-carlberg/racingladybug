// End-to-end, omgång 16: ekonomiska föreningar och stiftelser, bygg och entreprenad, lagervärdering, bidrag, stickprov för revision.
const { chromium } = require('playwright');
const http = require('node:http');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const text = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); const sel = (await page.locator('main').count()) ? 'main' : 'body'; return (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').replace(/ /g, ' '); };
const iso = (d) => d.toISOString().slice(0, 10);
const day = (n) => iso(new Date(Date.now() - n * 864e5));
const YEAR = new Date().getFullYear();
const MONTH = new Date().getMonth() + 1;

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

const luhn = (s) => { let sum = 0; for (let i = 0; i < s.length; i++) { let v = Number(s[s.length - 1 - i]); if (i % 2 === 1) { v *= 2; if (v > 9) v -= 9; } sum += v; } return sum % 10 === 0; };
const orgnrFor = (prefix) => { for (let i = 0; i < 10; i++) { const s = prefix + String(i); if (luhn(s)) return `${s.slice(0, 6)}-${s.slice(6)}`; } };

(async () => {
  const browser = await chromium.launch();
  const owner = await login(browser, 'agare@example.com', 'hemligtlosen1');
  let t;
  const nb = (s) => s.replace(/[\s  ]/g, '');

  const newCompany = async (name, prefix) => {
    await owner.goto(BASE + '/');
    await owner.fill('input[name=name]', name);
    await owner.selectOption('select[name=company_type]', 'AB');
    await owner.fill('input[name=orgnr]', orgnrFor(String(prefix + (Date.now() % 900000)).slice(0, 9)));
    await owner.fill('input[name=fy_start]', `${YEAR}-01-01`); await owner.fill('input[name=fy_end]', `${YEAR}-12-31`);
    await owner.click('button:has-text("Skapa bolag")');
    await owner.waitForURL(/kom-igang/);
    return owner.url().replace(/\/kom-igang.*/, '');
  };
  const invoice = async (B, customer, amount, dateStr = day(1)) => {
    await owner.goto(B + '/fakturor/ny');
    await owner.selectOption('select[name=customer_id]', { label: customer });
    await owner.fill('input[name=invoice_date]', dateStr);
    const r0 = owner.locator('tbody tr').first();
    await r0.locator('td:nth-child(1) input').fill('Varor'); await r0.locator('td:nth-child(2) input').fill('1');
    await r0.locator('td:nth-child(3) input').fill('st'); await r0.locator('td:nth-child(4) input').fill(String(amount));
    await owner.click('button:has-text("Spara utkast")');
    await owner.waitForURL(/fakturor\/\d+\?ok/);
    await owner.click('button:has-text("Bokför faktura")');
    await owner.locator('text=Fakturan är bokförd').waitFor();
  };

  // ================= Del 1: ekonomisk förening och stiftelse =================
  const E = await newCompany('Konsumtest ekonomisk förening', 769000000);
  await owner.goto(E + '/ekforening');
  await owner.selectOption('select[name=form]', 'ek');
  await owner.click('form:has(select[name=form]) button:has-text("Spara")');
  await owner.locator('text=Läget för ekonomisk förening är på').waitFor();
  await owner.fill('input[name=insats]', '500');
  await owner.click('form:has(input[name=insats]) button:has-text("Spara")');
  await owner.locator('text=Inställningarna är sparade').waitFor();
  for (const n of ['Alva Medlem', 'Berit Medlem']) {
    await owner.goto(E + '/ekforening');
    await owner.fill('form:has(button:has-text("Ny medlem")) input[name=name]', n);
    await owner.click('button:has-text("Ny medlem")');
    await owner.locator('text=är registrerad').waitFor();
  }
  for (const n of ['Alva Medlem', 'Berit Medlem']) {
    await owner.goto(E + '/ekforening');
    await owner.locator(`tr.coop-member:has-text("${n}") button:has-text("Insats betald")`).click();
    await owner.locator('text=Insatsen är bokförd').waitFor();
  }
  await owner.goto(E + '/ekforening');
  assert(nb(await owner.locator('.total-insats').innerText()) === '1000,00', 'summa insatser: ' + await owner.locator('.total-insats').innerText());
  await owner.goto(E + '/rapporter/huvudbok?account=2083');
  assert(nb(await text(owner)).includes('1000,00'), '2083: ' + (await text(owner)).slice(0, 1500));
  log('ekonomisk förening: medlemmar med insats enligt stadgarna, bokförd på 2083');

  await invoice(E, 'Alva Medlem', 30000);
  await invoice(E, 'Berit Medlem', 10000);
  await owner.goto(E + '/ekforening');
  t = nb(await owner.locator('table.refund-basis').innerText());
  assert(t.includes('AlvaMedlem30000,00') && t.includes('BeritMedlem10000,00'), 'underlag: ' + t);
  await owner.fill('form:has(button:has-text("Besluta och bokför återbäring")) input[name=total]', '4000');
  await owner.click('button:has-text("Besluta och bokför återbäring")');
  await owner.locator('text=Återbäringen är bokförd och fördelad').waitFor();
  t = nb(await owner.locator('.card.refund').innerText());
  assert(t.includes('AlvaMedlem:3000,00') && t.includes('BeritMedlem:1000,00'), 'fördelning: ' + t);
  await owner.goto(E + '/ekforening');
  await owner.click('.card.refund button:has-text("Betala ut")');
  await owner.locator('text=Återbäringen är utbetald').waitFor();
  await owner.goto(E + '/rapporter/huvudbok?account=3739');
  assert(nb(await text(owner)).includes('4000,00'), '3739');
  log('återbäring efter medlemmarnas köp: 3739 mot 2891, fördelad på öret och utbetald');

  await owner.goto(E + '/ekforening');
  await owner.locator('tr.coop-member:has-text("Berit Medlem") button:has-text("Uppsägning")').click();
  await owner.locator(`text=avgång ${YEAR + (MONTH === 12 ? 1 : 0)}-12-31`).waitFor();
  await owner.goto(E + '/ekforening');
  assert((await owner.locator('tr.coop-member:has-text("Berit Medlem") .status').innerText()).includes('Återbetalning från'), 'status');
  await owner.locator('tr.coop-member:has-text("Berit Medlem") input[name=date]').fill(day(0));
  await owner.locator('tr.coop-member:has-text("Berit Medlem") button:has-text("Betala tillbaka insatsen")').click();
  await owner.locator('text=Insatsen får betalas tillbaka tidigast').waitFor();
  log('utträde: avgång vid räkenskapsårets slut och insatsen betalas tillbaka först sex månader efter avgången');

  const F = await newCompany('Stiftelsen Test', 802000000);
  await owner.goto(F + '/ekforening');
  await owner.selectOption('select[name=form]', 'stiftelse');
  await owner.click('form:has(select[name=form]) button:has-text("Spara")');
  await owner.locator('text=Stiftelseläget är på').waitFor();
  await owner.fill('textarea[name=purpose]', 'Främja forskning om nyckelpigor');
  await owner.click('form:has(textarea[name=purpose]) button:has-text("Spara")');
  await owner.locator('text=Inställningarna är sparade').waitFor();
  await owner.fill('form:has(button:has-text("Bevilja")) input[name=recipient]', 'Insektsinstitutet');
  await owner.fill('form:has(button:has-text("Bevilja")) input[name=amount]', '5000');
  await owner.click('button:has-text("Bevilja")');
  await owner.locator('text=Bidraget är beviljat och bokfört').waitFor();
  await owner.goto(F + '/ekforening');
  await owner.click('tr.grant-row button:has-text("Betala ut")');
  await owner.locator('text=Bidraget är utbetalt').waitFor();
  await owner.goto(F + '/ekforening');
  assert((await owner.locator('tr.grant-row').innerText()).includes('Utbetalt'), 'utbetalt');
  t = nb(await owner.locator('tr.ff-row').first().innerText());
  assert(t.includes('5000,00'), 'ändamålskostnad i fullföljd: ' + t);
  log('stiftelse: ändamål, beviljade och utbetalda bidrag (6993/2895) och fullföljdskravet över fem år');

  // ================= Del 2: bygg och entreprenad =================
  const G = await newCompany('Byggtest Tak AB', 559300000);
  await owner.goto(G + '/kunder');
  await owner.fill('input[name=name]', 'Byggherren AB');
  await owner.fill('input[name=orgnr]', orgnrFor('556677889'));
  await owner.check('input[name=construction_rc]');
  await owner.click('button:has-text("Spara kund")');
  await owner.locator('text=Kunden är sparad').waitFor();
  await owner.goto(G + '/leverantorer');
  await owner.fill('input[name=name]', 'UE Plåt AB');
  await owner.click('button:has-text("Spara leverantör")');
  await owner.locator('text=Leverantören är sparad').waitFor();
  await owner.goto(G + '/uppdrag');
  await owner.fill('form:has(button:has-text("Skapa uppdrag")) input[name=name]', 'Takbyte fastpris');
  await owner.selectOption('form:has(button:has-text("Skapa uppdrag")) select[name=customer_id]', { label: 'Byggherren AB' });
  await owner.selectOption('form:has(button:has-text("Skapa uppdrag")) select[name=billing]', 'fixed');
  await owner.click('button:has-text("Skapa uppdrag")');
  await owner.waitForLoadState('networkidle');
  await owner.goto(G + '/successiv');
  await owner.selectOption('form:has(button:has-text("Lägg upp uppdrag")) select[name=project_id]', { label: 'Takbyte fastpris' });
  await owner.fill('form:has(button:has-text("Lägg upp uppdrag")) input[name=value]', '200000');
  await owner.fill('form:has(button:has-text("Lägg upp uppdrag")) input[name=estimated_cost]', '150000');
  await owner.click('button:has-text("Lägg upp uppdrag")');
  await owner.locator('text=Fastprisuppdraget är upplagt').waitFor();

  const ata = async (kind, description, amount, cost) => {
    await owner.goto(G + '/bygg');
    const f = owner.locator('.ata-contract:has-text("Takbyte fastpris") form:has(button:has-text("Ny ÄTA"))');
    await f.locator('select[name=kind]').selectOption(kind);
    await f.locator('input[name=description]').fill(description);
    await f.locator('input[name=amount]').fill(amount); await f.locator('input[name=cost]').fill(cost);
    await f.locator('button:has-text("Ny ÄTA")').click();
    await owner.locator('text=väntar på beställarens beslut').waitFor();
  };
  await ata('tillagg', 'Extra takfönster', '20000', '12000');
  await ata('avgaende', 'Hängrännor utgår', '5000', '3000');
  await ata('andring', 'Annan takpanna', '8000', '6000');
  for (const [d, btn] of [['Extra takfönster', 'Godkänn'], ['Hängrännor utgår', 'Godkänn'], ['Annan takpanna', 'Avslå']]) {
    await owner.goto(G + '/bygg');
    await owner.locator(`tr.ata-row:has-text("${d}") button:has-text("${btn}")`).click();
    await owner.locator(btn === 'Godkänn' ? 'text=ÄTA:n är godkänd' : 'text=ÄTA:n är avslagen').waitFor();
  }
  await owner.goto(G + '/bygg');
  assert(nb(await owner.locator('.ata-total').innerText()) === '215000,00', 'kontraktssumma: ' + await owner.locator('.ata-contract').innerText());
  assert((await owner.locator('tr.ata-row:has-text("Hängrännor utgår")').innerText()).includes('-5') || nb(await owner.locator('tr.ata-row:has-text("Hängrännor utgår")').innerText()).includes('−5000,00'), 'avgående negativt');
  await owner.goto(G + '/successiv');
  t = nb(await owner.locator('tr.poc-row:has-text("Takbyte fastpris")').innerText());
  assert(t.includes('215000,00'), 'POC använder ÄTA: ' + t);
  log('ÄTA-register: tillägg, avgående och ändring med beställarens beslut – godkända ändrar kontraktssumman i successiv vinstavräkning');

  await owner.goto(G + '/fakturor/ny');
  await owner.selectOption('select[name=customer_id]', { label: 'Byggherren AB' });
  await owner.fill('input[name=invoice_date]', day(1));
  await owner.click('button:has-text("+ Rad")');
  const rows = owner.locator('tbody tr');
  await rows.nth(0).locator('td:nth-child(1) input').fill('Takbyte enligt avtal, etapp 1'); await rows.nth(0).locator('td:nth-child(4) input').fill('100000');
  await rows.nth(1).locator('td:nth-child(1) input').fill('Konsultation och projektering'); await rows.nth(1).locator('td:nth-child(4) input').fill('5000');
  await owner.click('button:has-text("Spara utkast")');
  await owner.waitForURL(/fakturor\/\d+\?ok/);
  assert((await owner.locator('.rc-check .rc-line.warn').count()) === 1 && (await owner.locator('.rc-check .rc-line.ok').count()) === 1, 'kontroll per rad: ' + await owner.locator('.rc-check').innerText());
  assert((await owner.locator('.rc-line.warn').innerText()).includes('Konsultation'), 'rätt rad varnas');
  await owner.click('button:has-text("Bokför faktura")');
  await owner.locator('text=Fakturan är bokförd').waitFor();
  log('omvänd byggmoms kontrolleras per rad: byggtjänsten godkänns, konsult/projektering varnas');

  await owner.goto(G + '/bygg');
  await owner.locator('form:has(button:has-text("Bokför innehållet belopp")):has(select[name=invoice_id]) input[name=pct]').fill('10');
  await owner.locator('form:has(select[name=invoice_id]) button:has-text("Bokför innehållet belopp")').click();
  await owner.locator('text=kr är innehållet och bokfört på 1682').waitFor();
  await owner.goto(G + '/bygg');
  assert(nb(await owner.locator('.ret-customer').innerText()) === '10500,00', 'utestående hos kund');
  await owner.goto(G + '/rapporter/huvudbok?account=1682');
  assert(nb(await text(owner)).includes('10500,00'), '1682');
  await owner.goto(G + '/bygg');
  await owner.click('tr.retention-row.customer button:has-text("Kunden har betalat")');
  await owner.locator('text=Det innehållna beloppet är frisläppt').waitFor();
  await owner.goto(G + '/bygg');
  assert(nb(await owner.locator('.ret-customer').innerText()) === '0,00', 'frisläppt');

  await owner.goto(G + '/leverantorsfakturor/ny');
  await owner.selectOption('select[name=supplier_id]', { label: 'UE Plåt AB' });
  await owner.fill('input[name=invoice_number]', 'UE-1');
  await owner.fill('input[name=invoice_date]', day(2)); await owner.fill('input[name=due_date]', day(-20));
  await owner.fill('input[name=total]', '40000');
  await owner.fill('input[name=account_0]', '4010'); await owner.fill('input[name=amount_0]', '40000');
  await owner.click('button:has-text("Registrera och bokför")');
  await owner.waitForURL(/leverantorsfakturor\/\d+\?ok/);
  await owner.goto(G + '/bygg');
  await owner.locator('form:has(select[name=supplier_invoice_id]) input[name=pct]').fill('5');
  await owner.locator('form:has(select[name=supplier_invoice_id]) button:has-text("Bokför innehållet belopp")').click();
  await owner.locator('text=kr är innehållet och bokfört på 2446').waitFor(); assert(nb(await owner.locator('.flash').first().innerText()).includes('2000,00'), '5 % av 40 000');
  log('innehållna belopp: kunden håller inne 10 % (1682) som betalas vid slutbesiktning, vi håller inne 5 % hos underentreprenören (2446)');

  // ================= Del 3: lagervärdering =================
  const L = await newCompany('Lagertest Handel AB', 559400000);
  await owner.goto(L + '/leverantorer');
  await owner.fill('input[name=name]', 'Grossisten AB');
  await owner.click('button:has-text("Spara leverantör")');
  await owner.locator('text=Leverantören är sparad').waitFor();
  await owner.goto(L + '/moduler');
  await owner.locator('.card:has(h2:text-is("Inköp, lager och logistik")) button:has-text("Aktivera")').click();
  await owner.waitForLoadState('networkidle');
  const M = L + '/m/lager';
  await owner.goto(M + '/artiklar');
  await owner.fill('input[name=sku]', 'V-1'); await owner.fill('input[name=name]', 'Vas');
  await owner.fill('input[name=purchase_price]', '100'); await owner.fill('input[name=sales_price]', '90');
  await owner.selectOption('select[name=supplier_id]', { index: 1 });
  await owner.fill('input[name=opening_qty]', '10');
  await owner.click('button:has-text("Lägg upp artikel")');
  await owner.waitForLoadState('networkidle');
  await owner.goto(M + '/artiklar');
  await owner.fill('input[name=sku]', 'K-1'); await owner.fill('input[name=name]', 'Kruka');
  await owner.fill('input[name=purchase_price]', '50'); await owner.fill('input[name=sales_price]', '200');
  await owner.selectOption('select[name=supplier_id]', { index: 1 });
  await owner.fill('input[name=opening_qty]', '20');
  await owner.click('button:has-text("Lägg upp artikel")');
  await owner.waitForLoadState('networkidle');
  // Inleverans av V-1 till högre pris via inköpsorder
  await owner.goto(M + '/inkop');
  await owner.selectOption('select[name=supplier_id]', { label: 'Grossisten AB' });
  await owner.selectOption('select[name=product_0]', await owner.locator('select[name=product_0] option:has-text("V-1 ")').first().getAttribute('value'));
  await owner.fill('input[name=qty_0]', '10'); await owner.fill('input[name=price_0]', '130');
  await owner.click('button:text-is("Skapa inköpsorder")');
  await owner.locator('text=Inköpsordern är skapad').waitFor();
  await owner.click('button:has-text("Markera som skickad")');
  await owner.locator('text=markerad som skickad').waitFor();
  await owner.click('button:has-text("Registrera inleverans")');
  await owner.locator('text=Inleveransen är registrerad').waitFor();

  // Inventering: V-1 20 → 15 (svinn 5 st) bokförs direkt
  await owner.goto(M + '/inventering');
  const v1 = await owner.locator('tr:has-text("V-1") input[name=product_id]').inputValue();
  await owner.fill(`input[name=counted_${v1}]`, '15');
  await owner.click('button:has-text("Registrera inventering")');
  await owner.locator('text=bokförd mot 1460/4960').waitFor();
  t = nb(await owner.locator('.flash').first().innerText());
  assert(t.includes('-575,00') || t.includes('−575,00'), 'svinn till snittpris 115: ' + t);
  await owner.goto(L + '/rapporter/huvudbok?account=4960');
  assert((await text(owner)).includes('Inventeringsdifferens'), 'inventeringsdifferens bokförd');
  log('inventeringsdifferens (svinn 5 st till snittpris) bokförs direkt mot 1460/4960');

  await owner.goto(M + '/varde');
  assert(nb(await owner.locator('.val-cost').innerText()) === '2725,00', 'snittpris: 15×115 + 20×50 = ' + await owner.locator('.val-cost').innerText());
  await owner.selectOption('select[name=cost_method]', 'fifo');
  await owner.fill('input[name=sell_cost_pct]', '10');
  await owner.click('button:has-text("Spara metod")');
  await owner.locator('text=Värderingsmetoden är sparad').waitFor();
  await owner.goto(M + '/varde');
  assert(nb(await owner.locator('.val-cost').innerText()) === '2800,00', 'FIFO: 10×130 + 5×100 + 20×50 = ' + await owner.locator('.val-cost').innerText());
  // Vas säljs för 90 kr minus 10 % = 81 kr/st < anskaffning – Kruka: 25 % inkurans
  const k1row = owner.locator('tr.val-row:has(td:text-is("K-1"))');
  await k1row.locator('input[name=obsolete_pct]').fill('25');
  await k1row.locator('button:has-text("Spara")').click();
  await owner.locator('text=Inkuransen är sparad').waitFor();
  await owner.goto(M + '/varde');
  assert(nb(await owner.locator('.val-lvp').innerText()) === '1965,00', 'LVP: 15×81 + 20×50×0,75 = ' + await owner.locator('.val-lvp').innerText());
  assert(nb(await owner.locator('.val-97').innerText()) === '2716,00', '97 %');
  assert((await owner.locator('.val-hint').innerText()).includes('lägsta värdets princip'), 'lägst tillåtna');
  await owner.goto(M + '/varde?regel=lvp');
  await owner.click('button:has-text("Bokför lagerförändring")');
  await owner.locator('text=Lagervärderingen är bokförd').waitFor();
  await owner.goto(M + '/varde?regel=lvp');
  assert(nb(await owner.locator('.val-booked').innerText()) === '1965,00' && nb(await owner.locator('.val-change').innerText()) === '0,00', 'bokfört 1460');
  log('lagervärdering: FIFO eller snittpris, lägsta värdets princip med nettoförsäljningsvärde och inkurans per artikel, jämfört med 97 %-regeln');

  // ================= Del 4: bidrag =================
  await owner.goto(G + '/uppdrag');
  await owner.fill('form:has(button:has-text("Skapa uppdrag")) input[name=name]', 'Digitaliseringsprojekt');
  await owner.selectOption('form:has(button:has-text("Skapa uppdrag")) select[name=customer_id]', { label: 'Byggherren AB' });
  await owner.click('button:has-text("Skapa uppdrag")');
  await owner.waitForLoadState('networkidle');
  await owner.goto(G + '/bidrag');
  const gf = owner.locator('form:has(button:has-text("Registrera bidrag"))');
  await gf.locator('input[name=name]').fill('Digitaliseringscheck'); await gf.locator('input[name=grantor]').fill('Region Testlän');
  await gf.locator('input[name=reference]').fill('RT 2026-123');
  await gf.locator('select[name=project_id]').selectOption({ label: 'Digitaliseringsprojekt' });
  await gf.locator('input[name=amount]').fill('20000'); await gf.locator('input[name=coverage_pct]').fill('50'); await gf.locator('input[name=budget]').fill('100000');
  await gf.locator('input[name=period_from]').fill(`${YEAR}-01-01`); await gf.locator('input[name=period_to]').fill(`${YEAR}-12-31`);
  await gf.locator('input[name=conditions]').fill('Slutrapport senast 31 januari');
  await gf.locator('button:has-text("Registrera bidrag")').click();
  await owner.locator('text=Bidraget är registrerat').waitFor();
  await owner.locator('.grant form:has(button:has-text("Registrera utbetalning")) input[name=amount]').fill('10000');
  await owner.click('.grant button:has-text("Registrera utbetalning")');
  await owner.locator('text=Utbetalningen är bokförd').waitFor();
  await owner.goto(G + '/bidrag');
  assert(nb(await owner.locator('.g-balance').innerText()) === '10000,00', 'förutbetalt 2975');

  await owner.goto(G + '/leverantorsfakturor/ny');
  await owner.selectOption('select[name=supplier_id]', { label: 'UE Plåt AB' });
  await owner.fill('input[name=invoice_number]', 'IT-77');
  await owner.fill('input[name=invoice_date]', day(3)); await owner.fill('input[name=due_date]', day(-20));
  await owner.fill('input[name=total]', '60000');
  await owner.fill('input[name=account_0]', '4010'); await owner.fill('input[name=amount_0]', '60000');
  await owner.selectOption('select[name=project_id]', { label: 'Digitaliseringsprojekt' });
  await owner.click('button:has-text("Registrera och bokför")');
  await owner.waitForURL(/leverantorsfakturor\/\d+\?ok/);
  await owner.goto(G + '/bidrag');
  assert(nb(await owner.locator('.g-costs').innerText()) === '60000,00' && nb(await owner.locator('.g-earned').innerText()) === '20000,00', 'intjänat 50 % med tak');
  await owner.click('button:has-text("Intäktsför bidragen")');
  await owner.locator('text=1 bidrag är intäktsförda').waitFor();
  await owner.goto(G + '/bidrag');
  assert(nb(await owner.locator('.g-recognized').innerText()) === '20000,00' && nb(await owner.locator('.g-balance').innerText()) === '10000,00' && (await owner.locator('.grant').innerText()).includes('Upplupet'), 'upplupet 1791');
  await owner.goto(G + '/rapporter/huvudbok?account=3980');
  assert(nb(await text(owner)).includes('20000,00'), '3980');
  log('bidrag periodiseras mot projektets kostnader (50 %, tak 20 000): förutbetalt 2975 används först, resten upplupet 1791');

  await owner.goto(G + '/bidrag');
  await owner.click('.grant a:has-text("Rapport till bidragsgivaren")');
  await owner.waitForURL(/bidrag\/\d+/);
  t = nb(await text(owner));
  assert(t.includes('RT2026-123') && nb(await owner.locator('.to-request').innerText()) === '10000,00' && nb(await owner.locator('.period-costs').innerText()) === '60000,00', 'rapport: ' + t.slice(0, 800));
  log('ekonomisk rapport till bidragsgivaren: kostnader per konto, intjänat och att rekvirera');

  await owner.goto(G + '/bidrag');
  await owner.selectOption('.grant select[name=risk]', 'probable');
  await owner.fill('.grant input[name=risk_note]', 'Projektet slutförs inte inom perioden');
  await owner.click('.grant button:has-text("Spara bedömning")');
  await owner.locator('text=Återbetalningsskulden är bokförd').waitFor();
  await owner.goto(G + '/bidrag');
  assert((await owner.locator('.grant').innerText()).includes('Ska återbetalas'), 'status');
  await owner.goto(G + '/rapporter/huvudbok?account=2976');
  assert(nb(await text(owner)).includes('10000,00'), 'skuld 2976');
  await owner.goto(G + '/bidrag');
  await owner.click('.grant button:has-text("Betala tillbaka")');
  await owner.locator('text=Återbetalningen är bokförd').waitFor();
  log('sannolik återbetalning: intäkten förs tillbaka, utbetalt blir skuld (2976) och betalas tillbaka');

  // ================= Del 5: stickprov för bokslutsrevision =================
  const B1 = `${BASE}/c/1`;
  const rev = await login(browser, 'revisor.omg4@example.com', 'granskarlosen1');
  await rev.goto(B1 + '/revision');
  // Granskningen av året kan redan vara startad (omgång 9) – öppna den, annars starta den
  const existing = rev.locator(`a:text-is("${YEAR}-01-01 – ${YEAR}-12-31")`);
  if (await existing.count()) await existing.click();
  else { await rev.selectOption('select[name=fy]', { label: `${YEAR}-01-01 – ${YEAR}-12-31` }); await rev.click('button:has-text("Starta granskning")'); }
  await rev.waitForURL(/revision\/\d+/);
  const RU = rev.url().split('?')[0].split('#')[0];
  const okMsg = async (part) => rev.waitForURL((u) => decodeURIComponent(u.href.replace(/\+/g, ' ')).includes(part));
  assert(await rev.locator('.materiality-suggestion').count(), 'förslag till väsentlighet visas');
  t = await rev.locator('.materiality-suggestion').innerText();
  assert(t.includes('av omsättning') && t.includes('genomförandeväsentlighet'), 'riktmärken: ' + t);
  await rev.click('.materiality-suggestion button:has-text("Använd förslaget")');
  await okMsg('Väsentligheten är sparad');
  assert(await rev.locator('.materiality .perf').count(), 'genomförandeväsentlighet sparad');
  log('väsentlighet föreslås ur omsättning, resultat och balansomslutning, med genomförandeväsentlighet och obetydlighetsgräns');

  await rev.goto(RU);
  await rev.selectOption('form.new-sample select[name=method]', 'mus');
  await rev.click('button:has-text("Lägg till i stickprovet")');
  await okMsg('verifikationer lades till');
  assert((await text(rev)).includes('Beloppsviktat urval') || (await text(rev)).includes('Nyckelpost'), 'MUS-urval');
  log('beloppsviktat urval (MUS) av verifikationer med genomförandeväsentligheten som intervall');

  await rev.goto(RU);
  await rev.selectOption('form.ledger-sample select[name=kind]', 'customer');
  await rev.selectOption('form.ledger-sample select[name=method]', 'largest');
  await rev.fill('form.ledger-sample input[name=count]', '3');
  await rev.click('button:has-text("Lägg till ur reskontran")');
  await okMsg('kundfakturor lades till i stickprovet');
  await rev.goto(RU);
  await rev.selectOption('form.ledger-sample select[name=kind]', 'supplier');
  await rev.selectOption('form.ledger-sample select[name=method]', 'largest');
  await rev.fill('form.ledger-sample input[name=count]', '2');
  await rev.click('button:has-text("Lägg till ur reskontran")');
  await okMsg('leverantörsfakturor lades till i stickprovet');
  await rev.goto(RU);
  const lrows = rev.locator('table.ledger-samples tr.ledger-row');
  assert((await rev.locator('tr.ledger-row.customer').count()) >= 1 && (await rev.locator('tr.ledger-row.supplier').count()) >= 1, 'stickprov ur båda reskontrorna');
  assert(((await lrows.first().locator('.evidence').innerText()) || '').length > 5, 'underlag om efterföljande betalning');
  const lid = await lrows.first().getAttribute('id');
  await lrows.first().locator('input[value=remark]').check();
  await lrows.first().locator('input[name=comment]').fill('Saldobekräftelse saknas');
  await lrows.first().locator('button:has-text("Spara")').click();
  await rev.locator(`#${lid} .badge:has-text("Anmärkning")`).waitFor();
  await rev.locator('table.ledger-samples tr.ledger-row').nth(1).locator('input[value=ok]').check();
  await rev.locator('table.ledger-samples tr.ledger-row').nth(1).locator('button:has-text("Spara")').click();
  await rev.locator('table.ledger-samples tr.ledger-row').nth(1).locator('.badge:has-text("Utan anmärkning")').waitFor();
  await rev.click('button:has-text("Skicka anmärkningar till bolaget")');
  await okMsg('anmärkningar är skickade');
  await owner.goto(RU);
  t = await text(owner);
  assert(t.includes('Anmärkningar på reskontran') && t.includes('Saldobekräftelse saknas') && !(await owner.locator('form.ledger-sample').count()), 'bolaget ser anmärkningen men kan inte ta stickprov');
  log('stickprov ur kund- och leverantörsreskontran per balansdagen med efterföljande betalningar som underlag, avbockning och anmärkning till bolaget');

  //@@NEXT@@
  await browser.close(); mailServer.close();
  console.log('Omgång 16: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
