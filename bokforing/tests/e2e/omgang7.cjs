// End-to-end, omgång 7: integrationer och status, AI som bokför, mobilen (dela till appen, genvägar), byråns månadsbokslut,
// systemdokumentation, integritetskontroll och arkivpaket.
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

  // ================= Del 1: integrationer och status =================
  await owner.goto(BASE + '/drift/installningar');
  t = await text(owner);
  assert(t.includes('Integrationer') && t.includes('E-post (Resend)') && t.includes('Saknade variabler') && t.includes('MAIL_FROM') && t.includes('Pushnotiser'), 'integrationssidan: ' + t.slice(0, 800));
  assert(!/sk_test_x|whsec_|re_test/.test(await owner.content()), 'inga nyckelvärden visas');
  await owner.locator('section#push button:has-text("Testa")').click();
  await owner.waitForURL(/(ok|error)=/);
  assert(decodeURIComponent(owner.url()).includes('enhet'), 'test av pushnotiser: ' + owner.url());
  await owner.locator('section#stripe button:has-text("Testa")').click();
  await owner.waitForURL((u) => /Stripe|Fel/.test(decodeURIComponent(u.href)));
  const anonOps = await (await browser.newContext()).newPage();
  assert((await anonOps.goto(BASE + '/drift/installningar')).url().includes('/login'), 'kräver inloggning');
  log('integrationssidan visar vad som saknas (utan nyckelvärden) och kan testa det som är uppsatt');

  await owner.goto(B + '/installningar/status');
  t = await text(owner);
  assert(t.includes('Kopplingar och status') && t.includes('Bankgiro för betalningar') && t.includes('E-post till kunder') && t.includes('Notiser i din mobil'), 'bolagets status: ' + t.slice(0, 800));
  assert(t.includes('E-post är inte uppsatt i tjänsten än'), 'avstängd tjänst förklaras');
  log('bolagets kopplingar och status med länk dit man fixar det som saknas');

  // ================= Del 2: AI som bokför (fejkad Claude på localhost:3304) =================
  const claudeAsks = [];
  const claude = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const j = JSON.parse(body);
      const sys = JSON.stringify(j.system);
      claudeAsks.push(sys.slice(0, 60));
      const out = sys.includes('Användaren beskriver med egna ord')
        ? { date: null, description: 'Parkering', lines: [{ account: 5611, debit: 360, credit: 0, description: null }, { account: 2641, debit: 90, credit: 0, description: null }, { account: 1930, debit: 0, credit: 450, description: null }], explanation: 'Parkering hos ett privat bolag: kostnad på 5611 och 25 % moms, betalt från företagskontot.', confidence: 'high' }
        : { account: 6570, vat_rate: 0, description: 'Bankavgift', reason: 'Texten ser ut som en avgift från banken.' };
      res.writeHead(200, { 'Content-Type': 'application/json', 'request-id': 'req_a' });
      res.end(JSON.stringify({ id: 'msg_a', type: 'message', role: 'assistant', model: j.model, stop_sequence: null, usage: { input_tokens: 500, output_tokens: 60 }, content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn' }));
    });
  }).listen(3304);

  await owner.goto(B + '/verifikationer/ny');
  await owner.fill('textarea[name=text]', 'Betalade 450 kr för parkering med företagskortet');
  await owner.click('button:has-text("Föreslå verifikation")');
  await owner.waitForURL(/ai=\d+/);
  t = await text(owner);
  assert(t.includes('Du skrev: ”Betalade 450 kr för parkering') && t.includes('Parkering hos ett privat bolag') && t.includes('Inget är bokfört än'), 'förslaget visas: ' + t.slice(0, 700));
  const rows = owner.locator('tbody tr');
  const vals = []; for (let i = 0; i < await rows.count(); i++) vals.push(await rows.nth(i).locator('input').nth(0).inputValue().catch(() => '-'));
  assert(await rows.nth(0).locator('input').nth(0).inputValue() === '5611' && await rows.nth(1).locator('input').nth(0).inputValue() === '2641' && await rows.nth(2).locator('input').nth(0).inputValue() === '1930', 'raderna ifyllda: ' + vals.join(',') + ' ' + t.slice(0, 900));
  assert(await owner.inputValue('input[name=description]') === 'Parkering', 'beskrivningen ifylld');
  await owner.click('button:text-is("Bokför")');
  await owner.waitForURL(/verifikationer\/\d+(\?|$)/);
  log('beskriv med egna ord: AI föreslår verifikationen med konton och moms, användaren bokför');

  // En banktransaktion som varken regler eller tidigare konteringar känner igen
  const OUT = process.argv[2] || require('node:os').tmpdir();
  const csv = require('node:path').join(OUT, 'okand.csv');
  require('node:fs').writeFileSync(csv, `Datum;Belopp;Text\n${new Date().toISOString().slice(0, 10)};-123,45;ZQX Lumbago 7781\n`);
  await owner.goto(B + '/bank');
  await owner.setInputFiles('form:has(button:has-text("Importera")) input[type=file] >> nth=0', csv);
  await owner.locator('form:has(button:has-text("Importera")) button >> nth=0').click();
  await owner.waitForURL(/ok=|error=/);
  await owner.goto(B + '/bank/avstamning');
  const card = owner.locator('.card[id^=t]:has-text("ZQX Lumbago")');
  if (!(await card.count())) throw new Error('importen: ' + decodeURIComponent(owner.url()) + ' ' + (await text(owner)).slice(0, 600));
  if (!(await card.locator('button:has-text("Föreslå konto med AI")').count())) throw new Error('kortet: ' + (await card.innerText()).slice(0, 800));
  await card.locator('button:has-text("Föreslå konto med AI")').click();
  await owner.waitForURL(/ok=/);
  const card2 = owner.locator('.card[id^=t]:has-text("ZQX Lumbago")');
  assert((await card2.innerText()).includes('6570') && (await card2.innerText()).includes('avgift från banken'), 'AI-förslag med förklaring: ' + (await card2.innerText()).slice(0, 400));
  await card2.locator('form:has(.badge:has-text("AI")) button:has-text("Bokför")').click();
  await owner.locator('.card[id^=t]:has-text("ZQX Lumbago")').waitFor({ state: 'detached', timeout: 20000 });
  log('okänd banktransaktion: AI föreslår konto med förklaring och den bokförs med ett klick');
  claude.close();

  await browser.close();
  console.log('Omgång 7: alla steg gick igenom');
})().catch((e) => { console.error('✘', e.message, (e.stack || '').split('\n').find((l) => l.includes('omgang7.cjs'))); process.exit(1); });
