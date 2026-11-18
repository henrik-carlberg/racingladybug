import 'server-only';
import { sql } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import type { ApiRoute, Schema } from './router';
import { page } from '@/lib/services/input';
import * as accounts from '@/lib/services/accounts';
import * as vouchers from '@/lib/services/vouchers';
import * as customers from '@/lib/services/customers';
import * as invoices from '@/lib/services/invoices';
import * as suppliers from '@/lib/services/suppliers';
import * as payroll from '@/lib/services/payroll';
import * as reports from '@/lib/services/reports';
import * as bank from '@/lib/services/bank';
import * as docs from '@/lib/services/documents';
import * as time from '@/lib/services/time';

export const CORE_SCOPES = [
  { scope: 'accounting:read', description: 'Läsa kontoplan, verifikationer, saldon och momsrapporter' },
  { scope: 'accounting:write', description: 'Bokföra verifikationer, rättelser, konton och momsavräkning' },
  { scope: 'sales:read', description: 'Läsa kunder och kundfakturor' },
  { scope: 'sales:write', description: 'Skapa/ändra kunder och fakturor, bokföra, registrera betalning, kreditera' },
  { scope: 'time:read', description: 'Läsa uppdrag, aktiviteter, tidrader och timbanker' },
  { scope: 'time:write', description: 'Rapportera tid, skapa uppdrag och skapa fakturaunderlag och timbanksavräkningar' },
  { scope: 'purchasing:read', description: 'Läsa leverantörer och leverantörsfakturor' },
  { scope: 'purchasing:write', description: 'Registrera, attestera och betala leverantörsfakturor' },
  { scope: 'payroll:read', description: 'Läsa anställda (inkl. personnummer), lönekörningar och AGI' },
  { scope: 'payroll:write', description: 'Ändra anställda och lönekörningar, bokföra lön' },
  { scope: 'bank:read', description: 'Läsa bankkonton och banktransaktioner' },
  { scope: 'bank:write', description: 'Stämma av banktransaktioner, importera kontoutdrag och synka banken' },
  { scope: 'documents:read', description: 'Läsa dokument och signeringsstatus' },
  { scope: 'documents:write', description: 'Skapa dokument och skicka dem för e-signering' },
  { scope: 'events:read', description: 'Läsa händelseloggen' },
];

const id = (p: Record<string, string>, k = 'id') => {
  const n = Number(p[k]);
  if (!Number.isInteger(n) || n <= 0) throw new ValidationError(`Ogiltigt id: ${p[k]}`);
  return n;
};
const q = (query: URLSearchParams, k: string) => query.get(k) ?? undefined;
const qn = (query: URLSearchParams, k: string) => (query.get(k) ? Number(query.get(k)) : undefined);
const PAGING = [
  { name: 'limit', description: 'Antal poster (1–500, standard 50)', type: 'integer' },
  { name: 'starting_after', description: 'Id för sista posten på föregående sida', type: 'integer' },
];

// Återanvända schemafragment (dokumentation)
const ORE = (d: string): Schema => ({ type: 'integer', description: `${d} i öre (1 kr = 100)` });
const DATE: Schema = { type: 'string', format: 'date' };
const VOUCHER_LINE: Schema = { type: 'object', required: ['account'], properties: {
  account: { type: 'integer', example: 1930 }, debit: ORE('Debet'), credit: ORE('Kredit'), description: { type: 'string' } } };
const CUSTOMER: Schema = { type: 'object', properties: {
  name: { type: 'string' }, orgnr: { type: 'string' }, vat_number: { type: 'string' }, email: { type: 'string' }, address: { type: 'string' },
  postal_code: { type: 'string' }, city: { type: 'string' }, country: { type: 'string', example: 'SE' }, payment_terms: { type: 'integer' },
  reverse_charge: { type: 'boolean' } } };
