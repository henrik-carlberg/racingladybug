// Utlandsbetalningar (ren logik): IBAN/BIC, SEPA, avgiftsval och betalfil pain.001.001.03 i valuta. Belopp i minsta enhet (cent).
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const compact = (s = '') => s.replace(/\s/g, '').toUpperCase();

/** IBAN med kontrollsiffror (mod 97) */
export function ibanValid(raw: string): boolean {
  const s = compact(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let m = 0;
  for (const ch of r) m = (m * 10 + Number(ch)) % 97;
  return m === 1;
}
export const bicValid = (raw: string) => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compact(raw));
export const formatIban = (raw: string) => compact(raw).replace(/(.{4})/g, '$1 ').trim();

/** Länder i SEPA-området (betalning i euro med kostnadsfördelning SLEV) */
export const SEPA = new Set(['AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'SM', 'VA', 'AD']);
export const isSepa = (currency: string, iban: string) => currency === 'EUR' && SEPA.has(compact(iban).slice(0, 2));

export type ChargeBearer = 'SHA' | 'OUR' | 'SLEV';
/** Avgiftsval: SEPA-betalning i euro är alltid delad (SLEV); annars leverantörens val (SHA delad, OUR betalaren står för alla avgifter) */
export const chargeBearer = (currency: string, iban: string, preferred: 'SHA' | 'OUR'): ChargeBearer => (isSepa(currency, iban) ? 'SLEV' : preferred);

/** Kreditorreferens enligt ISO 11649 (RF + kontrollsiffror) */
export function rfValid(raw: string): boolean {
  const s = compact(raw);
  if (!/^RF\d{2}[A-Z0-9]{1,21}$/.test(s)) return false;
  return mod97(s.slice(4) + s.slice(0, 4)) === 1;
}
function mod97(s: string) { let m = 0; for (const ch of s.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))) m = (m * 10 + Number(ch)) % 97; return m; }

export interface ForeignPayment { id: string; name: string; country: string; iban: string; bic: string; currency: string; amount: number; date: string; reference: string; chargeBearer: ChargeBearer; regCode?: string; invoiceNumber: string }
export interface DebtorAccount { currency: string; iban: string; bic: string }

/** Fel i en betalning, eller null */
export function foreignPaymentError(p: ForeignPayment): string | null {
  if (!ibanValid(p.iban)) return `${p.name}: ogiltigt IBAN`;
  if (!p.bic) { if (!isSepa(p.currency, p.iban)) return `${p.name}: BIC krävs för betalning utanför SEPA`; }
  else if (!bicValid(p.bic)) return `${p.name}: ogiltig BIC`;
  if (!/^[A-Z]{3}$/.test(p.currency) || p.currency === 'SEK') return `${p.name}: betalningen ska vara i utländsk valuta`;
  if (p.amount <= 0) return `${p.name}: beloppet måste vara större än noll`;
  return null;
}

const amt = (minor: number) => (minor / 100).toFixed(2);

/**
 * pain.001.001.03 för utlandsbetalningar. Betalningarna grupperas per datum, debiteringskonto och avgiftsval.
 * Ett valutakonto i samma valuta används om bolaget har det, annars SEK-kontot (banken växlar).
 */
export function foreignPain001Xml(o: { messageId: string; created: string; debtor: { name: string; orgnr: string }; sekAccount: DebtorAccount; accounts: DebtorAccount[]; payments: ForeignPayment[] }) {
  const acctFor = (cur: string) => o.accounts.find((a) => a.currency === cur && a.iban) ?? o.sekAccount;
  const groups = new Map<string, ForeignPayment[]>();
  for (const p of o.payments) { const k = `${p.date}|${acctFor(p.currency).iban}|${p.chargeBearer}`; groups.set(k, [...(groups.get(k) ?? []), p]); }
  const orgId = `<Id><OrgId><Othr><Id>${esc(o.debtor.orgnr.replace(/\D/g, ''))}</Id><SchmeNm><Cd>BANK</Cd></SchmeNm></Othr></OrgId></Id>`;
  const blocks = [...groups.entries()].map(([k, list], i) => {
    const [date, , cb] = k.split('|');
    const acc = acctFor(list[0].currency);
    const sepa = cb === 'SLEV';
    return `<PmtInf>
<PmtInfId>${esc(o.messageId)}-${i + 1}</PmtInfId><PmtMtd>TRF</PmtMtd><NbOfTxs>${list.length}</NbOfTxs><CtrlSum>${amt(list.reduce((s, p) => s + p.amount, 0))}</CtrlSum>
<PmtTpInf><SvcLvl><Cd>${sepa ? 'SEPA' : 'NURG'}</Cd></SvcLvl></PmtTpInf>
<ReqdExctnDt>${date}</ReqdExctnDt>
<Dbtr><Nm>${esc(o.debtor.name)}</Nm>${orgId}</Dbtr>
<DbtrAcct><Id><IBAN>${esc(compact(acc.iban))}</IBAN></Id><Ccy>${esc(acc.currency)}</Ccy></DbtrAcct>
<DbtrAgt><FinInstnId>${acc.bic ? `<BIC>${esc(compact(acc.bic))}</BIC>` : ''}</FinInstnId></DbtrAgt>
<ChrgBr>${cb}</ChrgBr>
${list.map((p) => `<CdtTrfTxInf>
<PmtId><InstrId>${esc(p.id)}</InstrId><EndToEndId>${esc(p.id)}</EndToEndId></PmtId>
<Amt><InstdAmt Ccy="${esc(p.currency)}">${amt(p.amount)}</InstdAmt></Amt>
${p.bic ? `<CdtrAgt><FinInstnId><BIC>${esc(compact(p.bic))}</BIC></FinInstnId></CdtrAgt>` : ''}
<Cdtr><Nm>${esc(p.name.slice(0, 70))}</Nm><PstlAdr><Ctry>${esc(p.country || compact(p.iban).slice(0, 2))}</Ctry></PstlAdr></Cdtr>
<CdtrAcct><Id><IBAN>${esc(compact(p.iban))}</IBAN></Id></CdtrAcct>
${p.regCode ? `<RgltryRptg><Dtls><Cd>${esc(p.regCode.slice(0, 10))}</Cd></Dtls></RgltryRptg>` : ''}
${/^RF\d{2}/i.test(compact(p.reference)) ? `<RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry><Issr>ISO</Issr></Tp><Ref>${esc(compact(p.reference))}</Ref></CdtrRefInf></Strd></RmtInf>`
    : `<RmtInf><Ustrd>${esc((p.reference || `Invoice ${p.invoiceNumber}`).slice(0, 140))}</Ustrd></RmtInf>`}
</CdtTrfTxInf>`).join('\n')}
</PmtInf>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<CstmrCdtTrfInitn>
<GrpHdr><MsgId>${esc(o.messageId)}</MsgId><CreDtTm>${o.created}</CreDtTm><NbOfTxs>${o.payments.length}</NbOfTxs><CtrlSum>${amt(o.payments.reduce((s, p) => s + p.amount, 0))}</CtrlSum>
<InitgPty><Nm>${esc(o.debtor.name)}</Nm>${orgId}</InitgPty></GrpHdr>
${blocks}
</CstmrCdtTrfInitn>
</Document>
`;
}

/** Avräkning från banken: kursdifferens mot bokförd skuld och avgift */
export function settlement(o: { bookedSek: number; paidSek: number; fee: number }) {
  return { fxDiff: o.paidSek - o.bookedSek, fee: o.fee, totalDebited: o.paidSek + o.fee, rate: null as number | null };
}
export const BANK_FEE_ACCOUNT = 6570;
