// Texter på dokument som går till kunder (faktura, påminnelse, kundlänk) på svenska och engelska
export type Lang = 'sv' | 'en';
export const langOf = (v: unknown): Lang => (v === 'en' ? 'en' : 'sv');

export const DOC = {
  sv: {
    invoice: 'FAKTURA', credit: 'KREDITFAKTURA', number: 'Fakturanummer', date: 'Fakturadatum', due: 'Förfallodatum', delivery: 'Leveransdatum', ocr: 'OCR',
    credits: 'Krediterar faktura', ourRef: 'Vår referens', yourRef: 'Er referens', orgnr: 'Org.nr', vatNo: 'Momsreg.nr',
    description: 'Beskrivning', qty: 'Antal', price: 'À-pris', vat: 'Moms', amount: 'Belopp', net: 'Belopp exkl. moms', vatLine: (r: string, base: string) => `Moms ${r} % (underlag ${base})`,
    rounding: 'Öresavrundning', totalInclVat: 'Totalt inkl. moms', toPay: 'Att betala', toCredit: 'Att kreditera',
    reverseCharge: 'Omvänd betalningsskyldighet', buyerVat: 'Köparens momsreg.nr', fSkatt: 'Godkänd för F-skatt', bankgiro: 'Bankgiro', plusgiro: 'Plusgiro',
    payWithSwish: 'Betala med Swish', swishNumber: 'Swishnummer', message: 'Meddelande', hourBank: 'Timbank – avräkning', timeSpec: 'Tidsspecifikation',
    lateInterest: null as string | null, rate: (c: string, r: string) => `Kurs ${r} kr per ${c}`,
  },
  en: {
    invoice: 'INVOICE', credit: 'CREDIT NOTE', number: 'Invoice number', date: 'Invoice date', due: 'Due date', delivery: 'Delivery date', ocr: 'Payment reference',
    credits: 'Credits invoice', ourRef: 'Our reference', yourRef: 'Your reference', orgnr: 'Reg. no.', vatNo: 'VAT no.',
    description: 'Description', qty: 'Qty', price: 'Unit price', vat: 'VAT', amount: 'Amount', net: 'Total excl. VAT', vatLine: (r: string, base: string) => `VAT ${r} % (on ${base})`,
    rounding: 'Rounding', totalInclVat: 'Total incl. VAT', toPay: 'Amount due', toCredit: 'Amount credited',
    reverseCharge: 'Reverse charge', buyerVat: "Buyer's VAT no.", fSkatt: 'Approved for F-tax', bankgiro: 'Bankgiro', plusgiro: 'Plusgiro',
    payWithSwish: 'Pay with Swish', swishNumber: 'Swish number', message: 'Message', hourBank: 'Hour bank – statement', timeSpec: 'Time specification',
    lateInterest: 'Late payment interest is charged according to the Swedish Interest Act.', rate: (c: string, r: string) => `Rate ${r} SEK per ${c}`,
  },
} as const;
