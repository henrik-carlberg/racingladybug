'use server';
import { amount, attempt, done, fileFrom, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/suppliers';

export async function registerSupplierInvoice(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'purchasing' }));
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
      currency: str(fd, 'currency'), total_currency: amount(fd, 'total_currency', 'Belopp i valutan') ?? undefined,
      cost_center_id: str(fd, 'cost_center_id') || undefined, project_id: str(fd, 'project_id') || undefined,
    }, await fileFrom(fd))).id;
  });
  done(`/c/${cid}/leverantorsfakturor/${id}`, 'Fakturan är registrerad och bokförd');
}

export async function approve(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'attest' }));
  let full = true;
  await attempt(`/c/${cid}/leverantorsfakturor/${id}`, async () => { full = (await svc.approveSupplierInvoice(actor, id)).status === 'approved'; });
  done(`/c/${cid}/leverantorsfakturor/${id}`, full ? 'Fakturan är attesterad för betalning' : 'Första attesten är gjord – fakturan behöver en attest av en annan person');
}

export async function markPaid(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payments' }));
  await attempt(`/c/${cid}/leverantorsfakturor/${id}`, () => svc.paySupplierInvoices(actor, [id], { date: str(fd, 'date'), bank_account: str(fd, 'bank_account'), amount: amount(fd, 'amount') ?? undefined }));
  done(`/c/${cid}/leverantorsfakturor/${id}`, 'Betalningen är bokförd');
}

export async function markManyPaid(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payments' }));
  const ids = fd.getAll('ids').map(Number).filter(Boolean);
  await attempt(`/c/${cid}/leverantorsfakturor/betalning`, () => svc.paySupplierInvoices(actor, ids, { date: str(fd, 'date'), bank_account: str(fd, 'bank_account') }));
  done(`/c/${cid}/leverantorsfakturor/betalning`, `${ids.length} betalning(ar) bokförda`);
}

export async function importPaymentNotification(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payments' }));
  const back = `/c/${cid}/leverantorsfakturor/betalning`;
  let msg = '';
  await attempt(back, async () => {
    const f = await fileFrom(fd);
    if (!f) throw new Error('Välj bankens fil (camt.054)');
    if (f.data.length > 5 * 1024 * 1024) throw new Error('Filen är för stor');
    const r = await svc.applyPaymentNotification(actor, f.data.toString('utf8'), Number(str(fd, 'bank_account')) || 1930);
    msg = [r.paid.length && `${r.paid.length} betalningar bokförda`, r.rejected.length && `avvisade av banken: ${r.rejected.join(', ')}`, r.skipped.length && `hoppade över: ${r.skipped.join(', ')}`].filter(Boolean).join('. ') || 'Inga betalningar att bokföra';
  });
  done(back, msg);
}
