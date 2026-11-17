// End-to-end: enskild firma med förlängt första räkenskapsår, kontantmetoden (bokslutsmetoden),
// årsmoms och uppskov med preliminärskatt. Körs efter flow.cjs (ägarkontot finns).
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log('✔', ...a);
const assert = (c, m) => { if (!c) throw new Error(m); };
const waitMsg = (page, text) => page.waitForURL((u) => decodeURIComponent(u.toString()).includes(text), { timeout: 20000 });
const pnr = (nine) => { let s = 0; for (let i = 0; i < 9; i++) { const v = +nine[i] * (i % 2 ? 1 : 2); s += v > 9 ? v - 9 : v; } return nine + ((10 - (s % 10)) % 10); };
const line = (v, acc) => v.lines.find((l) => l.account === acc) || { debit: 0, credit: 0 };

async function createCompany(page, { name, nr, start, end }) {
  await page.goto(BASE + '/');
  await page.fill('input[name=name]', name);
  await page.selectOption('select[name=company_type]', 'EF');
  await page.fill('input[name=orgnr]', `19${nr.slice(0, 6)}-${nr.slice(6)}`);
  await page.fill('input[name=fy_start]', start);
  await page.fill('input[name=fy_end]', end);
  await page.selectOption('select[name=vat_period]', 'year');
  await page.selectOption('select[name=accounting_method]', 'cash');
  await page.click('button:has-text("Skapa bolag")');
  await page.waitForURL(/kom-igang/);
  return page.url().replace(/\/kom-igang.*/, '');
}

