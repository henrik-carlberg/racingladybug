import { describe, expect, it } from 'vitest';
import { assessRisk, engagementLetter, kycStatus, parseOwners } from '@/lib/kyc';

describe('Kundkännedom', () => {
  it('risknivå och omprövning', () => {
    expect(assessRisk([], false, '2026-11-20')).toMatchObject({ risk: 'low', nextReview: '2028-11-20' });
    expect(assessRisk(['cash'], false, '2026-11-20')).toMatchObject({ risk: 'normal', nextReview: '2027-11-20' });
    expect(assessRisk(['cash', 'unusual'], false, '2026-11-20')).toMatchObject({ risk: 'high', nextReview: '2027-05-20', enhanced: true });
    expect(assessRisk([], true, '2026-08-31')).toMatchObject({ risk: 'high', nextReview: '2027-02-28' });
  });
  it('status', () => {
    expect(kycStatus(null, '2026-11-20')).toBe('missing');
    expect(kycStatus('2026-11-01', '2026-11-20')).toBe('expired');
    expect(kycStatus('2026-12-10', '2026-11-20')).toBe('due');
    expect(kycStatus('2027-06-01', '2026-11-20')).toBe('ok');
  });
  it('verkliga huvudmän och uppdragsbrev', () => {
    expect(parseOwners({ huvudman: [{ namn: 'Ägare Testsson', fodelsear: 1980, omfattning: 'Mer än 75 %', grund: 'Ägande' }, { foo: 1 }] }))
      .toEqual([{ name: 'Ägare Testsson', birthYear: 1980, share: 'Mer än 75 %', basis: 'Ägande' }]);
    const h = engagementLetter({ firm: 'Byrå <AB>', firmOrgnr: '', client: 'Kund', clientOrgnr: '1', services: ['bookkeeping', 'vat'], fee: '1 000 kr/mån', start: '2026-12-01', date: '2026-11-20' });
    expect(h).toContain('Byrå &lt;AB&gt;'); expect(h).toContain('<li>Momsdeklarationer</li>'); expect(h).toContain('Penningtvättslagen');
  });
});
