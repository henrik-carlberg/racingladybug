import { describe, expect, it } from 'vitest';
import { buildEskd, eskdPeriod } from '@/lib/eskd';

describe('eSKD momsdeklaration', () => {
  it('period är sista månaden', () => { expect(eskdPeriod('2026-03-31')).toBe('202603'); });
  it('bygger filen i hela kronor och utelämnar tomma rutor', () => {
    const x = buildEskd({ orgnr: '556677-8899', periodEnd: '2026-03-31', boxes: [
      { box: '05', amount: 100000_50 }, { box: '10', amount: 25000_99 }, { box: '48', amount: 5000_00 }, { box: '49', amount: 20000_00 }, { box: '20', amount: 0 },
    ] });
    expect(x).toContain('encoding="ISO-8859-1"');
    expect(x).toContain('<OrgNr>16556677-8899</OrgNr>');
    expect(x).toContain('<Period>202603</Period>');
    expect(x).toContain('<ForsMomsEjAnnan>100000</ForsMomsEjAnnan>');
    expect(x).toContain('<MomsUtgHog>25000</MomsUtgHog>');
    expect(x).toContain('<MomsIngAvdr>5000</MomsIngAvdr>');
    expect(x).toContain('<MomsBetala>20000</MomsBetala>');
    expect(x).not.toContain('InkopVaruAnnatEg');
    expect(x.indexOf('ForsMomsEjAnnan')).toBeLessThan(x.indexOf('MomsUtgHog'));
  });
  it('ruta 49 tas med även när den är noll', () => {
    expect(buildEskd({ orgnr: '5566778899', periodEnd: '2026-01-31', boxes: [{ box: '49', amount: 0 }] })).toContain('<MomsBetala>0</MomsBetala>');
  });
});

import { createHmac } from 'node:crypto';
import { verifyApWebhook } from '@/lib/peppol-webhook';
describe('Peppol-webhook', () => {
  const body = '{"type":"document.received"}';
  const now = 1_800_000_000_000, ts = String(now / 1000);
  const sig = createHmac('sha256', 'hemligt').update(`${ts}.${body}`).digest('hex');
  it('godtar rätt signatur', () => { expect(verifyApWebhook('hemligt', { timestamp: ts, signature: sig }, body, now)).toBe(true); expect(verifyApWebhook('hemligt', { timestamp: ts, signature: `sha256=${sig}` }, body, now)).toBe(true); });
  it('avvisar fel hemlighet, ändrad kropp och gammal tidsstämpel', () => {
    expect(verifyApWebhook('annat', { timestamp: ts, signature: sig }, body, now)).toBe(false);
    expect(verifyApWebhook('hemligt', { timestamp: ts, signature: sig }, body + ' ', now)).toBe(false);
    expect(verifyApWebhook('hemligt', { timestamp: ts, signature: sig }, body, now + 301_000)).toBe(false);
    expect(verifyApWebhook('hemligt', { timestamp: null, signature: sig }, body, now)).toBe(false);
  });
});

import { agreementItems, collectumXml, foraCsv, pensionPremium, salarySacrifice, sameRuleVacation } from '@/lib/payroll-agreements';
describe('Lön enligt kollektivavtal', () => {
  it('ITP 1 och SAF-LO: 4,5 % upp till 7,5 IBB/12, 30 % över', () => {
    const cap = Math.round((7.5 * 8_340_000) / 12); // 52 125 kr
    expect(pensionPremium('itp1', 40_000_00, 2026)).toBe(1_800_00);
    expect(pensionPremium('saf_lo', cap + 10_000_00, 2026)).toBe(Math.round(cap * 0.045) + 3_000_00);
    expect(pensionPremium('itp2', 50_000_00, 2026)).toBe(1_000_00);
    expect(pensionPremium('custom', 30_000_00, 2026, 5)).toBe(1_500_00);
  });
  it('OB, övertid och beredskap', () => {
    const r = { ob_evening: 25_00, ob_night: 50_00, ob_weekend: 60_00, ob_holiday: 120_00, overtime_simple_divisor: 94, overtime_qualified_divisor: 72, oncall_weekday: 20_00, oncall_weekend: 40_00, vacation_supplement: 0.8 };
    const it = agreementItems(r, { ob_evening: 10, ot_simple: 4, ot_qualified: 2, oncall_weekend: 48 }, 37_600_00);
    expect(it.map((x) => x.amount)).toEqual([250_00, 4 * 400_00, 2 * Math.round(37_600_00 / 72), 48 * 40_00]);
    expect(it[0].description).toBe('OB kväll 10 h à 25,00 kr');
  });
  it('sammalöneregeln: tillägg per dag och 12 % av rörlig lön', () => {
    expect(sameRuleVacation({ monthly: 40_000_00, days: 5, supplementPercent: 0.8, variableLastYear: 25_000_00, paidDays: 25 })).toEqual({ supplement: 1_600_00, variable: 600_00 });
  });
  it('löneväxling med uppräkning och varning under 8,07 IBB', () => {
    const s = salarySacrifice({ amount: 5_000_00, monthlyBefore: 70_000_00, year: 2026 });
    expect(s.premium).toBe(5_290_00); expect(s.warning).toBe('');
    expect(salarySacrifice({ amount: 5_000_00, monthlyBefore: 58_000_00, year: 2026 }).warning).toContain('8,07');
  });
  it('Collectum- och Fora-filer', () => {
    const x = collectumXml({ orgnr: '556026-9986', period: '2026-11', rows: [{ pnr: '198001011234', name: 'Anna & Co', plan: 'itp2', event: 'nyanmalan', date: '2026-11-01', annualSalary: 610_000_00 }] });
    expect(x).toContain('orgnr="5560269986"'); expect(x).toContain('plan="ITP2"'); expect(x).toContain('arslon="610000"'); expect(x).toContain('Anna &amp; Co');
    expect(foraCsv({ orgnr: '556026-9986', period: '2026-11', rows: [{ pnr: '199001011234', name: 'Bo', salary: 30_000_50 }] })).toContain('5560269986;202611;199001011234;"Bo";30001');
  });
});

