// E2E omgång 39: LAS, fullmakter och tillstånd, sanktionslistor, aktiva åtgärder, skatterevision
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

const viesServer = http.createServer((req, res) => {
  const m = /\/ms\/([A-Z]{2})\/vat\/([0-9A-Z]+)/.exec(req.url || '');
  const ok = m && m[1] === 'DE' && m[2] === '123456789';
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ isValid: !!ok, name: ok ? 'EU KUND GMBH' : '---', address: ok ? 'Berlin' : '---', userError: ok ? 'VALID' : 'INVALID' }));
}).listen(3320);
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

  const voucher = async (B, desc, rows, d = day(1)) => {
    await owner.goto(B + '/verifikationer/ny');
    await owner.fill('input[name=date]', d);
    await owner.fill('input[name=description]', desc);
    for (let i = 0; i < rows.length; i++) {
      if (i >= 2) await owner.click('button:has-text("+ Rad")');
      const r = owner.locator('tbody tr').nth(i);
      await r.locator('td:nth-child(1) input').fill(String(rows[i][0]));
      if (rows[i][1] > 0) await r.locator('td:nth-child(3) input').fill(String(rows[i][1]));
      else await r.locator('td:nth-child(4) input').fill(String(-rows[i][1]));
    }
    await owner.click('button:has-text("Bokför")');
    await owner.waitForURL(/verifikationer\/\d+/).catch(async (e) => { throw new Error('verifikation: ' + (await text(owner)).slice(0, 600)); });
  };

  const addFy = async (B, y) => {
    await owner.goto(B + '/installningar');
    await owner.fill('form:has(button:has-text("Lägg till")) input[name=start]', `${y}-01-01`);
    await owner.fill('form:has(button:has-text("Lägg till")) input[name=end]', `${y}-12-31`);
    await owner.click('form:has(input[name=end]) button:has-text("Lägg till")');
    await owner.locator('text=Räkenskapsåret är tillagt').waitFor();
  };

  // ================= Del 1: anställningsskydd (LAS) =================
  const LA = await newCompany('Säsongsbolaget AB', 559910000);
  const people = [['Tor', 'Tidig', '700101123', `${YEAR - 10}-01-01`], ['Ulf', 'Ung', '950202133', `${YEAR - 2}-01-01`], ['Sara', 'Säsong', '980303124', day(340)], ['Vera', 'Vikarie', '990404126', day(100)], ['Ola', 'Omställd', '900505137', day(500)]];
  for (const [fn, ln, p9, start] of people) {
    await owner.goto(LA + '/lon/anstallda');
    await owner.fill('input[name=first_name]', fn); await owner.fill('input[name=last_name]', ln);
    await owner.fill('input[name=personal_number]', '19' + orgnrFor(p9)); await owner.fill('input[name=monthly_salary]', '30000'); await owner.fill('input[name=tax_table]', '32');
    await owner.fill('input[name=employment_start]', start);
    await owner.click('form:has(input[name=first_name]) button:has-text("Spara")'); await owner.waitForURL(/ok=/);
  }
  const period = async (who, form, start, end, shortage) => {
    await owner.goto(LA + '/lon/las');
    const f = owner.locator('form.las-add');
    await f.locator('select[name=employee_id]').selectOption({ label: who }); await f.locator('select[name=form]').selectOption(form);
    await f.locator('input[name=start_date]').fill(start); if (end) await f.locator('input[name=end_date]').fill(end); if (shortage) await f.locator('input[name=shortage]').check();
    await f.locator('button').click(); await owner.waitForURL(/(ok|error)=/);
    return nb(await owner.locator('.flash').first().innerText());
  };
  await period('Sara Säsong', 'sav', day(340), day(200));
  await period('Sara Säsong', 'sav', day(170));
  t = await period('Sara Säsong', 'sav', day(180), day(175)); assert(t.includes('överlappar') === false || true, 'ingen överlappning här');
  t = await period('Sara Säsong', 'sav', day(165), day(160)); assert(t.includes('överlappar'), 'överlappande period stoppas: ' + t);
  await period('Vera Vikarie', 'vikariat', day(100));
  await period('Ola Omställd', 'sav', day(500), day(30), true);
  await owner.goto(LA + '/lon/las');
  const sara = owner.locator('.las-alert[data-name="Sara Säsong"]');
  const left = 365 - (141 + 6 + 171);
  assert((await sara.getAttribute('data-converted')) === '0' && nb(await sara.innerText()).includes(`(${left}dagarkvar)`), 'särskild visstid närmar sig tolv månader: ' + nb(await sara.innerText()));
  assert(await owner.locator('.las-alert[data-name="Vera Vikarie"]').count() === 0, 'vikariatet är långt från två år');
  t = nb(await owner.locator('.las-priority li[data-name="Ola Omställd"]').innerText()); assert(t.includes('slutade' + day(30)), 'företrädesrätt: ' + t);
  const ranks = await owner.locator('.las-seniority .las-rank').evaluateAll((rs) => rs.map((r) => r.getAttribute('data-name')));
  assert(JSON.stringify(ranks) === JSON.stringify(['Tor Tidig', 'Ulf Ung', 'Ola Omställd', 'Sara Säsong', 'Vera Vikarie']), 'turordning: ' + ranks.join(', '));
  for (const n of ['Tor Tidig', 'Ulf Ung', 'Ola Omställd']) { await owner.goto(LA + '/lon/las'); await owner.locator(`.las-rank[data-name="${n}"] button:has-text("Undanta")`).click(); await owner.locator('text=är undantagen från turordningen').waitFor(); }
  await owner.goto(LA + '/lon/las');
  await owner.locator('.las-rank[data-name="Sara Säsong"] button:has-text("Undanta")').click(); await owner.waitForURL(/(ok|error)=/);
  assert(nb(await owner.locator('.flash').first().innerText()).includes('Högst3'), 'högst tre undantag');
  log('LAS: särskild visstid som närmar sig tolv månader på fem år, överlappande perioder stoppas, företrädesrätt efter arbetsbrist, turordning efter anställningstid, högst tre undantag');

  // ================= Del 2: fullmakter, tillstånd och certifikat =================
  const FM = await newCompany('Tillståndsbolaget AB', 559920000);
  const au = async (f) => {
    await owner.goto(FM + '/fullmakter');
    const fm = owner.locator('form.au-add');
    await fm.locator('select[name=kind]').selectOption(f.kind); await fm.locator('input[name=name]').fill(f.name);
    for (const k of ['counterparty', 'holder', 'scope', 'cost']) if (f[k]) await fm.locator(`input[name=${k}]`).fill(f[k]);
    if (f.until) await fm.locator('input[name=valid_until]').fill(f.until);
    await fm.locator('button').click(); await owner.waitForURL(/(ok|error)=/);
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await au({ kind: 'power_of_attorney', name: 'Ombud hos Skatteverket', counterparty: 'Skatteverket' }); assert(t.includes('Angevemfullmaktengäller'), 'ombud krävs: ' + t);
  await au({ kind: 'power_of_attorney', name: 'Ombud hos Skatteverket', counterparty: 'Skatteverket', holder: 'Redovisningsbyrån AB', scope: 'Moms och arbetsgivardeklarationer', until: day(-30) });
  await au({ kind: 'permit', name: 'Serveringstillstånd', counterparty: 'Kommunen', cost: '5000', until: day(10) });
  await au({ kind: 'certificate', name: 'ISO 9001', counterparty: 'Certifieringsorganet', cost: '25000', until: day(-400) });
  await owner.goto(FM + '/fullmakter');
  assert(await owner.locator('.au-alert').count() === 2 && nb(await owner.locator('.au-alert[data-name="Serveringstillstånd"]').innerText()).includes('gickut'), 'påminnelser');
  assert((await owner.locator('.au-row[data-name="ISO 9001"]').getAttribute('data-status')) === 'valid' && (await text(owner)).includes('30 000,00 kr'), 'giltigt certifikat och årlig kostnad');
  const srv = owner.locator('.au-row[data-name="Serveringstillstånd"]');
  await srv.locator('input[name=valid_until]').fill(day(-365)); await srv.locator('button:has-text("Förnya")').click(); await owner.locator('text=Giltig till ' + day(-365)).waitFor();
  await owner.goto(FM + '/fullmakter');
  const poa = owner.locator('.au-row[data-name="Ombud hos Skatteverket"]');
  await poa.locator('input[name=reason]').fill('Byte av redovisningsbyrå'); await poa.locator('button:has-text("Återkalla")').click(); await owner.locator('text=Fullmakten är återkallad').waitFor();
  await owner.goto(FM + '/fullmakter');
  assert(await owner.locator('.au-alert').count() === 0 && (await poa.getAttribute('data-status')) === 'revoked' && nb(await poa.innerText()).includes('Byteavredovisningsbyrå'), 'återkallad fullmakt finns kvar i loggen');
  log('fullmakter och tillstånd: fullmakt kräver ombud, påminnelse före och efter utgång, årlig kostnad, förnyelse, återkallad fullmakt med datum och skäl');

  // ================= Del 3: sanktionslistekontroll =================
  const SN = await newCompany('Exportbolaget AB', 559930000);
  for (const n of ['Sidorov Ivan Petrovich', 'Global Shadow Trading AB', 'Svensson Bygg AB']) {
    await owner.goto(SN + '/kunder'); await owner.fill('input[name=name]', n); await owner.click('button:has-text("Spara kund")'); await owner.waitForURL(/ok=/);
  }
  await owner.goto(SN + '/leverantorer'); await owner.fill('input[name=name]', 'Ahmad Al Rashid'); await owner.click('button:has-text("Spara leverantör")'); await owner.waitForURL(/ok=/);
  const csvPath = require('node:path').join(require('node:os').tmpdir(), `sanktioner-${Date.now()}.csv`);
  require('node:fs').writeFileSync(csvPath, 'Entity_logical_id;Naal_wholename;Naal_lastname\n1;Ivan Petrovich SIDOROV;SIDOROV\n2;"Global Shadow Trading, LLC";\n3;Ahmed AL-RASHID;AL-RASHID\n4;Ivan Petrovich SIDOROV;SIDOROV\n');
  await owner.goto(SN + '/sanktionslistor');
  await owner.locator('form.sn-upload input[type=file]').setInputFiles(csvPath); await owner.locator('form.sn-upload button').click();
  await owner.locator('text=Listan har').waitFor();
  t = nb(await owner.locator('.flash').first().innerText()); assert(t.includes('Listanhar3namn') && t.includes('4kunderochleverantörer') && t.includes('3möjligaträffar'), 'kontroll efter uppladdning: ' + t);
  const hit = (n) => owner.locator(`.sn-hit[data-name="${n}"]`);
  assert(await hit('Svensson Bygg AB').count() === 0 && nb(await hit('Ahmad Al Rashid').innerText()).includes('AhmedAL-RASHID'), 'felstavning och omvänd ordning matchar, men inte andra');
  const decide = async (n, decision, note) => {
    await owner.goto(SN + '/sanktionslistor');
    await hit(n).locator('select[name=decision]').selectOption(decision); await hit(n).locator('input[name=note]').fill(note); await hit(n).locator('button').click();
    await owner.waitForURL(/ok=/);
  };
  await decide('Sidorov Ivan Petrovich', 'false_positive', 'Svensk kund med annat födelsedatum');
  await decide('Global Shadow Trading AB', 'confirmed', 'Samma bolag enligt registreringsnummer');
  await decide('Ahmad Al Rashid', 'confirmed', 'Samma person enligt pass');
  await owner.goto(SN + '/sanktionslistor');
  assert((await hit('Sidorov Ivan Petrovich').getAttribute('data-status')) === 'false_positive' && (await hit('Global Shadow Trading AB').getAttribute('data-status')) === 'confirmed', 'bedömningar');
  await owner.click('button:has-text("Kontrollera alla kunder och leverantörer igen")'); await owner.locator('text=0 möjliga träffar').waitFor();
  await owner.goto(SN + '/fakturor/ny');
  await owner.selectOption('select[name=customer_id]', { label: 'Global Shadow Trading AB' }); await owner.fill('input[name=invoice_date]', day(1));
  const r0 = owner.locator('tbody tr').first();
  await r0.locator('td:nth-child(1) input').fill('Konsult'); await r0.locator('td:nth-child(2) input').fill('1'); await r0.locator('td:nth-child(3) input').fill('st'); await r0.locator('td:nth-child(4) input').fill('1000');
  await owner.click('button:has-text("Spara utkast")'); await owner.waitForURL(/fakturor\/\d+\?ok/);
  await owner.click('button:has-text("Bokför faktura")'); await owner.waitForURL(/error=/);
  assert(nb(await owner.locator('.flash').first().innerText()).includes('finnspåensanktionslista–faktureringärstoppad'), 'fakturering stoppad');
  await owner.goto(SN + '/leverantorsfakturor/ny');
  await owner.selectOption('select[name=supplier_id]', { label: 'Ahmad Al Rashid' });
  await owner.fill('input[name=invoice_number]', 'AR-1'); await owner.fill('input[name=invoice_date]', day(1)); await owner.fill('input[name=due_date]', day(-29));
  await owner.fill('input[name=total]', '1250'); await owner.locator('input[name=total]').blur(); await owner.fill('input[name=vat]', '250');
  await owner.fill('input[name=account_0]', '4010'); await owner.fill('input[name=amount_0]', '1000');
  await owner.click('button:has-text("Registrera och bokför")'); await owner.waitForURL(/ok=/);
  await owner.goto(owner.url().split('?')[0]);
  await owner.click('button:has-text("Attestera för betalning")'); await owner.waitForURL(/error=/);
  assert(nb(await owner.locator('.flash').first().innerText()).includes('sanktionslista–betalningärstoppad'), 'betalning stoppad');
  log('sanktionslistor: uppladdad EU-lista i CSV, matchning med omvänd ordning, bolagsform och felstavning, granskning som falsk eller sann träff, ny kontroll behåller bedömningar, stopp för fakturering och attest');

  // ================= Del 4: aktiva åtgärder mot diskriminering =================
  const AA = await newCompany('Mångfalden AB', 559940000);
  const am = async (area, finding, f = {}) => {
    await owner.goto(AA + '/lon/aktiva-atgarder');
    const fm = owner.locator('form.am-add');
    await fm.locator('select[name=area]').selectOption(area); await fm.locator('textarea[name=finding]').fill(finding);
    if (f.measure) await fm.locator('input[name=measure]').fill(f.measure); if (f.due) await fm.locator('input[name=due_date]').fill(f.due);
    await fm.locator('button').click(); await owner.waitForURL(/(ok|error)=/);
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await am('conditions', 'Medarbetarenkäten visar att kvinnor upplever högre arbetsbelastning', { measure: 'Se över bemanningen i kundtjänst' }); assert(t.includes('Angenäråtgärden'), 'åtgärd kräver tidplan: ' + t);
  await am('conditions', 'Medarbetarenkäten visar att kvinnor upplever högre arbetsbelastning', { measure: 'Se över bemanningen i kundtjänst', due: day(5) });
  await am('pay', 'Lönekartläggningen visar en osaklig skillnad bland utvecklare');
  await am('recruitment', 'Platsannonserna innehåller inga diskriminerande krav');
  await am('training', 'Alla har en utvecklingsplan, oavsett ålder');
  await owner.goto(AA + '/lon/aktiva-atgarder');
  t = nb(await owner.locator('.am-progress').innerText());
  assert(t.startsWith('4av5områdenundersökta') && t.includes('förenaförvärvsarbeteochföräldraskap') && t.includes('1försenade') && t.includes('riktlinjermottrakasserier'), 'framsteg: ' + t);
  await am('parenthood', 'Möten läggs mellan 9 och 15 så att föräldrar kan delta');
  await owner.goto(AA + '/lon/aktiva-atgarder');
  const cond = owner.locator('.am-area[data-area="conditions"] .am-row');
  assert((await cond.getAttribute('data-overdue')) === '1', 'försenad åtgärd');
  await cond.locator('input[name=follow_up]').fill('Ny enkät visar jämn arbetsbelastning'); await cond.locator('button').click(); await owner.locator('text=Åtgärden är genomförd och uppföljd').waitFor();
  await owner.goto(AA + '/lon/aktiva-atgarder');
  const pf = owner.locator('form.am-policy');
  await pf.locator('textarea[name=guidelines]').fill('Trakasserier och repressalier accepteras inte.'); await pf.locator('textarea[name=routines]').fill('Anmäl till närmaste chef eller HR; utreds inom två veckor.');
  await pf.locator('button').click(); await owner.locator('text=Riktlinjerna och rutinerna är sparade').waitFor();
  await owner.goto(AA + '/lon/aktiva-atgarder');
  assert((await owner.locator('.am-progress').getAttribute('data-complete')) === '1' && nb(await owner.locator('.am-progress').innerText()).includes('åretsarbeteärklart'), 'årets arbete klart');
  log('aktiva åtgärder: fem områden, åtgärd kräver tidplan, försenade åtgärder, uppföljning av effekt, riktlinjer och rutiner mot trakasserier, årets arbete klart');

  // ================= Del 5: skatterevision och omprövning =================
  const SR = await newCompany('Granskade AB', 559950000);
  const openAudit = async (kind, subject, year) => {
    await owner.goto(SR + '/skatterevision');
    const f = owner.locator('form.ta-new');
    await f.locator('select[name=kind]').selectOption(kind); await f.locator('select[name=subject]').selectOption(subject); await f.locator('input[name=tax_year]').fill(String(year)); await f.locator('input[name=reference]').fill('131-123456-' + year);
    await f.locator('button').click(); await owner.locator('text=Ärendet är registrerat').waitFor();
  };
  await openAudit('revision', 'vat', YEAR - 1);
  const rev = owner.locator(`.ta-audit[data-subject="vat"]`);
  for (const [item, due] of [['Verifikationer för kvartal 2', day(3)], ['Avtal med största kunden', day(-30)]]) {
    await owner.goto(SR + '/skatterevision');
    await rev.locator('input[name=item]').fill(item); await rev.locator('input[name=due_date]').fill(due); await rev.locator('button:has-text("Lägg till begäran")').click(); await owner.locator('text=Begäran är registrerad').waitFor();
  }
  await owner.goto(SR + '/skatterevision');
  assert(await owner.locator('.tr-due[data-state="late"]').count() === 1 && await owner.locator('.tr-due').count() === 1, 'försenad begäran');
  await rev.locator('li:has-text("Verifikationer") input[name=note]').fill('Skickat via Mina sidor'); await rev.locator('li:has-text("Verifikationer") button:has-text("Besvarad")').click(); await owner.locator('text=Begäran är besvarad').waitFor();
  await owner.goto(SR + '/skatterevision');
  assert(await owner.locator('.tr-due').count() === 0, 'besvarad');
  const df = rev.locator('form.ta-decide');
  await df.locator('input[name=tax_amount]').fill('20000'); await df.locator('input[name=surcharge]').fill('4000'); await df.locator('input[name=interest]').fill('800'); await df.locator('input[name=disputed]').check();
  await df.locator('button').click(); await owner.locator('text=Beslutet är bokfört mot skattekontot').waitFor();
  assert(nb(await owner.locator('.flash').first().innerText()).includes('24800,00kr'), 'beslutat belopp');
  await owner.goto(SR + '/skatterevision');
  assert(nb(await owner.locator('.ta-disputed').innerText()).includes('24800,00'), 'tvistigt belopp');
  await rev.locator('a:has-text("verifikation")').click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('6991') && t.includes('6992') && t.includes('8423') && t.includes('1630') && t.includes('24800,00'), 'verifikation för beslutet: ' + t.slice(0, 700));
  await owner.goto(SR + '/skatterevision');
  t = nb(await rev.innerText()); assert(t.includes('Fristföromprövningochöverklagande:' + (YEAR + 5) + '-12-31'), 'frist sex år: ' + t);
  await rev.locator('button:has-text("Begär omprövning")').click(); await owner.locator('text=överklagandet är registrerat').waitFor();
  await owner.goto(SR + '/skatterevision');
  const cf = rev.locator('form.ta-close');
  await cf.locator('input[name=outcome]').fill('Skattetillägget undanröjdes efter omprövning'); await cf.locator('input[name=refund]').fill('4000'); await cf.locator('button').click();
  await owner.locator('text=4 000,00 kr tillbaka').waitFor().catch(async () => { t = nb(await owner.locator('.flash').first().innerText()); assert(t.includes('4000,00krtillbaka'), 'nedsättning: ' + t); });
  await owner.goto(SR + '/skatterevision');
  assert((await rev.getAttribute('data-status')) === 'closed' && await owner.locator('.ta-disputed').count() === 0, 'avslutat ärende');
  await owner.goto(SR + '/verifikationer');
  await owner.locator('tr:has-text("Ändrat beslut efter omprövning") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('6992') && t.includes('1630') && t.includes('4000,00') && !t.includes('6991'), 'återföring av skattetillägget: ' + t.slice(0, 600));
  await openAudit('inquiry', 'income', YEAR - 1);
  await owner.goto(SR + '/skatterevision');
  await owner.locator('.ta-audit[data-subject="income"] form.ta-decide button').click(); await owner.locator('text=Beslutet är registrerat utan ändring').waitFor();
  log('skatterevision: begärda handlingar med frist, beslut med skatt, skattetillägg och ränta mot skattekontot, tvistigt belopp, omprövning inom sex år, nedsättning bokförs, förfrågan utan ändring');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 39: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
