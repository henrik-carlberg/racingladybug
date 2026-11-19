// Betalningar direkt från appen via bankens API (betalinitiering) – ren logik (testbar).

export interface PayItem { name: string; account: { kind: 'bankgiro' | 'plusgiro' | 'iban' | 'bban'; id: string }; amount: number; reference: string; endToEnd: string }
const digits = (s: string) => s.replace(/\D/g, '');

/** Mottagarens konto: bankgiro, plusgiro, IBAN eller clearing + kontonummer */
export function creditorAccount(o: { bankgiro?: string | null; plusgiro?: string | null; iban?: string | null; clearing?: string | null; account?: string | null }): PayItem['account'] | null {
  if (o.bankgiro && /^\d{7,8}$/.test(digits(o.bankgiro))) return { kind: 'bankgiro', id: digits(o.bankgiro) };
  if (o.plusgiro && /^\d{2,8}$/.test(digits(o.plusgiro))) return { kind: 'plusgiro', id: digits(o.plusgiro) };
  const iban = (o.iban ?? '').replace(/\s/g, '').toUpperCase();
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return { kind: 'iban', id: iban };
  const c = digits(o.clearing ?? ''), a = digits(o.account ?? '');
  if (/^\d{4,5}$/.test(c) && /^\d{5,12}$/.test(a)) return { kind: 'bban', id: c + a };
  // Clearing och konto i samma fält (t.ex. "8327-9 123 456 789-0")
  if (!o.clearing && /^\d{9,17}$/.test(a)) return { kind: 'bban', id: a };
  return null;
}

const SCHEME = { bankgiro: 'BGNR', plusgiro: 'PGNR', iban: 'IBAN', bban: 'BBAN' } as const;
/** Betalningsbegäran till Enable Banking (en eller flera överföringar). Belopp i öre blir kronor med två decimaler. */
export function paymentRequest(o: { debtorIban: string; date: string; items: PayItem[] }) {
  if (!o.items.length) throw new Error('Inga betalningar');
  return {
    payment_type: o.items.length === 1 ? 'DOMESTIC' : 'BULK_DOMESTIC',
    payment_request: {
      debtor_account: { iban: o.debtorIban.replace(/\s/g, '') },
      requested_execution_date: o.date,
      credit_transfer_transaction: o.items.map((i) => ({
        instructed_amount: { amount: (i.amount / 100).toFixed(2), currency: 'SEK' },
        beneficiary: { creditor: { name: i.name.slice(0, 70) }, creditor_account: { scheme_name: SCHEME[i.account.kind], identification: i.account.id } },
        remittance_information: [i.reference.slice(0, 140)],
        end_to_end_id: i.endToEnd.slice(0, 35),
      })),
    },
  };
}

/** Betalningsstatus enligt ISO 20022 */
export function mapPaymentStatus(s: string | undefined): 'authorization' | 'accepted' | 'executed' | 'rejected' {
  const v = (s ?? '').toUpperCase();
  if (['ACSC', 'ACCC'].includes(v)) return 'executed';
  if (['RJCT', 'CANC'].includes(v)) return 'rejected';
  if (['ACCP', 'ACSP', 'ACTC', 'ACWC', 'ACFC', 'PATC', 'PART'].includes(v)) return 'accepted';
  return 'authorization';
}
