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
