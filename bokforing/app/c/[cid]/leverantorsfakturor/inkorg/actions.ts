'use server';
import { ValidationError } from '@/lib/errors';
import { enqueue } from '@/lib/server/jobs';
import { amount, attempt, done, result, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/inbox';

const base = (cid: number) => `/c/${cid}/leverantorsfakturor/inkorg`;

export async function upload(cid: number, fd: FormData) {
  const ctx = await requireCompany(cid, { perm: 'purchasing' });
  const ids: number[] = [];
  await attempt(base(cid), async () => {
    const files = fd.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new Error('Välj en eller flera filer');
    for (const f of files.slice(0, 20)) {
      const id = await svc.addDocument(ctx.company.id, { source: 'upload', filename: f.name, mimeType: f.type, data: Buffer.from(await f.arrayBuffer()), uploadedBy: ctx.user.id });
      if (id) ids.push(id);
    }
  });
  for (const id of ids) await enqueue('inbox.process', { id });
  done(base(cid), ids.length === 1 ? 'Fakturan är uppladdad' : `${ids.length} fakturor är uppladdade`);
}

export async function register(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'purchasing' }));
  let siId = 0;
  await attempt(`${base(cid)}/${id}`, async () => {
    siId = (await svc.registerFromInbox(actor, id, {
      supplier_id: str(fd, 'supplier_id'),
      new_supplier: { name: str(fd, 'new_name'), orgnr: str(fd, 'new_orgnr'), bankgiro: str(fd, 'new_bankgiro'), plusgiro: str(fd, 'new_plusgiro'), default_account: str(fd, 'account') },
      invoice_number: str(fd, 'invoice_number'), invoice_date: str(fd, 'invoice_date'), due_date: str(fd, 'due_date'),
      payment_reference: str(fd, 'payment_reference'), description: str(fd, 'description'),
      total: amount(fd, 'total', 'Att betala'), vat: amount(fd, 'vat', 'Moms'), account: str(fd, 'account'),
    })).id;
  });
  done(`/c/${cid}/leverantorsfakturor/${siId}`, 'Fakturan är registrerad från inkorgen');
}

export async function reject(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'purchasing' }));
  await attempt(`${base(cid)}/${id}`, () => svc.rejectDocument(actor, id));
  done(base(cid), 'Dokumentet är borttaget ur inkorgen');
}

export async function reopen(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'purchasing' }));
  await attempt(base(cid), () => svc.reopenDocument(actor, id));
  done(`${base(cid)}/${id}`);
}

export async function retry(cid: number, id: number) {
  const ctx = await requireCompany(cid, { perm: 'purchasing' });
  const actor = userActor(ctx);
  await attempt(`${base(cid)}/${id}`, async () => { if (!ctx.aiAccess) throw new ValidationError('Du har inte tillgång till automatisk avläsning'); await svc.retryDocument(actor, id); });
  done(`${base(cid)}/${id}`, 'Fakturan är tolkad igen');
}

export async function rotateAddress(cid: number) {
  const actor = userActor(await requireCompany(cid, { owner: true, perm: 'purchasing' }));
  await attempt(base(cid), () => svc.newInboxAddress(actor));
  done(base(cid), 'Inkorgen har fått en ny adress. Den gamla tar inte längre emot fakturor.');
}

export async function rejectNow(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'purchasing' }));
  return result(() => svc.rejectDocument(actor, id));
}
