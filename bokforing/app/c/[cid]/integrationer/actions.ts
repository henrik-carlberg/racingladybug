'use server';
import { syncPrice } from '@/lib/services/billing';
import { revalidatePath } from 'next/cache';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { createApiKey, revokeApiKey } from '@/lib/server/apikeys';
import * as integ from '@/lib/server/integrations';

// Integrationer hanteras endast av ägaren (API-nycklar ger åtkomst som motsvarar en användare)
const owner = async (cid: number) => userActor(await requireCompany(cid, { owner: true }));
const back = (cid: number) => `/c/${cid}/integrationer`;

export type KeyState = { error?: string; token?: string } | undefined;

/** Returnerar nyckeln i svaret (visas en gång) – den läggs aldrig i en URL */
export async function addApiKey(cid: number, _prev: KeyState, fd: FormData): Promise<KeyState> {
  const actor = await owner(cid);
  try {
    const { token } = await createApiKey(actor, str(fd, 'name'), fd.getAll('scopes').map(String));
    revalidatePath(back(cid));
    return { token };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Något gick fel' };
  }
}

export async function revokeKey(cid: number, id: number) {
  const actor = await owner(cid);
  await attempt(back(cid), () => revokeApiKey(actor, id));
  done(back(cid), 'API-nyckeln är återkallad');
}

export async function addWebhook(cid: number, fd: FormData) {
  const actor = await owner(cid);
  let id = 0;
  await attempt(back(cid), async () => {
    id = (await integ.createWebhook(actor, { url: str(fd, 'url'), description: str(fd, 'description'), events: fd.getAll('events').map(String) })).id;
  });
  done(`/c/${cid}/integrationer/webhooks/${id}`, 'Webhooken är skapad. Kopiera signeringshemligheten nedan.');
}

export async function toggleWebhook(cid: number, id: number, active: boolean) {
  const actor = await owner(cid);
  await attempt(`/c/${cid}/integrationer/webhooks/${id}`, () => integ.setWebhookActive(actor, id, active));
  done(`/c/${cid}/integrationer/webhooks/${id}`, active ? 'Webhooken är aktiverad' : 'Webhooken är pausad');
}

export async function removeWebhook(cid: number, id: number) {
  const actor = await owner(cid);
  await attempt(`/c/${cid}/integrationer/webhooks/${id}`, () => integ.deleteWebhook(actor, id));
  done(back(cid), 'Webhooken är borttagen');
}

export async function rotateSecret(cid: number, id: number) {
  const actor = await owner(cid);
  await attempt(`/c/${cid}/integrationer/webhooks/${id}`, () => integ.rotateWebhookSecret(actor, id));
  done(`/c/${cid}/integrationer/webhooks/${id}`, 'Ny signeringshemlighet är skapad. Uppdatera mottagaren.');
}

export async function testWebhook(cid: number, id: number) {
  const actor = await owner(cid);
  await attempt(`/c/${cid}/integrationer/webhooks/${id}`, () => integ.sendTestEvent(actor, id));
  done(`/c/${cid}/integrationer/webhooks/${id}`, 'Testhändelse skickad – ladda om sidan om en stund för att se resultatet');
}

export async function retry(cid: number, webhookId: number, deliveryId: number) {
  const actor = await owner(cid);
  await attempt(`/c/${cid}/integrationer/webhooks/${webhookId}`, () => integ.retryDelivery(actor, deliveryId));
  done(`/c/${cid}/integrationer/webhooks/${webhookId}`, 'Leveransen skickas igen');
}

export async function toggleModule(cid: number, moduleId: string, enabled: boolean) {
  const actor = await owner(cid);
  await attempt(`/c/${cid}/moduler`, async () => {
    await integ.setModuleEnabled(actor, moduleId, enabled);
    await syncPrice(actor.companyId).catch((e) => console.error('stripe sync', e));
  });
  done(`/c/${cid}/moduler`, enabled ? 'Modulen är aktiverad' : 'Modulen är avaktiverad');
}
