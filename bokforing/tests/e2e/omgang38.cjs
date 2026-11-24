// E2E omgång 38: arbetsmiljö, dataskydd, lönerevision och lönekartläggning, internkontroll, räntesäkring
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

  // ================= Del 1: arbetsmiljö =================
  const AM = await newCompany('Lagerarbete AB', 559810000);
  await owner.goto(AM + '/lon/anstallda');
  await owner.fill('input[name=first_name]', 'Olle'); await owner.fill('input[name=last_name]', 'Olycka');
  await owner.fill('input[name=personal_number]', '19' + orgnrFor('880808123')); await owner.fill('input[name=monthly_salary]', '30000'); await owner.fill('input[name=tax_table]', '32');
  await owner.fill('input[name=employment_start]', `${YEAR - 2}-01-01`);
  await owner.click('form:has(input[name=first_name]) button:has-text("Spara")'); await owner.waitForURL(/ok=/);
  const risk = async (area, hazard, p, c, f = {}) => {
    await owner.goto(AM + '/arbetsmiljo');
    const fm = owner.locator('form.we-add-risk');
    await fm.locator('input[name=area]').fill(area); await fm.locator('input[name=hazard]').fill(hazard); await fm.locator('input[name=probability]').fill(p); await fm.locator('input[name=consequence]').fill(c);
    if (f.measure) await fm.locator('input[name=measure]').fill(f.measure); if (f.owner) await fm.locator('input[name=owner]').fill(f.owner); if (f.due) await fm.locator('input[name=due_date]').fill(f.due);
    await fm.locator('button').click(); await owner.locator('text=Riskbedömningen är sparad').waitFor();
  };
  await risk('Kontor', 'Stillasittande', '2', '2');
  await risk('Lager', 'Fallande gods från hyllor', '4', '4', { measure: 'Säkra hyllorna', owner: 'Lagerchefen', due: day(5) });
  await owner.goto(AM + '/arbetsmiljo');
  const hyllor = owner.locator('.we-risk[data-hazard="Fallande gods från hyllor"]');
  assert((await hyllor.getAttribute('data-level')) === 'high' && nb(await hyllor.innerText()).includes('16(Hög)') && await hyllor.locator('.we-late').count() === 1, 'hög risk med försenad åtgärd');
  assert((await owner.locator('.we-risk').first().getAttribute('data-hazard')) === 'Fallande gods från hyllor', 'högst risk först');
  const incident = async (kind, desc, f = {}) => {
    await owner.goto(AM + '/arbetsmiljo');
    const fm = owner.locator('form.we-add-incident');
    await fm.locator('input[name=date]').fill(f.date ?? day(2)); await fm.locator('select[name=kind]').selectOption(kind); await fm.locator('input[name=description]').fill(desc);
    if (f.emp) await fm.locator('select[name=employee_id]').selectOption({ label: f.emp }); if (f.days) await fm.locator('input[name=days_absent]').fill(f.days);
    await fm.locator('button').click(); await owner.locator('text=Händelsen är registrerad').waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await incident('near_miss', 'Pall nära att välta'); assert(!t.includes('Anmäl'), 'tillbud utan anmälningsplikt: ' + t);
  t = await incident('serious', 'Truck körde på fot', { emp: 'Olle Olycka', days: '10' }); assert(t.includes('ArbetsmiljöverketutandröjsmålocharbetsskadantillFörsäkringskassan'), 'anmälningsplikt: ' + t);
  await owner.goto(AM + '/arbetsmiljo');
  t = nb(await owner.locator('.we-alert').innerText()); assert(t.includes('anmältillArbetsmiljöverket(försenad)') && t.includes('Försäkringskassan') && !t.includes('Försäkringskassan(försenad)'), 'saknade anmälningar: ' + t);
  assert(nb(await owner.locator('.we-stats').innerText()).includes('tillbud1') && nb(await owner.locator('.we-stats').innerText()).includes('sjukdagar10'), 'statistik');
  const serious = owner.locator('.we-incident[data-kind="serious"]');
  await serious.locator('button:has-text("Arbetsmiljöverket")').click(); await owner.locator('text=Anmälan till Arbetsmiljöverket är registrerad').waitFor();
  await owner.goto(AM + '/arbetsmiljo');
  assert(await owner.locator('.we-alert').count() === 1 && !nb(await owner.locator('.we-alert').innerText()).includes('Arbetsmiljöverket'), 'bara Försäkringskassan kvar');
  await serious.locator('button:has-text("Försäkringskassan")').click(); await owner.locator('text=Anmälan till Försäkringskassan är registrerad').waitFor();
  await owner.goto(AM + '/arbetsmiljo');
  assert(await owner.locator('.we-alert').count() === 0, 'alla anmälningar gjorda');
  await hyllor.locator('button:has-text("Genomförd")').click(); await owner.locator('text=Åtgärden är genomförd').waitFor();
  await owner.goto(AM + '/arbetsmiljo');
  const rv = owner.locator('form.we-review');
  for (const cb of await rv.locator('input[type=checkbox]').all()) await cb.check();
  await rv.locator('button').click(); await owner.locator('text=Årets uppföljning är klar').waitFor();
  await owner.goto(AM + '/arbetsmiljo');
  assert(nb(await owner.locator('.we-progress').innerText()).startsWith('9av9punkter·klar'), 'uppföljningen klar');
  log('arbetsmiljö: riskbedömning med riskvärde, handlingsplan med försenade åtgärder, tillbud och allvarlig olycka med anmälningsplikt till Arbetsmiljöverket och Försäkringskassan, årlig uppföljning');

  // ================= Del 2: dataskydd =================
  const DS = await newCompany('Personuppgifter AB', 559820000);
  const act = async (f) => {
    await owner.goto(DS + '/dataskydd');
    const fm = owner.locator('form.dp-add-activity');
    for (const k of ['name', 'subjects', 'categories', 'purpose', 'retention']) if (f[k]) await fm.locator(`input[name=${k}]`).fill(f[k]);
    await fm.locator('select[name=legal_basis]').selectOption(f.basis); if (f.sensitive) await fm.locator('input[name=sensitive]').check();
    await fm.locator('button').click(); await owner.waitForURL(/(ok|error)=/);
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await act({ name: 'Kameraövervakning', subjects: 'Besökare och anställda', categories: 'Bild och film', purpose: 'Brottsförebyggande', basis: 'legitimate', retention: '30 dagar' }); assert(t.includes('Behandlingenärtillagd'), 'behandling: ' + t);
  t = await act({ name: 'Hälsodeklarationer', subjects: 'Anställda', categories: 'Hälsa', basis: 'legitimate', sensitive: true }); assert(t.includes('Känsligapersonuppgifterkaninte'), 'känsliga uppgifter kräver annan grund: ' + t);
  await owner.goto(DS + '/dataskydd');
  assert(nb(await owner.locator('.dp-activities tr[data-name="Kameraövervakning"]').innerText()).includes('Berättigatintresse(art.6.1f)'), 'registret');
  const inc = async (f) => {
    await owner.goto(DS + '/dataskydd');
    const fm = owner.locator('form.dp-add-incident');
    if (f.at) await fm.locator('input[name=discovered_at]').fill(f.at);
    await fm.locator('input[name=description]').fill(f.desc); await fm.locator('select[name=risk]').selectOption(f.risk);
    if (f.count) await fm.locator('input[name=subjects_count]').fill(f.count); if (f.measures) await fm.locator('input[name=measures]').fill(f.measures);
    await fm.locator('button').click(); await owner.locator('text=Incidenten är registrerad').waitFor();
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await inc({ desc: 'Faktura skickad till fel kund', risk: 'none', measures: 'Mottagaren har raderat fakturan' }); assert(t.includes('behöverinteanmälas'), 'ingen anmälan: ' + t);
  await owner.goto(DS + '/dataskydd');
  await owner.locator('.dp-incident[data-risk="none"] button:has-text("Avsluta incidenten")').click(); await owner.locator('text=Incidenten är avslutad').waitFor();
  const at80 = new Date(Date.now() - 80 * 3600e3).toISOString().slice(0, 16);
  t = await inc({ at: at80, desc: 'Stulen dator med lönelistor', risk: 'high', count: '25' }); assert(t.includes('AnmäldentillIMYinom72timmar') && t.includes('informeraderegistrerade'), 'hög risk: ' + t);
  await inc({ desc: 'E-post med kundlista skickad fel', risk: 'risk', count: '40' });
  await owner.goto(DS + '/dataskydd');
  const high = owner.locator('.dp-incident[data-risk="high"]');
  assert(await owner.locator('.dp-alert[data-late="1"]').count() === 1 && await owner.locator('.dp-alert[data-late="0"]').count() === 1, 'en försenad och en inom fristen');
  assert(nb(await owner.locator('.dp-alert[data-late="0"]').innerText()).match(/\((71|72)timmarkvar\)/), 'timmar kvar: ' + nb(await owner.locator('.dp-alert[data-late="0"]').innerText()));
  t = nb(await high.locator('.dp-blockers').innerText()); assert(t.includes('åtgärder') && t.includes('anmälantillIMY') && t.includes('informationtillderegistrerade'), 'saknas för att avsluta: ' + t);
  const up = high.locator('form.dp-update');
  await up.locator('input[name=measures]').fill('Fjärrlåst datorn och bytt lösenord'); await up.locator('input[name=reported_imy]').check(); await up.locator('input[name=imy_ref]').fill('IMY-2026-123');
  await up.locator('input[name=late_reason]').fill('Stölden upptäcktes en fredag och utreddes över helgen'); await up.locator('input[name=informed]').check();
  await up.locator('button').click(); await owner.locator('text=Incidenten är uppdaterad').waitFor();
  await owner.goto(DS + '/dataskydd');
  assert(nb(await high.locator('.dp-status').innerText()).includes('(IMY-2026-123)') && nb(await high.locator('.dp-status').innerText()).includes('Deregistreradeinformerade'), 'anmäld och informerad');
  await high.locator('button:has-text("Avsluta incidenten")').click(); await owner.locator('text=Incidenten är avslutad').waitFor();
  await owner.goto(DS + '/dataskydd');
  assert((await high.getAttribute('data-closed')) === '1' && await owner.locator('.dp-alert').count() === 1, 'bara den öppna incidenten kvar');
  log('dataskydd: egna behandlingar i registret, känsliga uppgifter kräver undantag, incidenter med riskbedömning, 72-timmarsfristen till IMY, försenad anmälan med skäl, information till de registrerade, avslut');

  // ================= Del 3: lönekartläggning (lika och likvärdigt arbete) =================
  const LR = await newCompany('Lönebolaget AB', 559830000);
  await owner.goto(LR + '/moduler');
  await owner.locator('.card:has(h2:text-is("Lönerevision")) button:has-text("Aktivera")').click(); await owner.waitForURL(/ok=/);
  const staff = [['Anna', 'Ek', '900101124', '40000', 'Utvecklare', '4'], ['Eva', 'Ås', '910303128', '42000', 'Utvecklare', '4'], ['Bo', 'Björk', '850505133', '44000', 'Utvecklare', '4'], ['Dan', 'Dahl', '860606135', '46000', 'Utvecklare', '4'], ['Cia', 'Gran', '920202126', '30000', 'Ekonom', '3']];
  for (const [fn, ln, p9, sal] of staff) {
    await owner.goto(LR + '/lon/anstallda');
    await owner.fill('input[name=first_name]', fn); await owner.fill('input[name=last_name]', ln);
    await owner.fill('input[name=personal_number]', '19' + orgnrFor(p9)); await owner.fill('input[name=monthly_salary]', sal); await owner.fill('input[name=tax_table]', '32');
    await owner.fill('input[name=employment_start]', `${YEAR - 3}-01-01`);
    await owner.click('form:has(input[name=first_name]) button:has-text("Spara")'); await owner.waitForURL(/ok=/);
  }
  const KM = LR + '/m/lonerevision/kartlaggning';
  for (const [fn, ln, , , title, level] of staff) {
    await owner.goto(KM);
    const f = owner.locator(`.ps-emp[data-name="${fn} ${ln}"] form`);
    await f.locator('input[name=title]').fill(title); await f.locator('select[name=job_level]').selectOption(level);
    await f.locator('button').click(); await owner.locator('text=Kravnivån är sparad').waitFor();
  }
  await owner.goto(KM);
  const dev = owner.locator('.ps-equal .ps-group[data-key="Utvecklare"]');
  assert((await dev.getAttribute('data-flag')) === '1' && nb(await dev.innerText()).includes('91,1%'), 'lika arbete: ' + nb(await dev.innerText()));
  assert((await owner.locator('.ps-equal .ps-group[data-key="Ekonom"]').getAttribute('data-flag')) === '0', 'ingen jämförelse utan båda könen');
  const lvl = owner.locator('.ps-equivalent .ps-group[data-key="Kravnivå 4"]');
  assert((await lvl.getAttribute('data-flag')) === '1' && nb(await owner.locator('.ps-open').innerText()).startsWith('2skillnader'), 'likvärdigt arbete och öppna analyser');
  const analyse = async (row, objective, cause, action, due) => {
    await owner.goto(KM);
    const f = row.locator('form');
    await f.locator('select[name=objective]').selectOption(objective); await f.locator('input[name=cause]').fill(cause);
    if (action) await f.locator('input[name=action]').fill(action); if (due) await f.locator('input[name=due_date]').fill(due);
    await f.locator('button').click(); await owner.waitForURL(/(ok|error)=/);
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await analyse(dev, 'no', 'Ingen saklig förklaring'); assert(t.includes('kräverenåtgärd'), 'osaklig skillnad kräver åtgärd: ' + t);
  t = await analyse(dev, 'no', 'Ingen saklig förklaring', 'Höj kvinnornas löner i nästa revision', day(-200)); assert(t.includes('medåtgärdochtidplan'), 'åtgärd: ' + t);
  t = await analyse(lvl, 'yes', 'Männen har längre erfarenhet i yrket'); assert(t.includes('sakligförklaring'), 'saklig: ' + t);
  await owner.goto(KM);
  assert(await owner.locator('.ps-open').count() === 0 && nb(await dev.locator('.ps-analysis').innerText()).includes('Osaklig:') && nb(await lvl.locator('.ps-analysis').innerText()).startsWith('Saklig:'), 'analyserna är dokumenterade');
  log('lönekartläggning: lika arbete per befattning och likvärdigt arbete per kravnivå, flaggade skillnader, analys med saklig orsak eller åtgärd och tidplan');

  // ================= Del 4: internkontroll och riskregister =================
  const IK = await newCompany('Kontrollerat AB', 559840000);
  const ym = (back) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1)).toISOString().slice(0, 7); };
  const icRisk = async (area, desc, l, i) => {
    await owner.goto(IK + '/internkontroll');
    const fm = owner.locator('form.ic-add-risk');
    await fm.locator('input[name=area]').fill(area); await fm.locator('input[name=description]').fill(desc); await fm.locator('input[name=likelihood]').fill(l); await fm.locator('input[name=impact]').fill(i);
    await fm.locator('button').click(); await owner.locator('text=Risken är tillagd').waitFor();
  };
  await icRisk('Lager', 'Svinn', '2', '2');
  await icRisk('Betalningar', 'Felaktiga utbetalningar till bedragare', '3', '5');
  await owner.goto(IK + '/internkontroll');
  assert(nb(await owner.locator('.ic-matrix td[data-cell="3-5"]').innerText()) === '1' && nb(await owner.locator('.ic-uncovered').innerText()) === '1', 'riskmatris och okontrollerad risk');
  assert((await owner.locator('.ic-risk').first().getAttribute('data-level')) === 'high', 'högst risk först');
  const cf = owner.locator('form.ic-add-control');
  await cf.locator('input[name=name]').fill('Attest av leverantörsbetalningar'); await cf.locator('select[name=kind]').selectOption('attest'); await cf.locator('select[name=frequency]').selectOption('monthly');
  await cf.locator('select[name=risk_id]').selectOption({ label: 'Felaktiga utbetalningar till bedragare' }); await cf.locator('input[name=owner]').fill('Ekonomichefen'); await cf.locator('input[name=start_period]').fill(ym(2));
  await cf.locator('button').click(); await owner.locator('text=Kontrollen är tillagd').waitFor();
  await owner.goto(IK + '/internkontroll');
  const ctl = owner.locator('.ic-control[data-name="Attest av leverantörsbetalningar"]');
  assert((await ctl.getAttribute('data-missing')) === '1' && nb(await ctl.locator('.ic-late').innerText()).includes(ym(1)) && nb(await owner.locator('.ic-uncovered').innerText()) === '0', 'kontrollen saknas för förra månaden');
  const run = async (period, result, dev) => {
    await owner.goto(IK + '/internkontroll');
    const fm = ctl.locator('form');
    await fm.locator('input[name=period]').fill(period); await fm.locator('select[name=result]').selectOption(result); if (dev) await fm.locator('input[name=deviation]').fill(dev);
    await fm.locator('button').click(); await owner.waitForURL(/(ok|error)=/);
    return nb(await owner.locator('.flash').first().innerText());
  };
  t = await run(ym(1), 'ok'); assert(t.includes('utfördutanavvikelse'), 'utförd: ' + t);
  t = await run(ym(0), 'deviation'); assert(t.includes('Beskrivavvikelsen'), 'avvikelse kräver beskrivning: ' + t);
  t = await run(ym(0), 'deviation', 'En betalning saknade attest'); assert(t.includes('avvikelsenärdokumenterad'), 'avvikelse: ' + t);
  t = await run(ym(0), 'ok'); assert(t.includes('redanutförd'), 'en gång per period: ' + t);
  t = await run(ym(-1), 'ok'); assert(t.includes('Periodenharintebörjat'), 'framtida period: ' + t);
  await owner.goto(IK + '/internkontroll');
  assert((await ctl.getAttribute('data-missing')) === '0' && nb(await owner.locator('.ic-deviations').innerText()) === '1' && nb(await owner.locator('.ic-missing').innerText()) === '0', 'sammanställning: ' + nb(await owner.locator('.ic-summary').innerText()));
  assert(nb(await ctl.locator('.ic-runs').innerText()).includes('avvikelse–Enbetalningsaknadeattest'), 'loggen');
  log('internkontroll: riskregister med riskmatris, kontroller kopplade till risker, saknade kontroller för senaste perioden, avvikelser med beskrivning, en kontroll per period, sammanställning');

  // ================= Del 5: räntesäkring (ränteswappar) =================
  const RS = await newCompany('Fastighetsbolaget AB', 559850000);
  const n0 = new Date();
  const swStart = iso(new Date(Date.UTC(n0.getUTCFullYear(), n0.getUTCMonth() - 4, Math.min(n0.getUTCDate(), 28))));
  const swP1End = iso(new Date(Date.UTC(n0.getUTCFullYear(), n0.getUTCMonth() - 1, Math.min(n0.getUTCDate(), 28))));
  if (Number(swP1End.slice(0, 4)) < YEAR) await addFy(RS, YEAR - 1);
  await owner.goto(RS + '/finansiering');
  await owner.fill('input[name=name]', 'Fastighetslån'); await owner.fill('input[name=lender]', 'Banken'); await owner.fill('input[name=principal]', '1000000');
  await owner.fill('form:has(input[name=principal]) input[name=rate_pct]', '5,2'); await owner.fill('input[name=months]', '60');
  await owner.fill('input[name=first_date]', day(-30)); await owner.fill('input[name=loan_account]', '2350'); await owner.fill('input[name=disbursed_on]', day(1));
  await owner.click('button:has-text("Lägg upp lånet")'); await owner.locator('text=Lånet är upplagt med amorteringsplan').waitFor();
  await owner.goto(RS + '/ranteswappar');
  const sf = owner.locator('form.sw-add');
  await sf.locator('input[name=counterparty]').fill('Banken'); await sf.locator('select[name=loan_id]').selectOption({ index: 1 }); await sf.locator('input[name=notional]').fill('1000000');
  await sf.locator('input[name=fixed_rate]').fill('3'); await sf.locator('input[name=start_date]').fill(swStart); await sf.locator('input[name=end_date]').fill(day(-1800));
  await sf.locator('button').click(); await owner.locator('text=Ränteswappen är registrerad').waitFor();
  const sw = owner.locator('.sw-swap[data-counterparty="Banken"]');
  const settleSw = async (fix) => {
    await owner.goto(RS + '/ranteswappar');
    await sw.locator('form.sw-settle input[name=floating_rate]').fill(fix); await sw.locator('form.sw-settle button').click(); await owner.waitForURL(/(ok|error)=/);
    return nb(await owner.locator('.flash').first().innerText());
  };
  const d1 = Math.round((Date.parse(swP1End) - Date.parse(swStart)) / 864e5);
  const exp = (Math.round(100000000 * 0.01 * d1 / 360) / 100).toFixed(2).replace('.', ',');
  t = await settleSw('4'); assert(t.includes(`bolagetfår${exp}kr`) && t.includes('minskarräntekostnaden'), `avräkning (${d1} dagar, väntat ${exp}): ` + t);
  t = await settleSw('4,1'); assert(t.includes('inteslutän'), 'nästa period är inte slut: ' + t);
  await owner.goto(RS + '/ranteswappar');
  assert(nb(await sw.locator('.sw-effective').innerText()) === '4,2%' && nb(await sw.locator('.sw-net').innerText()) === exp, 'effektiv ränta och netto: ' + nb(await sw.locator('.sw-figures').innerText()));
  await sw.locator('form.sw-value input[name=market_value]').fill('-12500'); await sw.locator('form.sw-value button').click(); await owner.locator('text=är sparat för upplysningen').waitFor();
  await owner.goto(RS + '/ranteswappar');
  t = nb(await sw.locator('.sw-note').innerText()); assert(t.includes('betalarfastränta3%') && t.includes(`Verkligtvärdeper${YEAR}-12-31uppgicktill-12500,00kr`), 'upplysning: ' + t);
  await owner.goto(RS + '/verifikationer');
  await owner.locator('tr:has-text("Ränteswap Banken") a').first().click(); await owner.waitForURL(/verifikationer\/\d+/);
  t = nb(await text(owner)); assert(t.includes('1930') && t.includes('8410') && t.includes(exp), 'verifikation 1930/8410: ' + t.slice(0, 500));
  log('räntesäkring: ränteswap kopplad till lån, avräkning per period mot räntekostnaden, ej avslutad period stoppas, effektiv ränta efter säkring, marknadsvärde som upplysning');

  //@@NEXT@@
  await browser.close(); mailServer.close(); viesServer.close();
  console.log('Omgång 38: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
