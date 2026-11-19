'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { createSupplier, updateSupplier } from '@/lib/services/suppliers';

export async function saveSupplier(cid: number, id: number | null, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  const input = {
    name: str(fd, 'name'), orgnr: str(fd, 'orgnr'), bankgiro: str(fd, 'bankgiro'), plusgiro: str(fd, 'plusgiro'),
    bank_account: str(fd, 'bank_account'), default_account: str(fd, 'default_account'), email: str(fd, 'email'), cost_center_id: str(fd, 'cost_center_id'),
  };
  let pending = false;
  await attempt(id ? `/c/${cid}/leverantorer/${id}` : `/c/${cid}/leverantorer`, async () => {
    if (id) pending = (await updateSupplier(actor, id, input)).pending_bank_change; else await createSupplier(actor, input);
  });
  done(`/c/${cid}/leverantorer`, pending ? 'Leverantören är sparad. De nya bankuppgifterna gäller först när en annan person har godkänt dem under Varningar och kontroll.' : 'Leverantören är sparad');
}
