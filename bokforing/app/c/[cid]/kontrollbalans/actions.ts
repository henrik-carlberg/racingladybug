'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/capital-control';

const base = (cid: number) => `/c/${cid}/kontrollbalans`;
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));

export async function drawSheet(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { equity: 0, deficit: false, half: 0 };
  await attempt(base(cid), async () => { r = await svc.draw(actor, form(fd)); });
  done(base(cid), r.deficit ? `Kontrollbalansräkningen visar kapitalbrist: eget kapital ${kr(r.equity)} kr understiger halva aktiekapitalet (${kr(r.half)} kr). Kalla till kontrollstämma snarast.`
    : `Kontrollbalansräkningen visar eget kapital ${kr(r.equity)} kr – ingen kapitalbrist`);
}

export async function holdMeeting(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { stage: '', second: null as string | null };
  await attempt(base(cid), async () => { r = await svc.meeting(actor, form(fd)); });
  done(base(cid), r.stage === 'first_meeting' ? `Första kontrollstämman är registrerad. Den andra ska hållas senast ${r.second}.`
    : r.stage === 'restored' ? 'Andra kontrollstämman: kapitalet är återställt och bolaget kan fortsätta' : 'Stämman har beslutat om likvidation');
}

export async function liquidate(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.startLiquidation(actor, form(fd)));
  done(base(cid), 'Likvidationsbeslutet är registrerat');
}

export async function liquidationStep(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.liquidationStep(actor, { step: str(fd, 'step'), date: str(fd, 'date') }));
  done(base(cid), 'Steget är registrerat');
}

export async function distribute(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  let n = 0;
  await attempt(base(cid), async () => { n = (await svc.bookDistribution(actor, form(fd))).net; });
  done(base(cid), `Skiftet är bokfört: ${kr(n)} kr till aktieägarna`);
}
