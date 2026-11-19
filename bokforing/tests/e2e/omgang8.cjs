// End-to-end, omgång 8: inlämning till myndigheter, Peppol, lön på djupet, kassor och utbetalningar, valuta och koncern.
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


// Fejkad Skatteverket: OAuth-token, inlämning och status
const skv = { got: [] };
const skvServer = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.url === '/oauth/token') return req.headers.authorization === 'Basic ' + Buffer.from('skv-test:skv-secret').toString('base64') ? send(200, { access_token: 'tok-1' }) : send(401, {});
    if (req.headers.authorization !== 'Bearer tok-1') return send(401, {});
    if (req.method === 'POST' && req.url === '/moms/v1/deklarationer') { skv.got.push({ kind: 'moms', ...JSON.parse(b) }); return send(201, { id: 'M-77', status: 'mottagen' }); }
    if (req.method === 'GET' && req.url === '/moms/v1/deklarationer/M-77') return send(200, { id: 'M-77', status: 'godkänd', kvittensnummer: 'SKV-MOMS-4711' });
    if (req.method === 'POST' && req.url === '/agi/v1/deklarationer') { skv.got.push({ kind: 'agi', ...JSON.parse(b) }); return send(201, { id: 'A-9', status: 'godkänd', kvittensnummer: 'SKV-AGI-0815' }); }
    send(404, {});
  });
}).listen(3308);

(async () => {
  const browser = await chromium.launch();
  const owner = await login(browser, 'agare@example.com', 'hemligtlosen1');
  const B = `${BASE}/c/1`;
  let t;
  const flash = async (p) => { await p.locator('.flash, [role=status], [role=alert]').first().waitFor(); return text(p); };

  // Senast avslutade kvartal (deadlinen syns då som kommande eller försenad)
  const now = new Date(); let qy = now.getUTCFullYear(), qn = Math.floor(now.getUTCMonth() / 3); if (qn === 0) { qn = 4; qy--; }
  const qFrom = `${qy}-${String(qn * 3 - 2).padStart(2, '0')}-01`, qTo = iso(new Date(Date.UTC(qy, qn * 3, 0)));
  // ================= Del 1: inlämning till Skatteverket och Bolagsverket =================
  await owner.goto(`${B}/rapporter/moms?from=${qFrom}&to=${qTo}`);
  await owner.click('button:has-text("Förbered momsdeklaration")');
  await owner.waitForURL(/\/inlamning\?/);
  t = await flash(owner);
  assert(t.includes('Momsdeklaration') && t.includes('Förberedd') && t.includes('Direktinlämning är uppsatt för Skatteverket'), 'momsdeklaration förberedd: ' + t.slice(0, 600));
  const eskd = await owner.request.get(BASE + (await owner.locator(`a:has-text("moms_${qTo.slice(0, 7)}")`).getAttribute('href')));
  assert(eskd.status() === 200 && /iso-8859-1/i.test(eskd.headers()['content-type']), 'eSKD-fil: ' + eskd.status());
  const eskdText = (await eskd.body()).toString('latin1');
  assert(eskdText.includes(`<Period>${qTo.slice(0, 4)}${qTo.slice(5, 7)}</Period>`) && eskdText.includes('<OrgNr>16556026-9986</OrgNr>') && eskdText.includes('<MomsBetala>'), 'eSKD-innehåll: ' + eskdText.slice(0, 400));
  log('momsdeklaration förbereds som eSKD-fil från momsrapporten');

  await owner.click('section.filing:has-text("Momsdeklaration") button:has-text("Lämna in direkt")');
  await owner.locator('section.filing:has-text("Momsdeklaration") .badge:has-text("väntar på besked")').waitFor();
  t = await flash(owner);
  assert(t.includes('väntar på besked'), 'inlämnad moms: ' + t.slice(0, 400));
  assert(skv.got[0]?.kind === 'moms' && skv.got[0].organisationsnummer === '5560269986' && Buffer.from(skv.got[0].innehall, 'base64').toString('latin1') === eskdText, 'Skatteverket fick filen');
  await owner.click('section.filing:has-text("Momsdeklaration") button:has-text("Hämta status")');
  await owner.locator('section.filing:has-text("Momsdeklaration") .badge:has-text("Godkänd")').waitFor();
  t = await text(owner);
  assert(t.includes('SKV-MOMS-4711'), 'kvittens: ' + t.slice(0, 600));
  log('momsdeklaration lämnas in direkt, status hämtas, kvittens sparas och deadlinen bockas av');

  await owner.goto(`${B}/rapporter/moms?from=${qFrom}&to=${qTo}`);
  await owner.click('button:has-text("Förbered momsdeklaration")');
  await owner.waitForURL(/error=/);
  assert(decodeURIComponent(owner.url()).includes('redan inlämnad'), 'samma period kan inte lämnas igen: ' + owner.url());
  log('en redan inlämnad period kan inte lämnas in igen');

  await owner.goto(B + '/lon/1');
  await owner.click('button:has-text("Förbered AGI")');
  await owner.waitForURL(/\/inlamning\?/);
  await owner.click('section.filing:has-text("Arbetsgivardeklaration") button:has-text("Lämna in direkt")');
  await owner.locator('section.filing:has-text("Arbetsgivardeklaration") .badge:has-text("Godkänd")').waitFor();
  t = await text(owner);
  assert(t.includes('SKV-AGI-0815') && skv.got[1]?.kind === 'agi' && Buffer.from(skv.got[1].innehall, 'base64').toString().includes('Skatteverket'), 'AGI inlämnad: ' + t.slice(0, 600));
  log('arbetsgivardeklaration från en bokförd lönekörning lämnas in och godkänns direkt');

  await owner.goto(B + '/bokslut/1/arsredovisning');
  await owner.click('button:has-text("Förbered inlämning till Bolagsverket")');
  await owner.waitForURL(/\/inlamning\?/);
  const ar = owner.locator('section.filing:has-text("Årsredovisning")');
  assert(!(await ar.locator('button:has-text("Lämna in direkt")').count()), 'Bolagsverket är inte uppsatt – ingen direktknapp');
  const ix = await owner.request.get(BASE + (await ar.locator('a:has-text("arsredovisning_2026")').getAttribute('href')));
  assert(ix.status() === 200 && (await ix.text()).includes('ix:'), 'iXBRL-fil');
  await ar.locator('input[name=receipt]').fill('BV-2027-123');
  await ar.locator('button:has-text("Registrera som inlämnad")').click();
  await owner.locator('section.filing:has-text("Årsredovisning") .badge:has-text("Godkänd")').waitFor();
  t = await text(owner);
  assert(t.includes('BV-2027-123') && t.includes('deadlinen är klar'), 'kvittens från Bolagsverket: ' + t.slice(0, 500));
  log('årsredovisningen laddas ner som iXBRL och registreras med kvittens från Bolagsverkets e-tjänst');

  await owner.goto(BASE + '/drift/installningar');
  t = await text(owner);
  assert(t.includes('Skatteverket (moms och AGI)') && t.includes('Bolagsverket (årsredovisning)'), 'integrationerna listas');
  await owner.locator('section#skv button:has-text("Testa")').click();
  await owner.waitForURL(/(ok|error)=/);
  assert(decodeURIComponent(owner.url()).includes('Inloggningen hos Skatteverket fungerar'), 'test av Skatteverket: ' + owner.url());
  log('Skatteverket och Bolagsverket finns bland integrationerna och inloggningen kan testas');

  //@@NEXT@@
  await browser.close();
  skvServer.close();
  console.log('Omgång 8: alla steg gick igenom');
})().catch((e) => { console.error(e); process.exit(1); });
