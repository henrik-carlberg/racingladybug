'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/bad-debts';

const back = (cid: number, id: number) => `/c/${cid}/fakturor/${id}`;

export async function writeOff(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { amount: 0, vat: 0 };
  await attempt(back(cid, id), async () => { r = await svc.writeOff(actor, id, { date: str(fd, 'date'), reason: str(fd, 'reason') }); });
  done(back(cid, id), `Kundförlusten är bokförd: ${kr(r.amount)} kr, varav utgående moms ${kr(r.vat)} kr som sätts ned`);
}

export async function undoWriteOff(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, id), () => svc.undoWriteOff(actor, id));
  done(back(cid, id), 'Bortskrivningen är ångrad och fakturan är obetald igen');
}

export async function recover(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let a = 0;
  await attempt(back(cid, id), async () => { a = await svc.recover(actor, id, { date: str(fd, 'date'), amount: amount(fd, 'amount'), bank_account: str(fd, 'bank_account') }); });
  done(back(cid, id), `Återvunnen kundförlust ${kr(a)} kr är bokförd`);
}
