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
