// Händelser som kärnan skickar. Moduler kan lägga till egna (se modules/registry.ts).
export interface EventType { type: string; description: string }

export const CORE_EVENTS: EventType[] = [
  { type: 'voucher.created', description: 'En verifikation har bokförts (alla serier, även automatiska)' },
  { type: 'account.updated', description: 'Ett konto har lagts till, bytt namn eller aktiverats/inaktiverats' },
  { type: 'customer.created', description: 'En kund har skapats' },
  { type: 'customer.updated', description: 'En kund har uppdaterats' },
  { type: 'invoice.created', description: 'Ett fakturautkast har skapats' },
  { type: 'invoice.updated', description: 'Ett fakturautkast har ändrats' },
  { type: 'invoice.deleted', description: 'Ett fakturautkast har tagits bort' },
  { type: 'invoice.booked', description: 'En kundfaktura har bokförts och fått fakturanummer' },
  { type: 'invoice.paid', description: 'En inbetalning på en kundfaktura har bokförts' },
  { type: 'invoice.credited', description: 'En kundfaktura har krediterats (data = kreditfakturan)' },
  { type: 'supplier.created', description: 'En leverantör har skapats' },
  { type: 'supplier.updated', description: 'En leverantör har uppdaterats' },
  { type: 'supplier_invoice.registered', description: 'En leverantörsfaktura har registrerats och bokförts' },
  { type: 'supplier_invoice.approved', description: 'En leverantörsfaktura har attesterats' },
  { type: 'supplier_invoice.paid', description: 'En betalning av leverantörsfaktura har bokförts' },
  { type: 'employee.created', description: 'En anställd har lagts upp' },
  { type: 'employee.updated', description: 'En anställd har uppdaterats' },
  { type: 'payroll_run.created', description: 'En lönekörning har skapats' },
  { type: 'payroll_run.booked', description: 'En lönekörning har bokförts' },
  { type: 'vat.settled', description: 'En momsavräkning har bokförts' },
];
