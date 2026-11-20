'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/securities';

const base = (cid: number) => `/c/${cid}/vardepapper`;
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));

export async function addSecurity(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.addSecurity(actor, form(fd)));
  done(base(cid), 'Innehavet är upplagt');
}
export async function trade(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { gain: null as number | null, cost: null as number | null };
  await attempt(base(cid), async () => { r = await svc.trade(actor, id, form(fd)); });
  done(base(cid), r.gain != null ? `Försäljningen är bokförd: anskaffningsvärde ${kr(r.cost ?? 0)} kr, ${r.gain >= 0 ? 'vinst' : 'förlust'} ${kr(Math.abs(r.gain))} kr` : 'Transaktionen är bokförd');
}
export async function undo(cid: number, id: number) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.undoLast(actor, id));
  done(base(cid), 'Den senaste transaktionen är ångrad');
}
export async function valueAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let w = { target: 0, change: 0 };
  await attempt(base(cid), async () => { w = await svc.value(actor, id, form(fd)); });
  done(base(cid), w.change > 0 ? `Nedskrivning ${kr(w.change)} kr är bokförd` : w.change < 0 ? `Återföring av nedskrivning ${kr(-w.change)} kr är bokförd` : 'Värderingen är sparad – ingen nedskrivning behövs');
}