const INVOICE: Schema = { type: 'object', required: ['customer_id', 'invoice_date', 'lines'], properties: {
  customer_id: { type: 'integer' }, invoice_date: DATE, due_date: DATE, delivery_date: { type: 'string' },
  our_reference: { type: 'string' }, your_reference: { type: 'string' }, notes: { type: 'string' },
  book: { type: 'boolean', description: 'true = bokför direkt (tilldelar fakturanummer och OCR)' },
  reduction_type: { type: 'string', enum: ['rot', 'rut'], description: 'ROT- eller RUT-avdrag (fakturamodellen). Kräver buyer_pnr, work_type och för ROT property eller brf_orgnr + apartment_no.' },
  buyer_pnr: { type: 'string', description: 'Köparens personnummer' }, work_type: { type: 'string', description: 'Typ av arbete' },
  property: { type: 'string', description: 'Fastighetsbeteckning (ROT)' }, brf_orgnr: { type: 'string' }, apartment_no: { type: 'string' },
  reduction_max: ORE('Köparens återstående tak för året, om känt'),
  advance: { type: 'boolean', description: 'Förskottsfaktura: raderna bokförs mot 2420 Förskott från kunder och kan sedan avräknas på slutfakturan' },
  lines: { type: 'array', items: { type: 'object', required: ['description', 'unit_price'], properties: {
    description: { type: 'string' }, quantity: { type: 'number', default: 1 }, unit: { type: 'string', default: 'st' },
    unit_price: ORE('À-pris exkl. moms'), vat_rate: { type: 'integer', enum: [0, 6, 12, 25], default: 25 },
    account: { type: 'integer', description: 'Intäktskonto (standard efter momssats)' },
    labor: { type: 'boolean', description: 'Arbetskostnad (grund för ROT/RUT-avdrag)' } } } } } };
const SUPPLIER: Schema = { type: 'object', properties: {
  name: { type: 'string' }, orgnr: { type: 'string' }, bankgiro: { type: 'string' }, plusgiro: { type: 'string' },
  bank_account: { type: 'string' }, default_account: { type: 'integer', example: 4010 }, email: { type: 'string' } } };
const EMPLOYEE: Schema = { type: 'object', properties: {
  first_name: { type: 'string' }, last_name: { type: 'string' }, personal_number: { type: 'string', example: '19811218-9876' },
  email: { type: 'string' }, monthly_salary: ORE('Månadslön'), tax_mode: { type: 'string', enum: ['table', 'percent'] },
  tax_table: { type: 'integer' }, tax_column: { type: 'integer' }, tax_percent: { type: 'number' }, fee_override: { type: 'number' },
  employment_start: DATE, employment_end: DATE, bank_clearing: { type: 'string' }, bank_account: { type: 'string' }, active: { type: 'boolean' } } };

