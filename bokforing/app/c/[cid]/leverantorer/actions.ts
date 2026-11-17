'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { createSupplier, updateSupplier } from '@/lib/services/suppliers';

export async function saveSupplier(cid: number, id: number | null, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  const input = {
    name: str(fd, 'name'), orgnr: str(fd, 'orgnr'), bankgiro: str(fd, 'bankgiro'), plusgiro: str(fd, 'plusgiro'),
    bank_account: str(fd, 'bank_account'), default_account: str(fd, 'default_account'), email: str(fd, 'email'),
  };
  await attempt(id ? `/c/${cid}/leverantorer/${id}` : `/c/${cid}/leverantorer`, () => (id ? updateSupplier(actor, id, input) : createSupplier(actor, input)));
  done(`/c/${cid}/leverantorer`, 'Leverantören är sparad');
}
