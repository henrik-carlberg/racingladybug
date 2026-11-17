// Betalfil för leverantörsbetalningar: ISO 20022 pain.001.001.03 (Customer Credit Transfer Initiation).
// Svensk praxis: bankgiro med SchmeNm/Prtry=BGNR, plusgiro och bankkonto som BBAN med clearingnummer,
// OCR som strukturerad referens (SCOR). Bankerna har egna tillämpningsguider – kontrollera mot din bank.

export interface Pain001Payment { id: string; name: string; bankgiro?: string; plusgiro?: string; bankAccount?: string; reference: string; amount: number; date: string; invoiceNumber: string }
export interface Pain001Input { messageId: string; created: string; debtor: { name: string; orgnr: string; iban?: string; bankgiro?: string; bic?: string }; payments: Pain001Payment[] }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const digits = (s = '') => s.replace(/\D/g, '');
const amt = (ore: number) => (ore / 100).toFixed(2);

/** Luhn (mod 10) – OCR-nummer har kontrollsiffra */
export function luhnValid(s: string): boolean {
  const d = digits(s);
  if (d.length < 2 || d !== s.replace(/\s/g, '')) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let v = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) { v *= 2; if (v > 9) v -= 9; }
    sum += v;
  }
  return sum % 10 === 0;
}

/** Validerar en betalning – returnerar felmeddelande eller null */
export function paymentError(p: Pain001Payment): string | null {
  if (!p.bankgiro && !p.plusgiro && !p.bankAccount) return `${p.name}: saknar bankgiro, plusgiro eller bankkonto`;
  if (p.bankgiro && !/^\d{7,8}$/.test(digits(p.bankgiro))) return `${p.name}: ogiltigt bankgironummer`;
  if (!p.bankgiro && !p.plusgiro && p.bankAccount && digits(p.bankAccount).length < 8) return `${p.name}: ange bankkonto med clearingnummer`;
  if (p.amount <= 0) return `${p.name}: beloppet måste vara större än noll`;
  return null;
}

function creditor(p: Pain001Payment): string {
  if (p.bankgiro) {
    return `<CdtrAcct><Id><Othr><Id>${digits(p.bankgiro)}</Id><SchmeNm><Prtry>BGNR</Prtry></SchmeNm></Othr></Id></CdtrAcct>`;
  }
  if (p.plusgiro) {
    return `<CdtrAgt><FinInstnId><ClrSysMmbId><ClrSysId><Cd>SESBA</Cd></ClrSysId><MmbId>9960</MmbId></ClrSysMmbId></FinInstnId></CdtrAgt>
<CdtrAcct><Id><Othr><Id>${digits(p.plusgiro)}</Id><SchmeNm><Cd>BBAN</Cd></SchmeNm></Othr></Id></CdtrAcct>`;
  }
  const d = digits(p.bankAccount);
  const clearing = d.startsWith('8') ? d.slice(0, 5) : d.slice(0, 4); // Swedbank: femsiffrigt clearingnummer som börjar på 8
  return `<CdtrAgt><FinInstnId><ClrSysMmbId><ClrSysId><Cd>SESBA</Cd></ClrSysId><MmbId>${clearing}</MmbId></ClrSysMmbId></FinInstnId></CdtrAgt>
<CdtrAcct><Id><Othr><Id>${d.slice(clearing.length)}</Id><SchmeNm><Cd>BBAN</Cd></SchmeNm></Othr></Id></CdtrAcct>`;
}

function remittance(p: Pain001Payment): string {
  const ref = p.reference.trim();
  if (ref && luhnValid(ref)) {
    return `<RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>${digits(ref)}</Ref></CdtrRefInf></Strd></RmtInf>`;
  }
  return `<RmtInf><Ustrd>${esc((ref || `Faktura ${p.invoiceNumber}`).slice(0, 140))}</Ustrd></RmtInf>`;
}

