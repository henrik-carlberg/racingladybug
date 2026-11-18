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

/** Texter på kundens sidor (fakturalänk och kundportal) */
export const PUBLIC = {
  sv: {
    print: 'Skriv ut / spara PDF', payNow: (a: string) => `Betala nu ${a} kr`, paid: (d: string) => `Betald ${d}`, credited: 'Krediterad',
    thanks: 'Tack! Betalningen är mottagen och fakturan markeras som betald inom kort.', payFailed: 'Betalningen kunde inte startas. Försök igen eller betala till bankgiro med OCR-numret.',
    savePdf: 'Välj ”Skriv ut” och sedan ”Spara som PDF” för att spara fakturan.',
    portalAt: (c: string) => `Kundportal hos ${c}`, toPay: 'Att betala', unpaid: (n: number) => `${n} obetalda fakturor`, contact: 'Kontakt',
    quotes: 'Offerter', accepted: (d: string, by: string) => `Godkänd ${d} av ${by}`, expired: 'Utgången', validTo: (d: string) => `Giltig till ${d}`, vat: 'Moms', total: 'Totalt',
    yourName: 'Ditt namn', acceptQuote: 'Godkänn offerten', invoices: 'Fakturor', invoice: 'Faktura', date: 'Datum', due: 'Förfaller', amount: 'Belopp', status: 'Status',
    statusPaid: 'Betald', statusOverdue: 'Förfallen', statusOpen: 'Obetald', pay: 'Betala', noInvoices: 'Inga fakturor ännu.', updateContact: 'Uppdatera dina kontaktuppgifter',
    address: 'Adress', postal: 'Postnummer', city: 'Ort', save: 'Spara', left: (a: string) => `kvar ${a}`,
  },
  en: {
    print: 'Print / save PDF', payNow: (a: string) => `Pay now SEK ${a}`, paid: (d: string) => `Paid ${d}`, credited: 'Credited',
    thanks: 'Thank you! The payment has been received and the invoice will be marked as paid shortly.', payFailed: 'The payment could not be started. Please try again or pay by bank transfer with the payment reference.',
    savePdf: 'Choose “Print” and then “Save as PDF” to save the invoice.',
    portalAt: (c: string) => `Customer portal – ${c}`, toPay: 'Amount due', unpaid: (n: number) => `${n} unpaid invoices`, contact: 'Contact',
    quotes: 'Quotes', accepted: (d: string, by: string) => `Accepted ${d} by ${by}`, expired: 'Expired', validTo: (d: string) => `Valid until ${d}`, vat: 'VAT', total: 'Total',
    yourName: 'Your name', acceptQuote: 'Accept quote', invoices: 'Invoices', invoice: 'Invoice', date: 'Date', due: 'Due', amount: 'Amount', status: 'Status',
    statusPaid: 'Paid', statusOverdue: 'Overdue', statusOpen: 'Unpaid', pay: 'Pay', noInvoices: 'No invoices yet.', updateContact: 'Update your contact details',
    address: 'Address', postal: 'Postal code', city: 'City', save: 'Save', left: (a: string) => `${a} left`,
  },
} as const;
