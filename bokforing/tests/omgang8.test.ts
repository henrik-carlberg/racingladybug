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
