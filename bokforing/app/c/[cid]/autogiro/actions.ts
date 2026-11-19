'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/autogiro';

const base = (cid: number) => `/c/${cid}/autogiro`;
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'invoicing' }));

export async function settings(cid: number, fd: FormData) {
  const a = await actorFor(cid);
  await attempt(base(cid), () => svc.saveSettings(a, str(fd, 'customer_no')));
  done(base(cid), 'Kundnumret är sparat');
}
export async function addMandate(cid: number, fd: FormData) {
  const a = await actorFor(cid);
  await attempt(base(cid), () => svc.addMandate(a, { customer_id: Number(str(fd, 'customer_id')), payer_number: str(fd, 'payer_number'), clearing: str(fd, 'clearing'), account: str(fd, 'account'), id_number: str(fd, 'id_number') }));
  done(base(cid), 'Medgivandet är registrerat – skapa en medgivandefil och skicka till Bankgirot');
}
export async function mandateFile(cid: number) {
  const a = await actorFor(cid);
  let id = 0;
  await attempt(base(cid), async () => { id = await svc.createMandateFile(a); });
  done(`${base(cid)}?fil=${id}`, 'Medgivandefilen är skapad – ladda ner den och skicka till Bankgirot');
}
export async function setStatus(cid: number, id: number, status: 'active' | 'cancelled') {
  const a = await actorFor(cid);
  await attempt(base(cid), () => svc.setMandateStatus(a, id, status));
  done(base(cid), status === 'active' ? 'Medgivandet är aktivt' : 'Medgivandet är makulerat – skicka makuleringsfilen till Bankgirot');
}
export async function drawFile(cid: number, fd: FormData) {
  const a = await actorFor(cid);
  let id = 0;
  await attempt(base(cid), async () => { id = await svc.createDrawFile(a, fd.getAll('invoice').map(Number)); });
  done(`${base(cid)}?fil=${id}`, 'Dragningsfilen är skapad – ladda ner den och skicka till Bankgirot');
}
export async function importResult(cid: number, fd: FormData) {
  const a = await actorFor(cid);
  let r = { paid: 0, failed: 0, unknown: 0 };
  const f = fd.get('file');
  await attempt(base(cid), async () => {
    if (!(f instanceof File) || !f.size) throw new Error('Välj återrapportfilen från Bankgirot');
    r = await svc.importResult(a, new TextDecoder('latin1').decode(await f.arrayBuffer()));
  });
  done(base(cid), `${r.paid} dragningar bokförda som betalda, ${r.failed} misslyckades${r.unknown ? `, ${r.unknown} kunde inte kopplas` : ''}`);
}
