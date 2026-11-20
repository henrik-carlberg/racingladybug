'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { acknowledge, unacknowledge } from '@/lib/services/quality-checks';

const back = (cid: number, fy: number) => `/c/${cid}/bokslut/${fy}/kontroller`;

export async function ack(cid: number, fy: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, fy), () => acknowledge(actor, fy, Object.fromEntries(fd)));
  done(back(cid, fy), 'Avvikelsen är kvitterad');
}

export async function unack(cid: number, fy: number, key: string) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, fy), () => unacknowledge(actor, fy, key));
  done(back(cid, fy), 'Kvitteringen är borttagen');
}
