'use server';
import { sql } from '@/lib/db';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { audit } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { supplierInvoiceLines, supplierPaymentLines, type CostLine } from '@/lib/supplier';
import { parseAmount } from '@/lib/money';

export async function registerSupplierInvoice(cid: number, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  let id = 0;
  await attempt(`/c/${cid}/leverantorsfakturor/ny`, async () => {
    const supplierId = Number(str(fd, 'supplier_id'));
    const [sup] = await sql<{ name: string }[]>`SELECT name FROM suppliers WHERE id = ${supplierId} AND company_id = ${company.id}`;
    if (!sup) throw new Error('Välj leverantör');
    const total = parseAmount(str(fd, 'total'));
    const vat = parseAmount(str(fd, 'vat') || '0');
    if (total == null || total <= 0) throw new Error('Ange fakturans totalbelopp');
    if (vat == null || vat < 0) throw new Error('Ogiltigt momsbelopp');
    const costs: CostLine[] = [];
    for (let i = 0; i < 6; i++) {
      const acc = Number(str(fd, `account_${i}`));
      const amtStr = str(fd, `amount_${i}`);
      if (!acc && !amtStr) continue;
      const amt = parseAmount(amtStr);
      if (!acc || amt == null) throw new Error(`Konteringsrad ${i + 1} är ofullständig`);
      costs.push({ account: acc, amount: amt, description: str(fd, `text_${i}`) });
    }
    if (costs.length === 0) throw new Error('Ange minst en konteringsrad');
    const invoiceNumber = str(fd, 'invoice_number');
    if (!invoiceNumber) throw new Error('Ange leverantörens fakturanummer');
    const date = str(fd, 'invoice_date');
    const lines = supplierInvoiceLines(costs, vat, total);
    const file = fd.get('file');
    await sql.begin(async (tx) => {
      [{ id }] = await tx<{ id: number }[]>`INSERT INTO supplier_invoices ${tx({
        company_id: company.id, supplier_id: supplierId, invoice_number: invoiceNumber, invoice_date: date,
        due_date: str(fd, 'due_date') || date, payment_reference: str(fd, 'payment_reference'), description: str(fd, 'description'),
        total, vat, status: 'booked',
      })} RETURNING id`;
      const v = await createVoucher(tx, {
        companyId: company.id, userId: user.id, date, description: `Leverantörsfaktura ${invoiceNumber}, ${sup.name}`,
        lines, sourceType: 'supplier_invoice', sourceId: id, series: 'C',
      });
      await tx`UPDATE supplier_invoices SET voucher_id = ${v.id} WHERE id = ${id}`;
      if (file instanceof File && file.size > 0) {
        await tx`INSERT INTO attachments (company_id, voucher_id, supplier_invoice_id, filename, mime_type, data, uploaded_by)
          VALUES (${company.id}, ${v.id}, ${id}, ${file.name}, ${file.type || 'application/octet-stream'}, ${Buffer.from(await file.arrayBuffer())}, ${user.id})`;
      }
      await audit(tx, { companyId: company.id, userId: user.id, action: 'register', entity: 'supplier_invoice', entityId: id });
    }).catch((e) => {
      if (String(e?.message).includes('supplier_invoices_company_id_supplier_id_invoice_number_key')) throw new Error('Fakturan är redan registrerad för denna leverantör');
      throw e;
    });
  });
  done(`/c/${cid}/leverantorsfakturor/${id}`, 'Fakturan är registrerad och bokförd');
}

export async function approve(cid: number, id: number) {
  const { company, user } = await requireCompany(cid);
  await sql`UPDATE supplier_invoices SET status = 'approved', approved_by = ${user.id}, approved_at = now()
    WHERE id = ${id} AND company_id = ${company.id} AND status = 'booked'`;
  await audit(sql, { companyId: company.id, userId: user.id, action: 'approve', entity: 'supplier_invoice', entityId: id });
  done(`/c/${cid}/leverantorsfakturor/${id}`, 'Fakturan är attesterad för betalning');
}

async function pay(companyId: number, userId: number, ids: number[], date: string, bankAccount: number) {
  await sql.begin(async (tx) => {
    for (const id of ids) {
      const [inv] = await tx<{ status: string; total: number; invoice_number: string; supplier: string }[]>`
        SELECT i.status, i.total, i.invoice_number, s.name AS supplier FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id
        WHERE i.id = ${id} AND i.company_id = ${companyId} FOR UPDATE OF i`;
      if (!inv) throw new Error('Fakturan finns inte');
      if (inv.status !== 'approved') throw new Error(`Faktura ${inv.invoice_number} (${inv.supplier}) är inte attesterad`);
      const v = await createVoucher(tx, {
        companyId, userId, date, description: `Betalning leverantörsfaktura ${inv.invoice_number}, ${inv.supplier}`,
        lines: supplierPaymentLines(inv.total, bankAccount), sourceType: 'supplier_payment', sourceId: id, series: 'C',
      });
      await tx`UPDATE supplier_invoices SET status = 'paid', paid_date = ${date}, payment_voucher_id = ${v.id} WHERE id = ${id}`;
      await audit(tx, { companyId, userId, action: 'pay', entity: 'supplier_invoice', entityId: id });
    }
  });
}

export async function markPaid(cid: number, id: number, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  await attempt(`/c/${cid}/leverantorsfakturor/${id}`, () => pay(company.id, user.id, [id], str(fd, 'date'), Number(str(fd, 'bank_account')) || 1930));
  done(`/c/${cid}/leverantorsfakturor/${id}`, 'Betalningen är bokförd');
}

export async function markManyPaid(cid: number, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  const ids = fd.getAll('ids').map(Number).filter(Boolean);
  await attempt(`/c/${cid}/leverantorsfakturor/betalning`, async () => {
    if (ids.length === 0) throw new Error('Välj minst en faktura');
    await pay(company.id, user.id, ids, str(fd, 'date'), Number(str(fd, 'bank_account')) || 1930);
  });
  done(`/c/${cid}/leverantorsfakturor/betalning`, `${ids.length} betalning(ar) bokförda`);
}