export function pain001Xml(input: Pain001Input): string {
  const byDate = new Map<string, Pain001Payment[]>();
  for (const p of input.payments) byDate.set(p.date, [...(byDate.get(p.date) ?? []), p]);
  const total = input.payments.reduce((s, p) => s + p.amount, 0);
  const d = input.debtor;
  const debtorAcct = d.iban
    ? `<DbtrAcct><Id><IBAN>${esc(d.iban.replace(/\s/g, ''))}</IBAN></Id><Ccy>SEK</Ccy></DbtrAcct>`
    : `<DbtrAcct><Id><Othr><Id>${digits(d.bankgiro)}</Id><SchmeNm><Prtry>BGNR</Prtry></SchmeNm></Othr></Id><Ccy>SEK</Ccy></DbtrAcct>`;
  const debtorAgt = d.bic ? `<DbtrAgt><FinInstnId><BIC>${esc(d.bic)}</BIC></FinInstnId></DbtrAgt>` : '<DbtrAgt><FinInstnId/></DbtrAgt>';
  const blocks = [...byDate.entries()].map(([date, list], i) => `<PmtInf>
<PmtInfId>${esc(input.messageId)}-${i + 1}</PmtInfId><PmtMtd>TRF</PmtMtd><NbOfTxs>${list.length}</NbOfTxs><CtrlSum>${amt(list.reduce((s, p) => s + p.amount, 0))}</CtrlSum>
<PmtTpInf><SvcLvl><Cd>NURG</Cd></SvcLvl></PmtTpInf>
<ReqdExctnDt>${date}</ReqdExctnDt>
<Dbtr><Nm>${esc(d.name)}</Nm><Id><OrgId><Othr><Id>${digits(d.orgnr)}</Id><SchmeNm><Cd>BANK</Cd></SchmeNm></Othr></OrgId></Id></Dbtr>
${debtorAcct}
${debtorAgt}
${list.map((p) => `<CdtTrfTxInf>
<PmtId><InstrId>${esc(p.id)}</InstrId><EndToEndId>${esc(p.id)}</EndToEndId></PmtId>
<Amt><InstdAmt Ccy="SEK">${amt(p.amount)}</InstdAmt></Amt>
${creditor(p).includes('<CdtrAgt>') ? creditor(p).replace(/(<CdtrAcct>)/, `<Cdtr><Nm>${esc(p.name.slice(0, 70))}</Nm></Cdtr>\n$1`) : `<Cdtr><Nm>${esc(p.name.slice(0, 70))}</Nm></Cdtr>\n${creditor(p)}`}
${remittance(p)}
</CdtTrfTxInf>`).join('\n')}
</PmtInf>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<CstmrCdtTrfInitn>
<GrpHdr><MsgId>${esc(input.messageId)}</MsgId><CreDtTm>${input.created}</CreDtTm><NbOfTxs>${input.payments.length}</NbOfTxs><CtrlSum>${amt(total)}</CtrlSum>
<InitgPty><Nm>${esc(d.name)}</Nm><Id><OrgId><Othr><Id>${digits(d.orgnr)}</Id><SchmeNm><Cd>BANK</Cd></SchmeNm></Othr></OrgId></Id></InitgPty></GrpHdr>
${blocks}
</CstmrCdtTrfInitn>
</Document>
`;
}

/** Swish-QR (förifylld betalning). Format: C<nummer>;<belopp>;<meddelande>;<lås> där lås 0 = inget kan ändras. */
export function swishQrData(number: string, amountOre: number, message: string): string {
  const kr = amountOre % 100 === 0 ? String(amountOre / 100) : (amountOre / 100).toFixed(2);
  return `C${digits(number)};${kr};${message.replace(/;/g, ' ').slice(0, 50)};0`;
}

/** Swishnummer som det skrivs: 123 456 78 90 (företag) eller 070-123 45 67 (mobil) */
export function formatSwish(n: string): string {
  const d = n.replace(/\D/g, '');
  if (/^123\d{7}$/.test(d)) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}`;
  if (/^07\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}`;
  return d;
}
