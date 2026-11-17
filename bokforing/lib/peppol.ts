// E-faktura enligt Peppol BIS Billing 3.0 (UBL 2.1, EN 16931). Rena funktioner.
// Faktura (Invoice, 380) och kreditnota (CreditNote, 381). Belopp in i öre.

export interface PeppolParty {
  name: string; orgnr: string; vatNumber?: string; address: string; postalCode: string; city: string; country: string;
  endpoint?: string; // "0007:5560269986"
  email?: string; phone?: string; fSkatt?: boolean;
}
export interface PeppolLine { description: string; quantity: number; unit: string; unitPrice: number; vatRate: number; net: number }
export interface PeppolInvoice {
  number: number; issueDate: string; dueDate: string; deliveryDate?: string; currency?: string; buyerReference: string; orderReference?: string; note?: string;
  credit?: { originalNumber: number; originalDate?: string };
  reverseCharge: boolean; lines: PeppolLine[];
  totals: { net: number; vat: number; rounding: number; total: number; vatByRate: Record<string, { base: number; vat: number }> };
  seller: PeppolParty; buyer: PeppolParty;
  payment: { ocr?: string | null; bankgiro?: string; plusgiro?: string; iban?: string; terms?: string };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const amt = (ore: number) => (ore / 100).toFixed(2);
const digits = (s: string) => s.replace(/\D/g, '');

/** UN/ECE Rec 20-koder för vanliga enheter */
export function unitCode(unit: string): string {
  const u = unit.trim().toLowerCase();
  return ({ h: 'HUR', tim: 'HUR', timme: 'HUR', timmar: 'HUR', dag: 'DAY', dagar: 'DAY', mån: 'MON', månad: 'MON', km: 'KMT', kg: 'KGM', l: 'LTR', m: 'MTR', m2: 'MTK', st: 'C62', 'st.': 'C62', pkt: 'C62' } as Record<string, string>)[u] ?? 'C62';
}

/** Momskategori: S = standard, AE = omvänd skattskyldighet, E = undantagen */
function category(rate: number, reverseCharge: boolean): { id: 'S' | 'AE' | 'E'; reason?: string } {
  if (reverseCharge) return { id: 'AE', reason: 'Omvänd betalningsskyldighet' };
  if (rate > 0) return { id: 'S' };
  return { id: 'E', reason: 'Undantagen från skatteplikt' };
}

/** Kontrollerar uppgifter som krävs för Peppol. Returnerar en lista med fel (tom = ok). */
export function peppolErrors(inv: PeppolInvoice): string[] {
  const e: string[] = [];
  if (!inv.buyer.endpoint) e.push('Kunden saknar Peppol-ID (t.ex. 0007:organisationsnummer)');
  if (inv.buyer.endpoint && !/^\d{4}:[A-Za-z0-9.-]+$/.test(inv.buyer.endpoint)) e.push('Kundens Peppol-ID har fel format');
  if (!inv.buyerReference && !inv.orderReference) e.push('Ange "Er referens" (köparens referens eller beställningsnummer) – krävs i Peppol');
  if (!digits(inv.seller.orgnr)) e.push('Bolaget saknar organisationsnummer');
  if (inv.lines.some((l) => l.vatRate > 0) && !inv.seller.vatNumber) e.push('Bolaget saknar momsregistreringsnummer (Inställningar)');
  if (inv.reverseCharge && !inv.buyer.vatNumber) e.push('Omvänd skattskyldighet kräver kundens momsregistreringsnummer');
  if (!inv.seller.city || !inv.seller.postalCode) e.push('Bolaget saknar postnummer och ort (Inställningar)');
  if (!inv.payment.bankgiro && !inv.payment.plusgiro && !inv.payment.iban && !inv.credit) e.push('Ange bankgiro, plusgiro eller IBAN för betalning (Inställningar)');
  return e;
}

function party(p: PeppolParty, role: 'AccountingSupplierParty' | 'AccountingCustomerParty'): string {
  const [scheme, id] = (p.endpoint || `0007:${digits(p.orgnr)}`).split(':');
  const taxSchemes = [
    p.vatNumber ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(p.vatNumber)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : '',
    role === 'AccountingSupplierParty' && p.fSkatt ? '<cac:PartyTaxScheme><cbc:CompanyID>Godkänd för F-skatt</cbc:CompanyID><cac:TaxScheme><cbc:ID>TAX</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>' : '',
  ].join('');
  const contact = p.email || p.phone ? `<cac:Contact>${p.phone ? `<cbc:Telephone>${esc(p.phone)}</cbc:Telephone>` : ''}${p.email ? `<cbc:ElectronicMail>${esc(p.email)}</cbc:ElectronicMail>` : ''}</cac:Contact>` : '';
  return `<cac:${role}><cac:Party>
<cbc:EndpointID schemeID="${esc(scheme)}">${esc(id)}</cbc:EndpointID>
<cac:PartyName><cbc:Name>${esc(p.name)}</cbc:Name></cac:PartyName>
<cac:PostalAddress>${p.address ? `<cbc:StreetName>${esc(p.address)}</cbc:StreetName>` : ''}${p.city ? `<cbc:CityName>${esc(p.city)}</cbc:CityName>` : ''}${p.postalCode ? `<cbc:PostalZone>${esc(p.postalCode.replace(/\s/g, ''))}</cbc:PostalZone>` : ''}<cac:Country><cbc:IdentificationCode>${esc(p.country || 'SE')}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
${taxSchemes}<cac:PartyLegalEntity><cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName>${digits(p.orgnr) ? `<cbc:CompanyID${p.country === 'SE' || !p.country ? ' schemeID="0007"' : ''}>${digits(p.orgnr)}</cbc:CompanyID>` : ''}</cac:PartyLegalEntity>
${contact}</cac:Party></cac:${role}>`;
}

/** Bygger UBL-XML för Peppol BIS Billing 3.0 */
export function peppolXml(inv: PeppolInvoice): string {
  const credit = !!inv.credit;
  const root = credit ? 'CreditNote' : 'Invoice';
  const sign = credit ? -1 : 1; // kreditnotor anges med positiva belopp
  const cur = inv.currency ?? 'SEK';
  const c = (ore: number) => `currencyID="${cur}"`.concat(`>${amt(ore * sign)}`);
  const subtotals = Object.entries(inv.totals.vatByRate).map(([rate, v]) => {
    const cat = category(Number(rate), inv.reverseCharge);
    return `<cac:TaxSubtotal><cbc:TaxableAmount ${c(v.base)}</cbc:TaxableAmount><cbc:TaxAmount ${c(v.vat)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>${cat.id}</cbc:ID><cbc:Percent>${inv.reverseCharge ? 0 : Number(rate)}</cbc:Percent>${cat.reason ? `<cbc:TaxExemptionReason>${esc(cat.reason)}</cbc:TaxExemptionReason>` : ''}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`;
  }).join('\n');
  const pay = inv.payment;
  const means = credit ? '' : [
    pay.bankgiro ? `<cac:PaymentMeans><cbc:PaymentMeansCode name="Bankgiro">30</cbc:PaymentMeansCode>${pay.ocr ? `<cbc:PaymentID>${esc(pay.ocr)}</cbc:PaymentID>` : ''}<cac:PayeeFinancialAccount><cbc:ID>${digits(pay.bankgiro)}</cbc:ID><cac:FinancialInstitutionBranch><cbc:ID>9900</cbc:ID></cac:FinancialInstitutionBranch></cac:PayeeFinancialAccount></cac:PaymentMeans>` : '',
    pay.plusgiro ? `<cac:PaymentMeans><cbc:PaymentMeansCode name="Plusgiro">30</cbc:PaymentMeansCode>${pay.ocr ? `<cbc:PaymentID>${esc(pay.ocr)}</cbc:PaymentID>` : ''}<cac:PayeeFinancialAccount><cbc:ID>${digits(pay.plusgiro)}</cbc:ID><cac:FinancialInstitutionBranch><cbc:ID>9960</cbc:ID></cac:FinancialInstitutionBranch></cac:PayeeFinancialAccount></cac:PaymentMeans>` : '',
    pay.iban ? `<cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>${pay.ocr ? `<cbc:PaymentID>${esc(pay.ocr)}</cbc:PaymentID>` : ''}<cac:PayeeFinancialAccount><cbc:ID>${esc(pay.iban.replace(/\s/g, ''))}</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>` : '',
  ].join('\n');
  const lines = inv.lines.map((l, i) => {
    const cat = category(l.vatRate, inv.reverseCharge);
    const qtyTag = credit ? 'CreditedQuantity' : 'InvoicedQuantity';
    return `<cac:${root}Line><cbc:ID>${i + 1}</cbc:ID><cbc:${qtyTag} unitCode="${unitCode(l.unit)}">${Math.abs(l.quantity)}</cbc:${qtyTag}><cbc:LineExtensionAmount ${c(l.net)}</cbc:LineExtensionAmount>
<cac:Item><cbc:Name>${esc(l.description.slice(0, 250))}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${cat.id}</cbc:ID><cbc:Percent>${inv.reverseCharge ? 0 : l.vatRate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>
<cac:Price><cbc:PriceAmount currencyID="${cur}">${(l.unitPrice / 100).toFixed(2)}</cbc:PriceAmount></cac:Price></cac:${root}Line>`;
  }).join('\n');
  const ns = credit ? 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2' : 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="${ns}" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
<cbc:ID>${inv.number}</cbc:ID>
<cbc:IssueDate>${inv.issueDate}</cbc:IssueDate>
${credit ? '' : `<cbc:DueDate>${inv.dueDate}</cbc:DueDate>\n`}<cbc:${credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>${credit ? 381 : 380}</cbc:${credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>
${inv.note ? `<cbc:Note>${esc(inv.note)}</cbc:Note>\n` : ''}<cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
${inv.buyerReference ? `<cbc:BuyerReference>${esc(inv.buyerReference)}</cbc:BuyerReference>\n` : ''}${inv.orderReference ? `<cac:OrderReference><cbc:ID>${esc(inv.orderReference)}</cbc:ID></cac:OrderReference>\n` : ''}${inv.credit ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${inv.credit.originalNumber}</cbc:ID>${inv.credit.originalDate ? `<cbc:IssueDate>${inv.credit.originalDate}</cbc:IssueDate>` : ''}</cac:InvoiceDocumentReference></cac:BillingReference>\n` : ''}${party(inv.seller, 'AccountingSupplierParty')}
${party(inv.buyer, 'AccountingCustomerParty')}
${inv.deliveryDate && /^\d{4}-\d{2}-\d{2}$/.test(inv.deliveryDate) ? `<cac:Delivery><cbc:ActualDeliveryDate>${inv.deliveryDate}</cbc:ActualDeliveryDate></cac:Delivery>\n` : ''}${means}
${pay.terms && !credit ? `<cac:PaymentTerms><cbc:Note>${esc(pay.terms)}</cbc:Note></cac:PaymentTerms>\n` : ''}<cac:TaxTotal><cbc:TaxAmount ${c(inv.totals.vat)}</cbc:TaxAmount>
${subtotals}
</cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount ${c(inv.totals.net)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount ${c(inv.totals.net)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount ${c(inv.totals.net + inv.totals.vat)}</cbc:TaxInclusiveAmount>${inv.totals.rounding ? `<cbc:PayableRoundingAmount ${c(inv.totals.rounding)}</cbc:PayableRoundingAmount>` : ''}<cbc:PayableAmount ${c(inv.totals.total)}</cbc:PayableAmount></cac:LegalMonetaryTotal>
${lines}
</${root}>
`;
}
