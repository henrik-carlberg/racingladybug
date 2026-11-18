// Gränssnittet på engelska: ordlista från svensk text till engelsk. Saknas ett ord visas svenskan.
export type UiLang = 'sv' | 'en';

const EN: Record<string, string> = {
  // Meny
  'Bokföring': 'Bookkeeping', 'Översikt': 'Overview', 'Kom igång': 'Get started', '📷 Nytt kvitto': '📷 New receipt', 'Deadlines': 'Deadlines',
  'Verifikationer': 'Vouchers', 'Ny verifikation': 'New voucher', 'Kontoplan': 'Chart of accounts', 'Försäljning': 'Sales', 'Kundfakturor': 'Customer invoices',
  'ROT och RUT': 'ROT and RUT', 'Kassa och e-handel': 'POS and e-commerce', 'Kunder': 'Customers', '⏱ Tidrapportering': '⏱ Time tracking',
  'Uppdrag & timbanker': 'Engagements & hour banks', 'Inköp': 'Purchasing', 'Inkorg för fakturor': 'Invoice inbox', 'Leverantörsfakturor': 'Supplier invoices',
  'Betalningar': 'Payments', 'Leverantörer': 'Suppliers', 'Bank': 'Bank', 'Bankkonton': 'Bank accounts', 'Bankavstämning': 'Bank reconciliation',
  'Konteringsregler': 'Posting rules', 'Skattekontot': 'Tax account', 'Frågor och svar': 'Questions', 'Lön': 'Payroll', 'Lönekörningar': 'Payroll runs',
  'Anställda': 'Employees', 'Frånvaro och semester': 'Absence and vacation', 'Schema': 'Schedule', 'Personalliggare': 'Staff register',
  'Skattetabeller': 'Tax tables', 'Bilförmån': 'Company car benefit', 'Rapporter': 'Reports', 'Instrumentpanel': 'Dashboard',
  'Resultat & balans': 'Income & balance', 'Månadsrapport': 'Monthly report', 'Budget': 'Budget', 'Fråga assistenten': 'Ask the assistant',
  'Huvudbok': 'General ledger', 'Moms': 'VAT', 'EU-handel': 'EU trade', 'Export (SIE)': 'Export (SIE)', 'Resultat per dimension': 'Results by dimension',
  'Anläggningsregister': 'Fixed assets', 'Periodiseringar': 'Accruals', 'Bokslut & deklaration': 'Year-end & tax return', 'Bolaget': 'Company',
  'Inställningar': 'Settings', 'Dataskydd (GDPR)': 'Data protection (GDPR)', 'Kortbetalning': 'Card payments', 'Kostnadsställen': 'Cost centers',
  'Redovisningsbyrå': 'Accounting firm', 'Dokument & e-signering': 'Documents & e-signing', 'Moduler': 'Modules', 'Abonnemang': 'Subscription',
  'Integrationer (API)': 'Integrations (API)', 'Behandlingshistorik': 'Audit log', 'Byt bolag': 'Switch company', 'Mitt konto': 'My account',
  '← Byråvy': '← Firm view', '☰ Meny': '☰ Menu', 'Saker som väntar på dig': 'Things waiting for you', 'Hoppa till innehållet': 'Skip to content',
  'Min sida': 'My page', '⏱ Tidrapport': '⏱ Time report', 'Utlägg och resor': 'Expenses and travel', 'Schema och stämpling': 'Schedule and clock-in', 'Lönespecifikationer': 'Payslips',
  // Roller
  'Ägare': 'Owner', 'Redovisningskonsult': 'Accountant', 'Anställd (självservice)': 'Employee (self-service)', 'Revisor': 'Auditor',
  // Startsida och konto
  'Mina bolag': 'My companies', 'Byråvy': 'Firm view', 'För byråer': 'For accounting firms', 'Koncern': 'Group', 'Logga ut': 'Log out',
  'Bolag': 'Company', 'Org.nr': 'Reg. no.', 'Roll': 'Role', 'Klienter via byrå': 'Clients via firm', 'Lägg upp nytt bolag': 'Add a new company',
  'Språk': 'Language', 'Svenska': 'Swedish', 'Engelska': 'English', 'Spara': 'Save', 'Gränssnittets språk': 'Interface language',
  'Sammandrag via e-post': 'Email digest', 'Byt lösenord': 'Change password', 'Tvåstegsverifiering': 'Two-step verification', 'Passkeys': 'Passkeys',
  'Mina personuppgifter': 'My personal data', 'Inställningen är sparad': 'The setting has been saved',
  // Översikt
  'Att göra': 'To do', 'Intäkter': 'Revenue', 'Kostnader': 'Costs', 'Resultat': 'Result', 'Kassa och bank': 'Cash and bank',
  'Obetalda kundfakturor': 'Unpaid customer invoices', 'Obetalda leverantörsfakturor': 'Unpaid supplier invoices', 'varav förfallna': 'of which overdue',
  'Ej attesterade': 'Not approved', 'Senaste verifikationer': 'Latest vouchers', 'Visa alla': 'Show all',
  // Att göra-listan
  'Förfallna kundfakturor': 'Overdue customer invoices', 'Leverantörsfakturor att attestera': 'Supplier invoices to approve',
  'Leverantörsfakturor att betala inom 7 dagar': 'Supplier invoices due within 7 days', 'Banktransaktioner att stämma av': 'Bank transactions to reconcile',
  'Fakturautkast': 'Invoice drafts', 'Fakturor i inkorgen att granska': 'Invoices in the inbox to review', 'Frånvaro att godkänna': 'Absence to approve',
  'Utlägg att godkänna': 'Expense claims to approve', 'Frågor från byrån': 'Questions from the firm', 'Svar från kunden': 'Answers from the client',
  // Översikt och startsida (fler)
  'Aktiebolag (AB)': 'Limited company (AB)', 'Bank och kassa': 'Bank and cash', 'Enskild firma (enskild näringsidkare)': 'Sole trader',
  'Ett demobolag med kunder, fakturor, leverantörer, bank och en anställd. Det kostar ingenting och kan tas bort.': 'A demo company with customers, invoices, suppliers, bank and an employee. It is free and can be deleted.',
  'Faktureringsmetoden': 'Accrual method (invoice)', 'Fortsätt': 'Continue', 'Företagsnamn': 'Company name', 'Försenad': 'Overdue', 'Inga verifikationer ännu.': 'No vouchers yet.',
  'Kontantmetoden (bokslutsmetoden)': 'Cash method', 'Kvartal': 'Quarter', 'Lönekörning': 'Payroll run', 'Månad': 'Month', 'Ny kundfaktura': 'New customer invoice',
  'Nästa deadlines': 'Upcoming deadlines', 'Org.nr (AB) / personnummer (EF)': 'Reg. no. (AB) / personal ID (sole trader)', 'Registrera leverantörsfaktura': 'Register supplier invoice',
  'Resultat i år': 'Result this year', 'Räkenskapsåret börjar': 'Financial year starts', 'Skapa bolag': 'Create company', 'Skapa demobolag': 'Create demo company',
  'Vad vill du göra?': 'What do you want to do?', 'Vill du prova först?': 'Want to try first?', 'lägg till en passkey': 'add a passkey', 'och slutar': 'and ends', 'År': 'Year',
  'Öppna': 'Open', '🔑 Logga in snabbare och säkrare:': '🔑 Log in faster and more securely:',
  'Försenade deadlines': 'Overdue deadlines', 'Leverantörsfakturor att betala inom en vecka': 'Supplier invoices to pay within a week', 'Frågor att svara på': 'Questions to answer',
  'Nya svar på dina frågor': 'New answers to your questions', 'Kortbetalningar att kontrollera': 'Card payments to check', 'ROT/RUT att begära från Skatteverket': 'ROT/RUT to claim from the Tax Agency',
  'Utläggsräkningar att attestera': 'Expense claims to approve', 'Ledighetsansökningar': 'Leave requests', 'Bokningar att godkänna': 'Bookings to approve',
  'Deadlines inom två veckor': 'Deadlines within two weeks', 'Godkänn personuppgiftsbiträdesavtalet': 'Accept the data processing agreement', 'Slå på tvåstegsverifiering för ditt konto': 'Turn on two-step verification for your account',
  'Bankgiro/Plusgiro': 'Bankgiro/Plusgiro', 'Betalningsförslag': 'Payment proposal', 'E-post': 'Email', 'Fakturanr': 'Invoice no.', 'Förfaller': 'Due',
  'Inga fakturor.': 'No invoices.', 'Inga kunder ännu.': 'No customers yet.', 'Inga leverantörer ännu.': 'No suppliers yet.', 'Inga verifikationer.': 'No vouchers.',
  'Namn': 'Name', 'Nr': 'No.', 'Ny faktura': 'New invoice', 'Ny kund': 'New customer', 'Ny leverantör': 'New supplier', 'Obetalt': 'Unpaid',
  'Registrera faktura': 'Register invoice', 'Rättelse': 'Correction', 'Spara kund': 'Save customer', 'Spara leverantör': 'Save supplier', 'Sök kund': 'Search customer',
  'Räkenskapsår': 'Financial year',
  // Vanliga knappar och rubriker
  'Tillbaka': 'Back', 'Ta bort': 'Delete', 'Redigera': 'Edit', 'Visa': 'Show', 'Datum': 'Date', 'Belopp': 'Amount', 'Beskrivning': 'Description',
  'Status': 'Status', 'Kund': 'Customer', 'Leverantör': 'Supplier', 'Konto': 'Account', 'Summa': 'Total', 'Sök': 'Search',
};

export function tr(lang: UiLang, s: string): string {
  return lang === 'en' ? EN[s] ?? s : s;
}
export const translator = (lang: UiLang) => (s: string) => tr(lang, s);
