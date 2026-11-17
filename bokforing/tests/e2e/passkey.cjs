// End-to-end-test av passkeys med Chromes virtuella autentiserare. Körs efter flow.cjs (kräver ägarkontot).
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  // Logga in med lösenord och lägg till passkey
  await page.goto(BASE + '/login');
  await page.fill('input[name=email]', 'agare@example.com');
  await page.fill('input[name=password]', 'hemligtlosen1');
  await page.click('form button:has-text("Logga in")');
  await page.waitForURL(BASE + '/');
  assert(await page.locator('text=lägg till en passkey').count(), 'uppmaning att lägga till passkey');
  await page.goto(BASE + '/konto');
  await page.fill('input[placeholder]', 'Testnyckel');
  await page.click('button:has-text("Lägg till passkey")');
  await page.locator('text=Passkeyn är tillagd').waitFor({ timeout: 10000 });
  await page.reload();
  assert(await page.locator('td:has-text("Testnyckel")').count(), 'passkeyn listas');
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  assert(credentials.length === 1 && credentials[0].isResidentCredential, 'discoverable credential skapad');
  log('passkey registrerad (resident key, användarverifiering)');

  // Samma autentiserare två gånger nekas (excludeCredentials)
  await page.click('button:has-text("Lägg till passkey")');
  await page.locator('text=finns redan').waitFor({ timeout: 10000 });
  log('dubblettregistrering nekas');

  const logout = async () => {
    await page.goto(BASE + '/');
    await page.click('button:has-text("Logga ut")');
    await page.waitForURL(/login/);
  };

  // 1) Autofyll (conditional UI): webbläsaren erbjuder passkeyn i e-postfältet. Den virtuella
  //    autentiseraren väljer den automatiskt, så inloggningen sker utan klick, e-post eller lösenord.
  await logout();
  await page.waitForURL(BASE + '/', { timeout: 15000 });
  assert(await page.locator('text=Testbolaget AB').count(), 'inloggad som ägaren');
  await page.goto(BASE + '/konto');
  assert(!(await page.locator('td:has-text("Aldrig")').count()), 'senast använd uppdaterad');
  log('inloggning med passkey via autofyll');

  // 2) Knappen: dölj autofyll-stödet så att bara knappen används
  await page.addInitScript(() => { window.PublicKeyCredential.isConditionalMediationAvailable = async () => false; });
  await logout();
  await page.click('button:has-text("Logga in med passkey")');
  await page.waitForURL(BASE + '/', { timeout: 15000 });
  log('inloggning med passkey-knappen');

  // Signaturräknaren ökar vid varje inloggning (skydd mot klonade nycklar)
  const { credentials: after } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  assert(after[0].signCount >= 2, 'signCount ' + after[0].signCount);

  // 3) Ta bort passkeyn → inloggning med den nekas med tydligt fel
  await page.goto(BASE + '/konto');
  await page.click('button:has-text("Ta bort")');
  await page.waitForURL((u) => decodeURIComponent(u.toString()).includes('Passkeyn är borttagen'));
  await logout();
  await page.click('button:has-text("Logga in med passkey")');
  await page.locator('text=Okänd passkey').waitFor({ timeout: 15000 });
  assert(page.url().includes('/login'), 'ska inte bli inloggad');
  log('borttagen passkey nekas');

  // Utan inloggning går det inte att registrera passkey
  await page.goto(BASE + '/konto');
  assert(page.url().includes('/login'), 'konto kräver inloggning');
  log('kontosidan kräver inloggning');
  await browser.close();
})().catch((e) => { console.error('FEL:', e.message); process.exit(1); });
