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

  await browser.close();
  console.log('Omgång 7: alla steg gick igenom');
})().catch((e) => { console.error('✘', e.message, (e.stack || '').split('\n').find((l) => l.includes('omgang7.cjs'))); process.exit(1); });
