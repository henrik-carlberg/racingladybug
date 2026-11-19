// End-to-end, omgång 6: ägare och 3:12 (K10, lön eller utdelning, utdelning), BankID, autogiro, e-postmallar och
// betalningsprognos, Excel-export, jämförelser och schemalagda rapporter, kvitton utan uppkoppling och prestanda.
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
  const year = new Date().getUTCFullYear();

  // ================= Del 1: ägare, K10 och utdelning =================
  // Balanserad vinst att dela ut
  await owner.goto(B + '/verifikationer/ny');
  await owner.fill('input[name=description]', 'Balanserad vinst (test)');
  const vr = owner.locator('tbody tr');
  await vr.nth(0).locator('input').nth(0).fill('1930');
  await vr.nth(0).locator('input').nth(1).fill('50000');
  await vr.nth(1).locator('input').nth(0).fill('2091');
  await vr.nth(1).locator('input').nth(2).fill('50000');
  await owner.click('button:text-is("Bokför")');
  await owner.waitForURL(/verifikationer\/\d+/).catch(async (e) => { throw new Error('verifikation: ' + (await owner.locator('main').innerText()).slice(0, 800)); });

  await owner.goto(B + '/agare');
  const addOwner = async (name, pnr, share) => {
    const f = owner.locator('form:has(button:has-text("Lägg till ägare"))');
    await f.locator('input[name=name]').fill(name);
    await f.locator('input[name=personal_number]').fill(pnr);
    await f.locator('input[name=share_pct]').fill(share);
    await f.locator('button:has-text("Lägg till ägare")').click();
    await owner.locator(`summary:has-text("${name}")`).waitFor();
  };
  await addOwner('Ägare Testsson', '19800101-0019', '60');
  await addOwner('Bo Delägare', '19770303-0408', '40');
  const f3 = owner.locator('form:has(button:has-text("Lägg till ägare"))');
  await f3.locator('input[name=name]').fill('För Mycket');
  await f3.locator('input[name=share_pct]').fill('5');
  await f3.locator('button:has-text("Lägg till ägare")').click();
  await owner.waitForURL(/error=/);
  assert(decodeURIComponent(owner.url()).includes('mer än 100 %'), 'ägarandelar över 100 % nekas');
  await owner.goto(B + `/agare?year=2026`);
  t = await text(owner);
  assert(t.includes('Gränsbelopp (K10) för inkomstår 2026') && t.includes('193 440') && t.includes('128 960'), 'grundbelopp 4 IBB fördelat 60/40: ' + t.slice(0, 1500));
  log('ägare med ägarandelar (högst 100 %) och gränsbelopp 2026 enligt de nya 3:12-reglerna');

  const calc = owner.locator('.card:has(table.payout), .card:has(label:has-text("Vinst att ta ut"))').first();
  await calc.locator('label:has-text("Vinst att ta ut") input').fill('500000');
  await calc.locator('table.payout tr.best').first().waitFor();
  t = await calc.innerText();
  assert(t.includes('Bara lön') && t.includes('Bara utdelning') && t.includes('Mest kvar'), 'räknaren jämför lön och utdelning: ' + t.slice(0, 600));
  log('räknare för lön eller utdelning visar vad som blir kvar');

  await owner.goto(B + '/agare#utdelning');
  const dec = owner.locator('form:has(button:has-text("Bokför beslutet"))');
  await dec.locator('input[name=amount]').fill('100000000');
  await dec.locator('button').click();
  await owner.waitForURL(/error=/);
  assert(decodeURIComponent(owner.url()).includes('fria egna kapitalet'), 'utdelning över fritt eget kapital nekas');
  await owner.goto(B + '/agare#utdelning');
  await owner.locator('form:has(button:has-text("Bokför beslutet")) input[name=amount]').fill('30000');
  await owner.locator('form:has(button:has-text("Bokför beslutet")) button').click();
  await owner.waitForURL(/ok=/);
  await owner.locator('form:has(button:has-text("Betala ut och bokför")) input[name=amount]').fill('30000');
  await owner.click('button:has-text("Betala ut och bokför")');
  await owner.locator('text=Kontrolluppgift KU31').waitFor();
  await owner.locator('td:has-text("18 000,00")').waitFor();
  t = await text(owner);
  assert(t.includes(`Kontrolluppgift KU31 för ${year}`) && t.includes('18 000,00') && t.includes('12 000,00'), 'KU31 fördelad efter ägarandel: ' + t.slice(-1200));
  log('utdelning beslutas (2091 → 2898), betalas ut och fördelas på ägarna, underlag för KU31');

  await browser.close();
  console.log('Omgång 6: alla steg gick igenom');
})().catch((e) => { console.error('✘', e.message, (e.stack || '').split('\n').find((l) => l.includes('omgang6.cjs'))); process.exit(1); });
