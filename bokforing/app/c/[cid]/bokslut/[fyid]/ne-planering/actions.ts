'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as e from '@/lib/services/ef-tax';

const back = (cid: number, fy: number) => `/c/${cid}/bokslut/${fy}/ne-planering`;
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
export async function saveParams(cid: number, fy: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, fy), () => e.saveParams(a, fy, obj(fd)));
  done(back(cid, fy), 'Årets satser är sparade');
}
export async function book(cid: number, fy: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, fy), () => e.bookFunds(a, fy, obj(fd)));
  done(back(cid, fy), 'Fondavsättningarna är bokförda');
}
