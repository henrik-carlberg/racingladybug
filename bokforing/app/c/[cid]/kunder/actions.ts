'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { createCustomer, updateCustomer } from '@/lib/services/customers';
import { checkNewCustomer } from '@/lib/services/credit';

export async function saveCustomer(cid: number, id: number | null, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  const input = {
    name: str(fd, 'name'), orgnr: str(fd, 'orgnr'), vat_number: str(fd, 'vat_number'), email: str(fd, 'email'), phone: str(fd, 'phone'), delivery: str(fd, 'delivery'), address: str(fd, 'address'),
    postal_code: str(fd, 'postal_code'), city: str(fd, 'city'), country: str(fd, 'country'), payment_terms: str(fd, 'payment_terms'),
    reverse_charge: fd.get('reverse_charge') === 'on', construction_rc: fd.get('construction_rc') === 'on', peppol_id: str(fd, 'peppol_id'), currency: str(fd, 'currency'), language: str(fd, 'language'),
  };
  let created: number | null = null;
  await attempt(id ? `/c/${cid}/kunder/${id}` : `/c/${cid}/kunder`, async () => { if (id) await updateCustomer(actor, id, input); else created = (await createCustomer(actor, input)).id; });
  if (created) await checkNewCustomer(actor, created);
  done(`/c/${cid}/kunder`, 'Kunden är sparad');
}

export async function portal(cid: number, kid: number, rotate: boolean) {
  const { userActor } = await import('@/lib/services/actor');
  const { portalLink } = await import('@/lib/services/portal');
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(`/c/${cid}/kunder/${kid}`, () => portalLink(actor, kid, rotate));
  done(`/c/${cid}/kunder/${kid}`, rotate ? 'Kundportalen har fått en ny länk' : 'Länken till kundportalen är klar');
}

export async function viesCheck(cid: number, kid: number) {
  const { userActor } = await import('@/lib/services/actor');
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  const { viesCheck: check } = await import('@/lib/services/vat-advanced');
  let msg = '';
  await attempt(`/c/${cid}/kunder/${kid}`, async () => { const r = await check(actor, kid); msg = r.valid ? `${r.number} är giltigt i VIES${r.name ? ` (${r.name})` : ''}` : `${r.number} är INTE giltigt enligt VIES – fakturera med svensk moms tills numret är rättat`; });
  done(`/c/${cid}/kunder/${kid}`, msg);
}
