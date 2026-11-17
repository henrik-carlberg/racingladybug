'use server';
import { amount, attempt, done, fileFrom, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/suppliers';

export async function registerSupplierInvoice(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  let id = 0;
  await attempt(`/c/${cid}/leverantorsfakturor/ny`, async () => {
    const lines = [];
    for (let i = 0; i < 6; i++) {
      const acc = str(fd, `account_${i}`), amt = str(fd, `amount_${i}`);
      if (!acc && !amt) continue;
      if (!acc || !amt) throw new Error(`Konteringsrad ${i + 1} är ofullständig`);
      lines.push({ account: acc, amount: amount(amt, undefined, `Rad ${i + 1}`), description: str(fd, `text_${i}`) });
    }
    if (lines.length === 0) throw new Error('Ange minst en konteringsrad');
    id = (await svc.registerSupplierInvoice(actor, {
      supplier_id: str(fd, 'supplier_id'), invoice_number: str(fd, 'invoice_number'), invoice_date: str(fd, 'invoice_date'),
      due_date: str(fd, 'due_date'), payment_reference: str(fd, 'payment_reference'), description: str(fd, 'description'),
      total: amount(fd, 'total', 'Totalbelopp'), vat: amount(fd, 'vat', 'Moms') ?? 0, lines,
    }, await fileFrom(fd))).id;
  });
  done(`/c/${cid}/leverantorsfakturor/${id}`, 'Fakturan är registrerad och bokförd');
}

export async function approve(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid));
  await attempt(`/c/${cid}/leverantorsfakturor/${id}`, () => svc.approveSupplierInvoice(actor, id));
  done(`/c/${cid}/leverantorsfakturor/${id}`, 'Fakturan är attesterad för betalning');
}

export async function markPaid(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(`/c/${cid}/leverantorsfakturor/${id}`, () => svc.paySupplierInvoices(actor, [id], { date: str(fd, 'date'), bank_account: str(fd, 'bank_account') }));
  done(`/c/${cid}/leverantorsfakturor/${id}`, 'Betalningen är bokförd');
}

export async function markManyPaid(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  const ids = fd.getAll('ids').map(Number).filter(Boolean);
  await attempt(`/c/${cid}/leverantorsfakturor/betalning`, () => svc.paySupplierInvoices(actor, ids, { date: str(fd, 'date'), bank_account: str(fd, 'bank_account') }));
  done(`/c/${cid}/leverantorsfakturor/betalning`, `${ids.length} betalning(ar) bokförda`);
}
