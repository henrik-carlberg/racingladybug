import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { accumulated, addMonths, duePeriods, lastDay, monthlyAmount, monthsBetween } from '@/lib/assets';
import { cashReportLines, orderBookingLines, parseShopifyOrder, parseWooOrder, splitGross, verifyHmacBase64 } from '@/lib/shop';
import { fromSigned } from '@/lib/ledger-lines';
import { buildSie4, parseSie, sieObjects } from '@/lib/sie';

const net = (lines: { account: number; debit: number; credit: number }[], a: number) => lines.filter((l) => l.account === a).reduce((s, l) => s + l.debit - l.credit, 0);
const balanced = (lines: { debit: number; credit: number }[]) => lines.reduce((s, l) => s + l.debit - l.credit, 0) === 0;

describe('Avskrivning enligt plan', () => {
  it('lika delar, sista månaden tar resten', () => {
    expect(monthlyAmount(1000000, 0, 36, 0)).toBe(27777);
    expect(monthlyAmount(1000000, 0, 36, 35)).toBe(1000000 - 27777 * 35);
    expect([...Array(36)].reduce((s, _, i) => s + monthlyAmount(1000000, 0, 36, i), 0)).toBe(1000000);
    expect(monthlyAmount(1000000, 100000, 36, 36)).toBe(0);
  });
  it('perioder och ackumulerat', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthsBetween('2026-11', '2027-02')).toBe(3);
    expect(lastDay('2026-02')).toBe('2026-02-28');
    const a = { cost: 3600000, residual: 0, lifeMonths: 36, depStart: '2026-09-01' };
    expect(duePeriods(a, '2026-11', new Set(['2026-09']))).toEqual([{ period: '2026-10', amount: 100000 }, { period: '2026-11', amount: 100000 }]);
    expect(duePeriods(a, '2026-08', new Set())).toEqual([]);
    expect(accumulated(a, '2030-01')).toBe(3600000);
  });
});

describe('Dagskassa', () => {
  it('moms ur bruttobelopp och kontering', () => {
    expect(splitGross({ 25: 125000, 12: 11200 })).toEqual([{ rate: 25, gross: 125000, net: 100000, vat: 25000 }, { rate: 12, gross: 11200, net: 10000, vat: 1200 }]);
    const l = cashReportLines({ 25: 125000, 12: 11200 }, { card: 100000, cash: 30000, swish: 6200 });
    expect([net(l, 1580), net(l, 1910), net(l, 1930), net(l, 3001), net(l, 2611), net(l, 3002), net(l, 2621)]).toEqual([100000, 30000, 6200, -100000, -25000, -10000, -1200]);
    expect(balanced(l)).toBe(true);
  });
  it('kassadifferens bara när den tillåts', () => {
    expect(() => cashReportLines({ 25: 10000 }, { cash: 9900 })).toThrow(/stämmer inte/);
    const l = cashReportLines({ 25: 10000 }, { cash: 9900 }, { allowDiff: true });
    expect(net(l, 3740)).toBe(100);
    expect(() => cashReportLines({ 25: 100000 }, { cash: 50000 }, { allowDiff: true })).toThrow();
  });
});

describe('E-handel', () => {
  it('signatur (HMAC-SHA256, base64)', () => {
    const body = '{"id":1}';
    const sig = createHmac('sha256', 'hemligt').update(body).digest('base64');
    expect(verifyHmacBase64('hemligt', body, sig)).toBe(true);
    expect(verifyHmacBase64('hemligt', body + ' ', sig)).toBe(false);
    expect(verifyHmacBase64('annat', body, sig)).toBe(false);
    expect(verifyHmacBase64('hemligt', body, null)).toBe(false);
  });
  it('Shopify-order med två momssatser', () => {
    const o = parseShopifyOrder({ id: 5001, name: '#1001', processed_at: '2026-11-17T14:02:00+01:00', currency: 'SEK', financial_status: 'paid',
      total_price: '1474.00', total_tax: '274.00', tax_lines: [{ rate: 0.25, price: '250.00' }, { rate: 0.12, price: '24.00' }] });
    expect(o).toMatchObject({ externalId: '5001', number: '#1001', date: '2026-11-17', total: 147400, vat: 27400, vatByRate: { 25: 25000, 12: 2400 }, paid: true });
    const l = orderBookingLines(o, 1580, 7);
    expect([net(l, 1580), net(l, 3001), net(l, 2611), net(l, 3002), net(l, 2621)]).toEqual([147400, -100000, -25000, -20000, -2400]);
    expect(l.find((x) => x.account === 3001)?.costCenterId).toBe(7);
    expect(balanced(l)).toBe(true);
  });
  it('WooCommerce-order med frakt och öresavrundning', () => {
    const o = parseWooOrder({ id: 77, number: '77', status: 'processing', date_paid: '2026-11-16T10:00:00', currency: 'SEK', total: '349.00', total_tax: '69.80',
      tax_lines: [{ rate_percent: 25, tax_total: '59.80', shipping_tax_total: '10.00' }] });
    expect(o.paid && o.vatByRate[25] === 6980).toBe(true);
    const l = orderBookingLines(o, 1580);
    expect([net(l, 3001), net(l, 2611)]).toEqual([-27920, -6980]);
    expect(balanced(l)).toBe(true);
    expect(parseWooOrder({ id: 1, status: 'pending', total: '10' }).paid).toBe(false);
  });
  it('momsfri del läggs på 0 %-försäljning', () => {
    const l = orderBookingLines({ externalId: '1', number: '1', date: '2026-11-01', currency: 'SEK', paid: true, total: 22500, vat: 2500, vatByRate: { 25: 2500 } }, 1580);
    expect([net(l, 3001), net(l, 3004)]).toEqual([-10000, -10000]);
  });
});

describe('Dimensioner', () => {
  it('raderna slås inte ihop över olika kostnadsställen', () => {
    const l = fromSigned([{ account: 5010, amount: 100, costCenterId: 1 }, { account: 5010, amount: 50, costCenterId: 2 }, { account: 5010, amount: 25, costCenterId: 1 }, { account: 1930, amount: -175 }]);
    expect(l.filter((x) => x.account === 5010).map((x) => [x.costCenterId, x.debit])).toEqual([[1, 125], [2, 50]]);
  });
  it('SIE #DIM/#OBJEKT och objektlistor', () => {
    expect(sieObjects('{1 "10" 6 "P 1"}')).toEqual({ 1: '10', 6: 'P 1' });
    expect(sieObjects('{}')).toEqual({});
    const text = buildSie4({ companyName: 'B', orgnr: '556026-9986', fiscalYear: { start: '2026-01-01', end: '2026-12-31' }, accounts: [{ number: 5010, name: 'Lokalhyra' }, { number: 1930, name: 'Bank' }],
      openingBalances: new Map(), closingBalances: new Map(), results: new Map(), costCenters: [{ code: '10', name: 'Butiken' }],
      vouchers: [{ series: 'A', number: 1, date: '2026-03-01', description: 'Hyra', created: '2026-03-01', lines: [{ account: 5010, amount: 500000, costCenter: '10' }, { account: 1930, amount: -500000 }] }] });
    expect(text).toContain('#DIM 1 "Kostnadsställe"');
    expect(text).toContain('#OBJEKT 1 "10" "Butiken"');
    expect(text).toContain('#TRANS 5010 {1 "10"} 5000.00');
    const f = parseSie(text);
    expect(f.objects).toEqual({ 1: { 10: 'Butiken' } });
    expect(f.vouchers[0].lines[0].objects).toEqual({ 1: '10' });
  });
});
