import { describe, expect, it } from 'vitest';
import { mimeFor, newInboxToken, normalizeExtraction, signSvix, tokensIn, verifySvix, type RawExtraction } from '@/lib/inbox';

const secret = 'whsec_' + Buffer.from('hemlig-nyckel-for-test-1234567890').toString('base64');

describe('Svix-signatur (Resend-webhook)', () => {
  const body = '{"type":"email.received","data":{"email_id":"e1"}}';
  const now = 1_790_000_000_000;
  const ts = Math.floor(now / 1000);
  it('godkänner rätt signatur, även bland flera', () => {
    const sig = signSvix(secret, 'msg_1', ts, body);
    expect(verifySvix(secret, { id: 'msg_1', timestamp: String(ts), signature: sig }, body, now)).toBe(true);
    expect(verifySvix(secret, { id: 'msg_1', timestamp: String(ts), signature: `v1,AAAA ${sig}` }, body, now)).toBe(true);
  });
  it('nekar ändrad text, fel id, gammal tidsstämpel och saknade huvuden', () => {
    const sig = signSvix(secret, 'msg_1', ts, body);
    expect(verifySvix(secret, { id: 'msg_1', timestamp: String(ts), signature: sig }, body + ' ', now)).toBe(false);
    expect(verifySvix(secret, { id: 'msg_2', timestamp: String(ts), signature: sig }, body, now)).toBe(false);
    expect(verifySvix(secret, { id: 'msg_1', timestamp: String(ts), signature: sig }, body, now + 6 * 60_000)).toBe(false);
    expect(verifySvix(secret, { id: null, timestamp: String(ts), signature: sig }, body, now)).toBe(false);
    expect(verifySvix('whsec_' + Buffer.from('annan').toString('base64'), { id: 'msg_1', timestamp: String(ts), signature: sig }, body, now)).toBe(false);
  });
});

describe('Inkorgsadress', () => {
  it('token och mottagare', () => {
    const t = newInboxToken();
    expect(t).toMatch(/^f-[a-z0-9]{10}$/);
    expect(tokensIn(['Ekonomi <F-ABC123@Inbox.Example.se>', 'f-abc123+jan@inbox.example.se', 'f-x@inbox.example.se.evil.com', 'f-zzz@other.se', 'annan@inbox.example.se'], 'inbox.example.se'))
      .toEqual(['f-abc123', 'annan']);
  });
  it('filtyp från namn när typen saknas', () => {
    expect(mimeFor('Faktura.PDF', 'application/octet-stream')).toBe('application/pdf');
    expect(mimeFor('bild.jpeg', '')).toBe('image/jpeg');
    expect(mimeFor('x.docx', 'application/msword')).toBe('application/msword');
  });
});

describe('Normalisering av avläsningen', () => {
  const raw: RawExtraction = {
    document_type: 'invoice', supplier_name: '  Kontorsvaror   Norden AB ', supplier_orgnr: '556677-8899', supplier_vat_number: 'se 556677889901',
    bankgiro: 'Bankgiro 5050-1055', plusgiro: null, iban: 'SE45 5000 0000 0583 9825 7466', supplier_email: null,
    invoice_number: 'F-1001', invoice_date: '2026-12-01', due_date: '2026-31-12', ocr_or_payment_reference: '100123',
    currency: 'sek', total_amount: 625, vat_amount: 125.004, suggested_account: 6110, description: 'Kontorsmaterial',
  };
  it('belopp i öre, datum och format', () => {
    const x = normalizeExtraction(raw, new Set([6110, 5010]));
    expect(x.supplier).toEqual({ name: 'Kontorsvaror Norden AB', orgnr: '556677-8899', vatNumber: 'SE556677889901', bankgiro: '5050-1055', plusgiro: '', iban: 'SE4550000000058398257466', email: '' });
    expect([x.total, x.vat, x.account, x.invoiceDate, x.dueDate, x.currency]).toEqual([62500, 12500, 6110, '2026-12-01', '', 'SEK']);
  });
  it('orimliga värden tas bort', () => {
    const x = normalizeExtraction({ ...raw, document_type: 'spam', suggested_account: 1930, vat_amount: 700, bankgiro: '12' }, new Set([6110]));
    expect([x.documentType, x.account, x.vat, x.supplier.bankgiro]).toEqual(['other', null, null, '']);
    expect(normalizeExtraction({ ...raw, suggested_account: 6999 }, new Set([6110])).account).toBe(null);
  });
});