import { klarnaPayouts, payoutLines, salesLines, shopifyPayouts, stripePayout, sumupPayouts, sumupSales, zettlePayouts, zettleSales } from '@/lib/payproviders';
describe('Kortterminaler och utbetalningar', () => {
  const sum = (l: { debit: number; credit: number }[]) => l.reduce((a, x) => a + x.debit - x.credit, 0);
  it('Zettle: dagsförsäljning per momssats med retur', () => {
    const s = zettleSales('2026-11-18', { purchases: [
      { amount: 15000, products: [{ unitPrice: 10000, quantity: '1', vatPercentage: 25 }, { unitPrice: 5000, quantity: '1', vatPercentage: 12 }] },
      { amount: 10000, refund: true, products: [{ unitPrice: 10000, quantity: '1', vatPercentage: 25 }] },
      { amount: 2000 },
    ] }, 25);
    expect(s.gross).toEqual({ 25: 2000, 12: 5000 }); expect(s.count).toBe(3);
    const l = salesLines(s, 1580);
    expect(sum(l)).toBe(0);
    expect(l.find((x) => x.account === 1580)?.debit).toBe(7000);
    expect(l.find((x) => x.account === 2621)?.credit).toBe(536);
  });
  it('Zettle-utbetalning per dag och kontering', () => {
    const [p] = zettlePayouts({ data: [{ timestamp: '2026-11-19T06:00:00Z', amount: -98_50, originatorTransactionType: 'PAYOUT' }, { timestamp: '2026-11-19T01:00:00Z', amount: -1_50, originatorTransactionType: 'PAYMENT_FEE' }] });
    expect(p).toMatchObject({ date: '2026-11-19', net: 98_50, fees: 1_50, gross: 100_00 });
    const l = payoutLines(p, { clearing: 1580, bank: 1930, fee: 6570 });
    expect(l.find((x) => x.account === 1930)?.debit).toBe(98_50); expect(l.find((x) => x.account === 6570)?.debit).toBe(1_50); expect(l.find((x) => x.account === 1580)?.credit).toBe(100_00);
  });
  it('SumUp, Stripe, Klarna, Shopify', () => {
    expect(sumupSales('2026-11-18', { items: [{ amount: 100, status: 'SUCCESSFUL' }, { amount: 20, type: 'REFUND', status: 'SUCCESSFUL' }, { amount: 50, status: 'FAILED' }] }, 12).gross).toEqual({ 12: 8000 });
    expect(sumupPayouts([{ date: '2026-11-19', amount: 97.5, fee: 2.5, type: 'PAYOUT' }])[0]).toMatchObject({ net: 9750, fees: 250, gross: 10000 });
    const sp = stripePayout({ id: 'po_1', amount: 9400, arrival_date: 1_795_000_000, currency: 'sek' }, [{ type: 'charge', amount: 10000, fee: 270 }, { type: 'refund', amount: -300, fee: 0 }, { type: 'payout', amount: -9430, fee: 0 }]);
    expect(sp).toMatchObject({ gross: 10000, refunds: 300, fees: 270, net: 9400, currency: 'SEK' });
    expect(() => payoutLines(sp, { clearing: 1580, bank: 1930, fee: 6570 })).toThrow(/går inte ihop/);
    const [k] = klarnaPayouts({ payouts: [{ payout_date: '2026-11-19T00:00:00Z', payment_reference: 'K-1', currency_code: 'SEK', totals: { sale_amount: 50000, fee_amount: 1500, return_amount: 5000, settlement_amount: 43500 } }] });
    expect(sum(payoutLines(k, { clearing: 1581, bank: 1930, fee: 6570 }))).toBe(0);
    const [s] = shopifyPayouts({ payouts: [{ id: 7, date: '2026-11-19', currency: 'SEK', amount: '960.00', status: 'paid', summary: { charges_gross_amount: '1000.00', charges_fee_amount: '-30.00', refunds_gross_amount: '-10.00' } }] });
    expect(s).toMatchObject({ gross: 100000, refunds: 1000, net: 96000 });
  });
});

