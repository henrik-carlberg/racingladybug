'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { createCustomer, updateCustomer } from '@/lib/services/customers';

export async function saveCustomer(cid: number, id: number | null, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  const input = {
    name: str(fd, 'name'), orgnr: str(fd, 'orgnr'), vat_number: str(fd, 'vat_number'), email: str(fd, 'email'), address: str(fd, 'address'),
    postal_code: str(fd, 'postal_code'), city: str(fd, 'city'), country: str(fd, 'country'), payment_terms: str(fd, 'payment_terms'),
    reverse_charge: fd.get('reverse_charge') === 'on', construction_rc: fd.get('construction_rc') === 'on', peppol_id: str(fd, 'peppol_id'), currency: str(fd, 'currency'), language: str(fd, 'language'),
  };
  await attempt(id ? `/c/${cid}/kunder/${id}` : `/c/${cid}/kunder`, () => (id ? updateCustomer(actor, id, input) : createCustomer(actor, input)));
  done(`/c/${cid}/kunder`, 'Kunden är sparad');
}

export async function portal(cid: number, kid: number, rotate: boolean) {
  const { userActor } = await import('@/lib/services/actor');
  const { portalLink } = await import('@/lib/services/portal');
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(`/c/${cid}/kunder/${kid}`, () => portalLink(actor, kid, rotate));
  done(`/c/${cid}/kunder/${kid}`, rotate ? 'Kundportalen har fått en ny länk' : 'Länken till kundportalen är klar');
}
