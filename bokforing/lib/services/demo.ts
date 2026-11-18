import 'server-only';
import { sql } from '@/lib/db';
import { audit } from '@/lib/server/audit';
import { basAccountsFor } from '@/lib/bas';
import { addDays, today } from '@/lib/format';
import type { Actor } from './actor';
import { createCustomer } from './customers';
import { bookInvoice, registerPayment, saveDraft } from './invoices';
import { approveSupplierInvoice, createSupplier, registerSupplierInvoice } from './suppliers';
import { createManualVoucher } from './vouchers';
import { createManualAccount, importFile } from './bank';
import { createEmployee } from './payroll';
import { saveOpeningBalances } from './setup';

/**
 * Skapar ett demobolag med exempeldata (kunder, fakturor, leverantörer, bank, anställd) så att man kan prova allt.
 * Demobolag ingår inte i abonnemanget och märks tydligt.
 */
export async function createDemoCompany(userId: number): Promise<number> {
  const t = today();
  const year = t.slice(0, 4);
  const id = await sql.begin(async (tx) => {
    const [c] = await tx<{ id: number }[]>`
      INSERT INTO companies (name, orgnr, company_type, vat_period, accounting_method, is_demo, billing_exempt, address, postal_code, city, email, bankgiro, f_skatt, vat_number)
      VALUES ('Demobolaget AB', '559999-9991', 'AB', 'quarter', 'invoice', true, true, 'Exempelgatan 1', '111 22', 'Stockholm', 'info@demobolaget.example', '123-4567', true, 'SE559999999101')
      RETURNING id`;
    await tx`INSERT INTO memberships (user_id, company_id, role) VALUES (${userId}, ${c.id}, 'owner')`;
    // Innevarande och föregående år, så att exempelfakturor tidigt på året också får plats
    await tx`INSERT INTO fiscal_years (company_id, start_date, end_date) VALUES (${c.id}, ${`${Number(year) - 1}-01-01`}, ${`${Number(year) - 1}-12-31`}), (${c.id}, ${`${year}-01-01`}, ${`${year}-12-31`})`;
    await tx`INSERT INTO accounts ${tx(basAccountsFor('AB').map((a) => ({ company_id: c.id, ...a })))}`;
    await audit(tx, { companyId: c.id, userId, action: 'create_demo', entity: 'company', entityId: c.id });
    return c.id;
  });
  const actor: Actor = { companyId: id, userId, apiKeyId: null, role: 'owner' };
  const [fy] = await sql<{ id: number }[]>`SELECT id FROM fiscal_years WHERE company_id = ${id} ORDER BY start_date LIMIT 1`;
  await saveOpeningBalances(actor, { fiscal_year_id: fy.id, lines: [{ account: 1930, amount: 15000000 }, { account: 2081, amount: 2500000 }, { account: 2091, amount: 12500000 }] });

  const customers = [];
  for (const c of [{ name: 'Nordljus AB', email: 'ekonomi@nordljus.example', orgnr: '556677-8899' }, { name: 'Café Vågen', email: 'hej@cafevagen.example' }, { name: 'Lind Arkitekter', email: 'faktura@lind.example' }]) {
    customers.push(await createCustomer(actor, c));
  }
  const inv = async (cust: number, daysAgo: number, desc: string, qty: number, price: number, pay: boolean) => {
    const d = await saveDraft(actor, null, { customer_id: cust, invoice_date: addDays(t, -daysAgo), lines: [{ description: desc, quantity: qty, unit: 'h', unit_price: price, vat_rate: 25 }] });
    const b = await bookInvoice(actor, d.id);
    if (pay) await registerPayment(actor, b.id, { date: addDays(t, -daysAgo + 20) });
  };
  await inv(customers[0].id, 75, 'Konsulttimmar', 24, 95000, true);
  await inv(customers[1].id, 45, 'Webbplats, etapp 1', 30, 85000, true);
  await inv(customers[2].id, 40, 'Rådgivning', 12, 110000, false);
  await inv(customers[0].id, 10, 'Konsulttimmar', 16, 95000, false);
  await saveDraft(actor, null, { customer_id: customers[1].id, invoice_date: t, lines: [{ description: 'Webbplats, etapp 2', quantity: 20, unit: 'h', unit_price: 85000, vat_rate: 25 }] });

  const landlord = await createSupplier(actor, { name: 'Fastighets AB Kvarnen', bankgiro: '5050-1055', default_account: 5010 });
  const telco = await createSupplier(actor, { name: 'Telia Sverige AB', default_account: 6212 });
  const rent = await registerSupplierInvoice(actor, { supplier_id: landlord.id, invoice_number: `H-${year}-1`, invoice_date: addDays(t, -20), due_date: addDays(t, 10), payment_reference: '100123', total: 1250000, vat: 250000 });
  await approveSupplierInvoice(actor, rent.id);
  await registerSupplierInvoice(actor, { supplier_id: telco.id, invoice_number: 'T-88213', invoice_date: addDays(t, -5), due_date: addDays(t, 25), total: 59900, vat: 11980 });

  await createManualVoucher(actor, { date: addDays(t, -30), description: 'Kontorsmaterial (kvitto)', lines: [{ account: 6110, debit: 40000 }, { account: 2641, debit: 10000 }, { account: 1930, credit: 50000 }] });

  const bankId = await createManualAccount(actor, { name: 'Företagskonto', ledger_account: 1930 });
  const csv = ['Bokföringsdag;Belopp;Text', `${addDays(t, -8)};-499,00;KORTKÖP TELIA SVERIGE AB`, `${addDays(t, -6)};-1250,00;KORTKÖP CIRCLE K`, `${addDays(t, -3)};-95,00;AVGIFT FÖRETAGSPAKET`,
    `${addDays(t, -2)};16500,00;BG INBETALNING LIND ARKITEKTER`].join('\n');
  await importFile(actor, typeof bankId === 'number' ? bankId : (bankId as { id: number }).id, 'demo.csv', csv);

  await createEmployee(actor, { first_name: 'Elin', last_name: 'Exempel', personal_number: '19121212-1212', monthly_salary: 3600000, tax_table: 32, employment_start: `${year}-01-01` });
  return id;
}