import { consolidate } from '@/lib/consolidation';
import { revaluationLines, revalue, reverseLines } from '@/lib/fx';
describe('Koncernelimineringar', () => {
  const m = (o: Record<number, number>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
  it('aktier mot eget kapital med goodwill och minoritet, lån och utdelning', () => {
    const P = { id: 1, name: 'Moder', result: m({ 8012: -10_000 }), balance: m({ 1310: 100_000, 1320: 20_000, 1930: 10_000, 2081: -100_000, 2099: -30_000 }), intraSales: 0, intraOpen: 0 };
    const S = { id: 2, name: 'Dotter', result: m({ 3001: -40_000, 5010: 10_000 }), balance: m({ 1930: 100_000, 2081: -50_000, 2091: -30_000, 2360: -20_000 }), intraSales: 0, intraOpen: 0 };
    const r = consolidate([P, S], { parentId: 1, links: [{ subsidiaryId: 2, ownership: 80, acquisitionCost: null, acquiredEquity: null }] });
    expect(r.goodwill).toBe(60_000);
    expect(r.minority).toBe(16_000);
    expect(r.minorityResult).toBe(6_000);
    expect(r.elimR.financial).toBe(-10_000);
    expect(r.consolidatedResult).toBe(10_000 + 30_000 - 10_000);
    // Balansräkningen går ihop: tillgångar = eget kapital + minoritet + skulder
    const assets = r.balance.fixed + r.balance.current + r.balance.cash;
    const claims = r.balance.equity + r.balance.untaxed + r.balance.longterm + r.balance.shortterm + r.minority;
    expect(assets).toBe(claims);
    expect(r.balance.longterm).toBe(0);
    expect(r.warnings).toEqual([]);
  });
});
describe('Valutaomvärdering', () => {
  it('bank mot 8330, kundfordran och leverantörsskuld mot 3960/7960', () => {
    const rows = revalue([
      { kind: 'bank', label: 'EUR-konto', account: 1932, currency: 'EUR', amountCurrency: 1_000_00, bookedSek: 11_000_00 },
      { kind: 'receivable', label: 'F 1', account: 1510, currency: 'EUR', amountCurrency: 500_00, bookedSek: 5_700_00 },
      { kind: 'payable', label: 'LF 1', account: 2440, currency: 'USD', amountCurrency: 200_00, bookedSek: 2_000_00 },
    ], { EUR: 11.5, USD: 10.5 });
    expect(rows.map((r) => r.diff)).toEqual([500_00, 50_00, 100_00]);
    const l = revaluationLines(rows);
    const on = (a: number) => l.filter((x) => x.account === a).reduce((s, x) => s + x.debit - x.credit, 0);
    expect(on(1932)).toBe(500_00); expect(on(8330)).toBe(-500_00);
    expect(on(1510)).toBe(50_00); expect(on(3960)).toBe(-50_00);
    expect(on(2440)).toBe(-100_00); expect(on(7960)).toBe(100_00);
    expect(reverseLines(l).find((x) => x.account === 1932)?.credit).toBe(500_00);
    expect(() => revalue(rows, {})).toThrow(/kurs/);
  });
});

import { PAGES_EN, PATTERNS_EN } from '@/lib/ui-en-pages';
describe('Engelska', () => {
  const tr = (t: string) => { if (PAGES_EN[t]) return PAGES_EN[t]; for (const [re, to] of PATTERNS_EN) if (re.test(t)) return typeof to === 'string' ? t.replace(re, to) : t.replace(re, to as never); return t; };
  it('ordlistan och mönstren', () => {
    expect(Object.keys(PAGES_EN).length).toBeGreaterThan(1900);
    expect(tr('Hämta nu')).toBe('Fetch now');
    expect(tr('Arbetsgivardeklaration för löner i november 2026')).toBe('Employer declaration for salaries in November 2026');
    expect(tr('Senast mån 14 december 2026')).toBe('By Mon 14 December 2026');
    expect(tr('2026-05 Intäkter 9 500 kr Kostnader 54 128 kr Resultat −44 628 kr')).toBe('2026-05 Revenue SEK 9 500 Expenses SEK 54 128 Profit SEK −44 628');
    expect(tr('Ingrid Ingenjör')).toBe('Ingrid Ingenjör');
  });
  it('inga tomma eller dubbla översättningar', () => {
    for (const [k, v] of Object.entries(PAGES_EN)) { expect(v.trim()).not.toBe(''); expect(k).toBe(k.trim()); }
  });
});