async function apiFor(page, base) {
  await page.goto(base + '/integrationer');
  await page.fill('input[name=name]', 'Test');
  for (const s of ['accounting:write', 'sales:write', 'purchasing:write']) await page.check(`input[name=scopes][value="${s}"]`);
  await page.click('button:has-text("Skapa API-nyckel")');
  const token = (await page.locator('.flash.ok code').textContent({ timeout: 10000 })).trim();
  return async (method, path, body) => {
    const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  };
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(20000);
  await page.goto(BASE + '/login');
  await page.fill('input[name=email]', 'agare@example.com');
  await page.fill('input[name=password]', 'hemligtlosen1');
  await page.click('form button:has-text("Logga in")');
  await page.waitForURL(BASE + '/');

  // Ogiltigt räkenskapsår för enskild firma (måste sluta 31 december)
  await page.goto(BASE + '/');
  await page.fill('input[name=name]', 'Fel år');
  await page.selectOption('select[name=company_type]', 'EF');
  await page.fill('input[name=orgnr]', `19${pnr('900101001').slice(0, 6)}-${pnr('900101001').slice(6)}`);
  await page.fill('input[name=fy_start]', '2026-10-31');
  await page.fill('input[name=fy_end]', '2027-10-31');
  await page.click('button:has-text("Skapa bolag")');
  await waitMsg(page, 'ska sluta 31 december');
  log('EF-räkenskapsår som inte slutar 31 december avvisas');

  // Konsultfirma: förlängt första år 2026-10-31 – 2027-12-31, kontantmetoden, årsmoms
  const B = await createCompany(page, { name: 'Konsult Kontant', nr: pnr('900101001'), start: '2026-10-31', end: '2027-12-31' });
  await page.goto(B + '/installningar');
  assert(await page.locator('input[name=start][value="2026-10-31"]').count() && await page.locator('input[name=end][value="2027-12-31"]').count(), 'förlängt räkenskapsår');
  assert(await page.locator('select[name=accounting_method] >> option[value=cash]').evaluate((o) => o.selected), 'kontantmetoden vald');
  // Ändra räkenskapsåret: 19 månader avvisas, sedan tillbaka till rätt datum
  await page.fill('table input[name=start]', '2026-05-01');
  await page.click('table button:has-text("Ändra")');
  await waitMsg(page, 'högst 18 månader');
  await page.fill('table input[name=start]', '2026-11-01');
  await page.click('table button:has-text("Ändra")');
  await waitMsg(page, 'Räkenskapsåret är ändrat');
  await page.goto(B + '/installningar');
  await page.fill('table input[name=start]', '2026-10-31');
  await page.click('table button:has-text("Ändra")');
  await waitMsg(page, 'Räkenskapsåret är ändrat');
  // Uppskov med preliminärskatt
  await page.goto(B + '/installningar');
  assert(await page.locator('table input[name=start][value="2026-10-31"]').count(), 'tillbaka till 31 oktober');
  await page.fill('input[name=prelskatt_from]', '2027-03');
  await page.click('form:has(input[name=prelskatt_from]) button:has-text("Spara")');
  await waitMsg(page, 'Uppgifterna är sparade');
  await page.goto(B + '/deadlines');
  const dl = await page.locator('main').textContent();
  assert(!dl.includes('Preliminärskatt november 2026') && !dl.includes('Preliminärskatt februari 2027') && dl.includes('Preliminärskatt mars 2027'), 'preliminärskatt från mars 2027: ' + dl.replace(/\s+/g, ' ').slice(0, 1500));
  log('förlängt räkenskapsår, ändring med 18-månadersgräns och preliminärskatt från mars 2027');

  const api = await apiFor(page, B);
  const cust = await api('POST', '/customers', { name: 'Kund AB' });
  const inv = await api('POST', '/invoices', { customer_id: cust.json.id, invoice_date: '2026-11-15', book: true,
    lines: [{ description: 'Konsulttimmar', quantity: 10, unit_price: 10000, vat_rate: 25 }] });
  assert(inv.status === 201 && inv.json.status === 'booked' && inv.json.number && inv.json.ocr && inv.json.voucher_id === null, 'kontantfaktura ska inte bokföras: ' + JSON.stringify(inv.json));
  const paid = await api('POST', `/invoices/${inv.json.id}/payments`, { date: '2026-11-25' });
  assert(paid.json.status === 'paid' && paid.json.payment_voucher_id, 'betald');
  const pv = (await api('GET', `/vouchers/${paid.json.payment_voucher_id}`)).json;
  assert(pv.date === '2026-11-25' && line(pv, 1930).debit === 125000 && line(pv, 2611).credit === 25000 && line(pv, 1510).debit === 0, 'kontantbokning kund: ' + JSON.stringify(pv.lines));
  log('kundfaktura bokförs först vid betalning: bank 1 250 mot intäkt 1 000 och moms 250');

  const sup = await api('POST', '/suppliers', { name: 'Datorbutiken', default_account: 5410 });
  const si = await api('POST', '/supplier-invoices', { supplier_id: sup.json.id, invoice_number: 'F-1', invoice_date: '2026-11-16', total: 250000, vat: 50000 });
  assert(si.status === 201 && si.json.voucher_id === null, 'leverantörsfaktura ska inte bokföras: ' + JSON.stringify(si.json));
  await api('POST', `/supplier-invoices/${si.json.id}/approve`);
  const sp = await api('POST', `/supplier-invoices/${si.json.id}/pay`, { date: '2026-11-30' });
  const spv = (await api('GET', `/vouchers/${sp.json.payment_voucher_id}`)).json;
  assert(line(spv, 5410).debit === 200000 && line(spv, 2641).debit === 50000 && line(spv, 1930).credit === 250000 && !spv.lines.some((l) => l.account === 2440), 'kontantbokning lev: ' + JSON.stringify(spv.lines));
  log('leverantörsfaktura bokförs först vid betalning: kostnad 2 000 + moms 500 mot bank');

  // Kreditering av obetald kontantfaktura ger ingen bokföring
  const inv2 = await api('POST', '/invoices', { customer_id: cust.json.id, invoice_date: '2026-12-01', book: true, lines: [{ description: 'Fel', unit_price: 50000, vat_rate: 25 }] });
  const cr = await api('POST', `/invoices/${inv2.json.id}/credit`, { date: '2026-12-02' });
  assert(cr.status === 201 && cr.json.voucher_id === null, 'kreditering utan bokföring: ' + JSON.stringify(cr.json));
  log('kreditering av obetald faktura bokförs inte');

  // Avslutat år: obetalda fakturor bokförs per bokslutsdagen, betalningen nästa år mot kundfordran
  const B2 = await createCompany(page, { name: 'Kontant Bokslut', nr: pnr('850505002'), start: '2025-01-01', end: '2025-12-31' });
  const api2 = await apiFor(page, B2);
  const c2 = await api2('POST', '/customers', { name: 'Sen betalare' });
  const open = await api2('POST', '/invoices', { customer_id: c2.json.id, invoice_date: '2025-12-15', book: true, lines: [{ description: 'December', unit_price: 80000, vat_rate: 25 }] });
  const s2 = await api2('POST', '/suppliers', { name: 'Hyresvärd', default_account: 5010 });
  await api2('POST', '/supplier-invoices', { supplier_id: s2.json.id, invoice_number: 'H-12', invoice_date: '2025-12-20', total: 500000, vat: 0 });
  await page.goto(B2 + '/bokslut');
  await page.click('a:has-text("Öppna")');
  await page.waitForURL(/bokslut\/\d+$/);
  assert(await page.locator('text=2 obetalda fakturor ska bokföras per 2025-12-31').count(), 'påminnelse om obetalda fakturor');
  await page.click('button:has-text("Bokför 2 obetalda fakturor")');
  await waitMsg(page, '1 kundfakturor och 1 leverantörsfakturor är bokförda');
  const booked = (await api2('GET', `/invoices/${open.json.id}`)).json;
  const yv = (await api2('GET', `/vouchers/${booked.voucher_id}`)).json;
  assert(yv.date === '2025-12-31' && line(yv, 1510).debit === 100000 && line(yv, 2611).credit === 20000, 'bokslutsbokning: ' + JSON.stringify(yv.lines));
  await page.goto(B2 + '/installningar');
  await page.fill('form:has(button:has-text("Lägg till")) input[name=start]', '2026-01-01');
  await page.fill('form:has(button:has-text("Lägg till")) input[name=end]', '2026-12-31');
  await page.click('button:has-text("Lägg till")');
  await waitMsg(page, 'Räkenskapsåret är tillagt');
  const late = await api2('POST', `/invoices/${open.json.id}/payments`, { date: '2026-01-10' });
  const lv = (await api2('GET', `/vouchers/${late.json.payment_voucher_id}`)).json;
  assert(line(lv, 1930).debit === 100000 && line(lv, 1510).credit === 100000 && !lv.lines.some((l) => l.account === 2611), 'betalning mot kundfordran: ' + JSON.stringify(lv.lines));
  log('obetalda fakturor bokförda per 2025-12-31, betalningen 2026 mot kundfordran');

  await browser.close();
})().catch((e) => { console.error('FEL:', e.message); process.exit(1); });