export const CORE_ROUTES: ApiRoute[] = [
  // Bolag
  { method: 'GET', path: '/company', scope: 'accounting:read', tag: 'Bolag', summary: 'Bolaget som API-nyckeln tillhör',
    handler: async ({ actor }) => {
      const [c] = await sql`SELECT id, 'company' AS object, name, orgnr, company_type, vat_period, vat_number, address, postal_code, city,
        email, phone, bankgiro, plusgiro, iban, f_skatt, invoice_terms, to_char(locked_until,'YYYY-MM-DD') AS locked_until FROM companies WHERE id = ${actor.companyId}`;
      const years = await sql`SELECT id, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, closed
        FROM fiscal_years WHERE company_id = ${actor.companyId} ORDER BY start_date`;
      return { ...c, fiscal_years: years };
    } },

  // Bokföring
  { method: 'GET', path: '/accounts', scope: 'accounting:read', tag: 'Bokföring', summary: 'Kontoplan',
    handler: async ({ actor }) => ({ object: 'list', data: await accounts.listAccounts(actor.companyId), has_more: false }) },
  { method: 'POST', path: '/accounts', scope: 'accounting:write', tag: 'Bokföring', summary: 'Lägg till eller byt namn på konto',
    body: { type: 'object', required: ['number', 'name'], properties: { number: { type: 'integer' }, name: { type: 'string' }, active: { type: 'boolean' } } },
    handler: ({ actor, body }) => accounts.upsertAccount(actor, body) },
  { method: 'GET', path: '/vouchers', scope: 'accounting:read', tag: 'Bokföring', summary: 'Lista verifikationer',
    query: [...PAGING, { name: 'from', description: 'Från datum' }, { name: 'to', description: 'Till datum' }, { name: 'series', description: 'Serie (A, B, C, L)' }],
    handler: ({ actor, query }) => vouchers.listVouchers(actor.companyId, page(query), { from: q(query, 'from'), to: q(query, 'to'), series: q(query, 'series') }) },
  { method: 'GET', path: '/vouchers/:id', scope: 'accounting:read', tag: 'Bokföring', summary: 'Hämta verifikation',
    handler: ({ actor, params }) => vouchers.getVoucher(actor.companyId, id(params)) },
  { method: 'POST', path: '/vouchers', scope: 'accounting:write', tag: 'Bokföring', status: 201, summary: 'Bokför verifikation',
    description: 'Verifikationen måste balansera. Den kan inte ändras eller tas bort i efterhand – rätta med POST /vouchers/{id}/reverse.',
    body: { type: 'object', required: ['date', 'description', 'lines'], properties: {
      date: DATE, description: { type: 'string' }, series: { type: 'string', default: 'A' }, lines: { type: 'array', items: VOUCHER_LINE } } },
    handler: ({ actor, body }) => vouchers.createManualVoucher(actor, body) },
  { method: 'POST', path: '/vouchers/:id/reverse', scope: 'accounting:write', tag: 'Bokföring', status: 201, summary: 'Rättelseverifikation',
    body: { type: 'object', required: ['date'], properties: { date: DATE, reason: { type: 'string' } } },
    handler: ({ actor, params, body }) => vouchers.reverse(actor, id(params), body) },
  { method: 'GET', path: '/reports/balances', scope: 'accounting:read', tag: 'Rapporter', summary: 'Saldon per konto',
    query: [{ name: 'from', description: 'Från datum (krävs)' }, { name: 'to', description: 'Till datum (krävs)' }],
    handler: ({ actor, query }) => reports.getBalances(actor.companyId, req(query, 'from'), req(query, 'to')) },
  { method: 'GET', path: '/reports/vat', scope: 'accounting:read', tag: 'Rapporter', summary: 'Momsrapport (rutor i momsdeklarationen)',
    query: [{ name: 'from', description: 'Från datum (krävs)' }, { name: 'to', description: 'Till datum (krävs)' }],
    handler: ({ actor, query }) => reports.getVatReport(actor.companyId, req(query, 'from'), req(query, 'to')) },
  { method: 'POST', path: '/reports/vat/settle', scope: 'accounting:write', tag: 'Rapporter', status: 201, summary: 'Bokför momsavräkning',
    body: { type: 'object', required: ['from', 'to'], properties: { from: DATE, to: DATE } },
    handler: ({ actor, body }) => reports.settleVat(actor, String(body.from ?? ''), String(body.to ?? '')) },

  // Försäljning
  { method: 'GET', path: '/customers', scope: 'sales:read', tag: 'Försäljning', summary: 'Lista kunder',
    query: [...PAGING, { name: 'q', description: 'Sök på namn, org.nr eller e-post' }],
    handler: ({ actor, query }) => customers.listCustomers(actor.companyId, page(query), { q: q(query, 'q') }) },
  { method: 'GET', path: '/customers/:id', scope: 'sales:read', tag: 'Försäljning', summary: 'Hämta kund',
    handler: ({ actor, params }) => customers.getCustomer(actor.companyId, id(params)) },
  { method: 'POST', path: '/customers', scope: 'sales:write', tag: 'Försäljning', status: 201, summary: 'Skapa kund', body: { ...CUSTOMER, required: ['name'] },
    handler: ({ actor, body }) => customers.createCustomer(actor, body) },
  { method: 'PATCH', path: '/customers/:id', scope: 'sales:write', tag: 'Försäljning', summary: 'Uppdatera kund (endast angivna fält)', body: CUSTOMER,
    handler: ({ actor, params, body }) => customers.updateCustomer(actor, id(params), body) },
  { method: 'GET', path: '/invoices', scope: 'sales:read', tag: 'Försäljning', summary: 'Lista kundfakturor',
    query: [...PAGING, { name: 'status', description: 'draft, booked, paid eller credited' }, { name: 'customer_id', description: 'Kund' },
      { name: 'from', description: 'Fakturadatum från' }, { name: 'to', description: 'Fakturadatum till' }],
    handler: ({ actor, query }) => invoices.listInvoices(actor.companyId, page(query), {
      status: q(query, 'status'), customer_id: qn(query, 'customer_id'), from: q(query, 'from'), to: q(query, 'to') }) },
  { method: 'GET', path: '/invoices/:id', scope: 'sales:read', tag: 'Försäljning', summary: 'Hämta kundfaktura',
    handler: ({ actor, params }) => invoices.getInvoice(actor.companyId, id(params)) },
  { method: 'POST', path: '/invoices', scope: 'sales:write', tag: 'Försäljning', status: 201, summary: 'Skapa fakturautkast (och bokför med book: true)', body: INVOICE,
    handler: async ({ actor, body }) => {
      const inv = await invoices.saveDraft(actor, null, body);
      return body.book === true ? invoices.bookInvoice(actor, inv.id) : inv;
    } },
  { method: 'PATCH', path: '/invoices/:id', scope: 'sales:write', tag: 'Försäljning', summary: 'Ersätt innehållet i ett utkast', body: INVOICE,
    handler: ({ actor, params, body }) => invoices.saveDraft(actor, id(params), body) },
  { method: 'DELETE', path: '/invoices/:id', scope: 'sales:write', tag: 'Försäljning', summary: 'Ta bort utkast',
    handler: ({ actor, params }) => invoices.deleteDraft(actor, id(params)) },
  { method: 'POST', path: '/invoices/:id/book', scope: 'sales:write', tag: 'Försäljning', summary: 'Bokför faktura',
    handler: ({ actor, params }) => invoices.bookInvoice(actor, id(params)) },
  { method: 'POST', path: '/invoices/:id/payments', scope: 'sales:write', tag: 'Försäljning', summary: 'Registrera inbetalning (hel eller delbetalning)',
    body: { type: 'object', required: ['date'], properties: { date: DATE, amount: ORE('Belopp (standard: det som återstår). Ett lägre belopp blir en delbetalning.'), bank_account: { type: 'integer', default: 1930 } } },
    handler: ({ actor, params, body }) => invoices.registerPayment(actor, id(params), body) },
  { method: 'POST', path: '/invoices/:id/settle-advance', scope: 'sales:write', tag: 'Försäljning', summary: 'Avräkna en betald förskottsfaktura på ett utkast',
    body: { type: 'object', required: ['advance_invoice_id'], properties: { advance_invoice_id: { type: 'integer' } } },
    handler: ({ actor, params, body }) => invoices.settleAdvance(actor, id(params), Number((body as Record<string, unknown>).advance_invoice_id)) },
  { method: 'POST', path: '/invoices/:id/credit', scope: 'sales:write', tag: 'Försäljning', status: 201, summary: 'Kreditera hela fakturan (returnerar kreditfakturan)',
    body: { type: 'object', required: ['date'], properties: { date: DATE } },
    handler: ({ actor, params, body }) => invoices.creditInvoice(actor, id(params), body) },

  // Inköp
  { method: 'GET', path: '/projects', scope: 'time:read', tag: 'Tid', summary: 'Lista uppdrag med aktiviteter, ofakturerad tid och timbank',
    query: [{ name: 'active', description: 'true eller false' }, { name: 'customer_id', description: 'Kund' }],
    handler: async ({ actor, query }) => ({ object: 'list', data: await time.listProjects(actor.companyId, {
      active: q(query, 'active') == null ? undefined : q(query, 'active') === 'true', customer_id: qn(query, 'customer_id') }), has_more: false }) },
  { method: 'GET', path: '/projects/:id', scope: 'time:read', tag: 'Tid', summary: 'Hämta uppdrag',
    handler: ({ actor, params }) => time.getProject(actor.companyId, id(params)) },
  { method: 'POST', path: '/projects', scope: 'time:write', tag: 'Tid', status: 201, summary: 'Skapa uppdrag',
    body: { type: 'object', required: ['customer_id', 'name'], properties: {
      customer_id: { type: 'integer' }, name: { type: 'string' }, billing: { type: 'string', enum: ['hourly', 'hour_bank', 'fixed', 'internal'] },
      hourly_rate: { type: 'integer', description: 'Öre per timme exkl. moms' }, vat_rate: { type: 'integer', enum: [0, 6, 12, 25] },
      activities: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } } },
    handler: ({ actor, body }) => time.createProject(actor, body) },
  { method: 'GET', path: '/time-entries', scope: 'time:read', tag: 'Tid', summary: 'Lista tidrader',
    query: [{ name: 'from', description: 'Datum från' }, { name: 'to', description: 'Datum till' }, { name: 'project_id', description: 'Uppdrag' },
      { name: 'user_id', description: 'Användare' }, { name: 'unbilled', description: 'true = bara ofakturerad debiterbar tid' }],
    handler: async ({ actor, query }) => ({ object: 'list', has_more: false, data: await time.listTimeEntries(actor.companyId, {
      from: q(query, 'from'), to: q(query, 'to'), project_id: qn(query, 'project_id'), user_id: qn(query, 'user_id'), unbilled: q(query, 'unbilled') === 'true' }) }) },
  { method: 'POST', path: '/time-entries', scope: 'time:write', tag: 'Tid', status: 201, summary: 'Rapportera tid (som API-nyckelns användare)',
    body: { type: 'object', required: ['activity_id', 'date'], properties: {
      activity_id: { type: 'integer' }, date: DATE, minutes: { type: 'integer' }, hours: { type: 'string', description: 'Alternativ till minutes, t.ex. "1,5" eller "1:30"' },
      description: { type: 'string' }, billable: { type: 'boolean' } } },
    handler: ({ actor, body }) => time.createTimeEntry(actor, body) },
  { method: 'DELETE', path: '/time-entries/:id', scope: 'time:write', tag: 'Tid', summary: 'Ta bort ofakturerad tidrad',
    handler: ({ actor, params }) => time.deleteTimeEntry(actor, id(params)) },
  { method: 'POST', path: '/projects/:id/invoice', scope: 'time:write', tag: 'Tid', status: 201, summary: 'Fakturaunderlag: ofakturerad tid blir fakturautkast',
    body: { type: 'object', required: ['to'], properties: { from: DATE, to: DATE, invoice_date: DATE } },
    handler: ({ actor, params, body }) => time.invoiceTime(actor, id(params), body) },
  { method: 'POST', path: '/projects/:id/hour-bank', scope: 'time:write', tag: 'Tid', status: 201, summary: 'Köp av timbank (fakturautkast)',
    body: { type: 'object', required: ['hours'], properties: { hours: { type: 'string' }, hourly_rate: { type: 'integer' }, date: DATE } },
    handler: ({ actor, params, body }) => time.buyHourBank(actor, id(params), body) },
  { method: 'POST', path: '/projects/:id/hour-bank/statements', scope: 'time:write', tag: 'Tid', status: 201, summary: 'Månadsavräkning av timbank (fakturautkast)',
    body: { type: 'object', required: ['period'], properties: { period: { type: 'string', description: 'ÅÅÅÅ-MM' }, invoice_date: DATE } },
    handler: ({ actor, params, body }) => time.bankStatementInvoice(actor, id(params), body) },
  { method: 'GET', path: '/suppliers', scope: 'purchasing:read', tag: 'Inköp', summary: 'Lista leverantörer', query: PAGING,
    handler: ({ actor, query }) => suppliers.listSuppliers(actor.companyId, page(query)) },
  { method: 'GET', path: '/suppliers/:id', scope: 'purchasing:read', tag: 'Inköp', summary: 'Hämta leverantör',
    handler: ({ actor, params }) => suppliers.getSupplier(actor.companyId, id(params)) },
  { method: 'POST', path: '/suppliers', scope: 'purchasing:write', tag: 'Inköp', status: 201, summary: 'Skapa leverantör', body: { ...SUPPLIER, required: ['name'] },
    handler: ({ actor, body }) => suppliers.createSupplier(actor, body) },
  { method: 'PATCH', path: '/suppliers/:id', scope: 'purchasing:write', tag: 'Inköp', summary: 'Uppdatera leverantör', body: SUPPLIER,
    handler: ({ actor, params, body }) => suppliers.updateSupplier(actor, id(params), body) },
  { method: 'GET', path: '/supplier-invoices', scope: 'purchasing:read', tag: 'Inköp', summary: 'Lista leverantörsfakturor',
    query: [...PAGING, { name: 'status', description: 'booked, approved eller paid' }, { name: 'supplier_id', description: 'Leverantör' }],
    handler: ({ actor, query }) => suppliers.listSupplierInvoices(actor.companyId, page(query), { status: q(query, 'status'), supplier_id: qn(query, 'supplier_id') }) },
  { method: 'GET', path: '/supplier-invoices/:id', scope: 'purchasing:read', tag: 'Inköp', summary: 'Hämta leverantörsfaktura',
    handler: ({ actor, params }) => suppliers.getSupplierInvoice(actor.companyId, id(params)) },
  { method: 'POST', path: '/supplier-invoices', scope: 'purchasing:write', tag: 'Inköp', status: 201, summary: 'Registrera och bokför leverantörsfaktura',
    description: 'Utan lines konteras hela beloppet exkl. moms på leverantörens standardkonto.',
    body: { type: 'object', required: ['supplier_id', 'invoice_number', 'invoice_date', 'total'], properties: {
      supplier_id: { type: 'integer' }, invoice_number: { type: 'string' }, invoice_date: DATE, due_date: DATE,
      payment_reference: { type: 'string' }, description: { type: 'string' }, total: ORE('Att betala inkl. moms'), vat: ORE('Ingående moms'),
      lines: { type: 'array', items: { type: 'object', required: ['account', 'amount'], properties: { account: { type: 'integer' }, amount: ORE('Belopp exkl. moms'), description: { type: 'string' } } } } } },
    handler: ({ actor, body }) => suppliers.registerSupplierInvoice(actor, body) },
  { method: 'POST', path: '/supplier-invoices/:id/approve', scope: 'purchasing:write', tag: 'Inköp', summary: 'Attestera för betalning',
    handler: ({ actor, params }) => suppliers.approveSupplierInvoice(actor, id(params)) },
  { method: 'POST', path: '/supplier-invoices/:id/pay', scope: 'purchasing:write', tag: 'Inköp', summary: 'Bokför betalning (hel eller delbetalning)',
    body: { type: 'object', required: ['date'], properties: { date: DATE, amount: ORE('Belopp (standard: det som återstår)'), bank_account: { type: 'integer', default: 1930 } } },
    handler: async ({ actor, params, body }) => (await suppliers.paySupplierInvoices(actor, [id(params)], body))[0] },

  // Lön
  { method: 'GET', path: '/employees', scope: 'payroll:read', tag: 'Lön', summary: 'Lista anställda', query: PAGING,
    handler: ({ actor, query }) => payroll.listEmployees(actor.companyId, page(query)) },
  { method: 'GET', path: '/employees/:id', scope: 'payroll:read', tag: 'Lön', summary: 'Hämta anställd',
    handler: ({ actor, params }) => payroll.getEmployee(actor.companyId, id(params)) },
  { method: 'POST', path: '/employees', scope: 'payroll:write', tag: 'Lön', status: 201, summary: 'Lägg upp anställd',
    body: { ...EMPLOYEE, required: ['first_name', 'last_name', 'personal_number'] },
    handler: ({ actor, body }) => payroll.createEmployee(actor, body) },
  { method: 'PATCH', path: '/employees/:id', scope: 'payroll:write', tag: 'Lön', summary: 'Uppdatera anställd', body: EMPLOYEE,
    handler: ({ actor, params, body }) => payroll.updateEmployee(actor, id(params), body) },
  { method: 'GET', path: '/payroll-runs', scope: 'payroll:read', tag: 'Lön', summary: 'Lista lönekörningar', query: PAGING,
    handler: ({ actor, query }) => payroll.listPayrollRuns(actor.companyId, page(query)) },
  { method: 'GET', path: '/payroll-runs/:id', scope: 'payroll:read', tag: 'Lön', summary: 'Hämta lönekörning med lönespecar',
    handler: ({ actor, params }) => payroll.getPayrollRun(actor.companyId, id(params)) },
  { method: 'POST', path: '/payroll-runs', scope: 'payroll:write', tag: 'Lön', status: 201, summary: 'Skapa lönekörning (alla aktiva anställda)',
    body: { type: 'object', required: ['period', 'payment_date'], properties: { period: { type: 'string', example: '2026-05' }, payment_date: DATE } },
    handler: ({ actor, body }) => payroll.createPayrollRun(actor, body) },
  { method: 'PATCH', path: '/payroll-runs/:id/payslips/:slip', scope: 'payroll:write', tag: 'Lön', summary: 'Ersätt lönerader i en lönespec',
    body: { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { type: 'object', required: ['type', 'amount'], properties: {
      type: { type: 'string', enum: ['salary', 'benefit', 'net_deduction', 'reimbursement'] }, description: { type: 'string' },
      amount: ORE('Belopp'), account: { type: 'integer', description: 'Kostnadskonto för utlägg' } } } } } },
    handler: ({ actor, params, body }) => payroll.updatePayslip(actor, id(params), id(params, 'slip'), body) },
  { method: 'POST', path: '/payroll-runs/:id/book', scope: 'payroll:write', tag: 'Lön', summary: 'Bokför lönekörning',
    handler: ({ actor, params }) => payroll.bookPayrollRun(actor, id(params)) },
  { method: 'GET', path: '/payroll-runs/:id/agi', scope: 'payroll:read', tag: 'Lön', summary: 'AGI-fil (XML) för Skatteverket',
    handler: async ({ actor, params }) => {
      const { filename, xml } = await payroll.buildAgiForRun(actor, id(params));
      return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` } });
    } },

  // Bank
  { method: 'GET', path: '/bank/accounts', scope: 'bank:read', tag: 'Bank', summary: 'Bankkonton med saldo och antal ej avstämda transaktioner',
    handler: async ({ actor }) => ({ object: 'list', data: await bank.listBankAccounts(actor.companyId), has_more: false }) },
  { method: 'POST', path: '/bank/accounts/:id/sync', scope: 'bank:write', tag: 'Bank', summary: 'Hämta nya transaktioner från banken (Open Banking)',
    handler: ({ actor, params }) => bank.syncAccount(actor, id(params)) },
  { method: 'POST', path: '/bank/accounts/:id/import', scope: 'bank:write', tag: 'Bank', summary: 'Importera kontoutdrag (camt.053 XML eller CSV)',
    body: { type: 'object', required: ['content'], properties: { filename: { type: 'string' }, content: { type: 'string', description: 'Filens innehåll som text' } } },
    handler: ({ actor, params, body }) => bank.importFile(actor, id(params), String(body.filename ?? 'fil'), String(body.content ?? '')) },
  { method: 'GET', path: '/bank/transactions', scope: 'bank:read', tag: 'Bank', summary: 'Banktransaktioner med matchningsförslag',
    query: [{ name: 'status', description: 'unmatched, matched eller ignored' }, { name: 'account_id', description: 'Bankkonto' }, { name: 'limit', description: 'Max antal (standard 200)', type: 'integer' }],
    handler: async ({ actor, query }) => ({ object: 'list', has_more: false, data: await bank.listTransactions(actor.companyId, {
      status: q(query, 'status'), account_id: qn(query, 'account_id'), limit: qn(query, 'limit'), withSuggestions: true }) }) },
  { method: 'POST', path: '/bank/transactions/:id/reconcile', scope: 'bank:write', tag: 'Bank', summary: 'Stäm av en banktransaktion',
    description: 'type: invoice (id = kundfaktura), supplier_invoice (id), voucher (id = befintlig verifikation), account (account, vat_rate, description) eller ignore.',
    body: { type: 'object', required: ['type'], properties: { type: { type: 'string', enum: ['invoice', 'supplier_invoice', 'voucher', 'account', 'ignore'] },
      id: { type: 'integer' }, account: { type: 'integer' }, vat_rate: { type: 'integer', enum: [0, 6, 12, 25] }, description: { type: 'string' } } },
    handler: ({ actor, params, body }) => bank.reconcile(actor, id(params), body) },
  { method: 'POST', path: '/bank/transactions/:id/reopen', scope: 'bank:write', tag: 'Bank', summary: 'Ångra ignorering eller koppling',
    handler: ({ actor, params }) => bank.reopen(actor, id(params)) },
  { method: 'POST', path: '/bank/auto-match', scope: 'bank:write', tag: 'Bank', summary: 'Stäm av automatiskt där OCR och belopp stämmer exakt',
    handler: async ({ actor }) => ({ matched: await bank.autoMatch(actor) }) },

  // Dokument och e-signering
  { method: 'GET', path: '/documents', scope: 'documents:read', tag: 'Dokument', summary: 'Lista dokument', query: PAGING,
    handler: ({ actor, query }) => docs.listDocuments(actor.companyId, page(query)) },
  { method: 'GET', path: '/documents/:id', scope: 'documents:read', tag: 'Dokument', summary: 'Hämta dokument med undertecknare och händelser',
    handler: ({ actor, params, origin }) => docs.getDocument(actor.companyId, id(params), origin) },
  { method: 'POST', path: '/documents', scope: 'documents:write', tag: 'Dokument', status: 201, summary: 'Skapa dokument (och skicka för signering med send: true)',
    description: 'Ange html (dokumenttext) eller pdf_base64. Undertecknare med user_id signerar inloggade (passkey/lösenord); övriga får en personlig länk (signing_url i svaret när dokumentet skickats).',
    body: { type: 'object', required: ['title', 'signers'], properties: {
      title: { type: 'string' }, html: { type: 'string' }, pdf_base64: { type: 'string' }, filename: { type: 'string' }, message: { type: 'string' },
      send: { type: 'boolean' }, signers: { type: 'array', items: { type: 'object', required: ['name'], properties: {
        name: { type: 'string' }, email: { type: 'string' }, user_id: { type: 'integer' } } } } } },
    handler: async ({ actor, body, origin }) => {
      const d = await docs.createDocument(actor, body);
      return body.send === true ? docs.sendDocument(actor, d.id, origin) : d;
    } },
  { method: 'POST', path: '/documents/:id/send', scope: 'documents:write', tag: 'Dokument', summary: 'Skicka för signering (returnerar signeringslänkar)',
    handler: ({ actor, params, origin }) => docs.sendDocument(actor, id(params), origin) },
  { method: 'POST', path: '/documents/:id/cancel', scope: 'documents:write', tag: 'Dokument', summary: 'Återkalla dokument',
    handler: ({ actor, params }) => docs.cancelDocument(actor, id(params)) },

  // Händelser
  { method: 'GET', path: '/events', scope: 'events:read', tag: 'Händelser', summary: 'Händelselogg (alternativ till webhooks)',
    description: 'Hämta händelser i ordning. Spara seq för sista händelsen och fråga med after=<seq> nästa gång.',
    query: [{ name: 'after', description: 'Endast händelser med seq större än detta', type: 'integer' }, { name: 'type', description: 'Filtrera på händelsetyp' },
      { name: 'limit', description: 'Antal (1–500)', type: 'integer' }],
    handler: async ({ actor, query }) => {
      const limit = Math.min(Math.max(Number(query.get('limit') ?? 100) || 100, 1), 500);
      const rows = await sql`SELECT public_id AS id, id AS seq, 'event' AS object, type, created_at, data FROM events
        WHERE company_id = ${actor.companyId} AND id > ${Number(query.get('after') ?? 0)}
        ${query.get('type') ? sql`AND type = ${query.get('type')}` : sql``} ORDER BY id LIMIT ${limit + 1}`;
      return { object: 'list', data: rows.slice(0, limit), has_more: rows.length > limit };
    } },
];

function req(query: URLSearchParams, k: string): string {
  const v = query.get(k);
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ValidationError(`Parametern ${k} krävs (ÅÅÅÅ-MM-DD)`);
  return v;
}
