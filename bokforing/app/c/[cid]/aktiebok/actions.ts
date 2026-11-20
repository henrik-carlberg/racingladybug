'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/shares';

const back = (cid: number) => `/c/${cid}/aktiebok`;
const owner = async (cid: number) => userActor(await requireCompany(cid, { owner: true }));

export async function init(cid: number, fd: FormData) {
  const actor = await owner(cid);
  await attempt(back(cid), () => svc.initRegister(actor, { share_capital: amount(fd, 'share_capital', 'Aktiekapital') ?? 0, date: str(fd, 'date'),
    holders: [0, 1, 2, 3].map((i) => ({ name: str(fd, `name_${i}`), holder_id: str(fd, `id_${i}`), address: str(fd, `address_${i}`), shares: Number(str(fd, `shares_${i}`)), share_class: (str(fd, `class_${i}`) === 'A' ? 'A' : 'B') as 'A' | 'B' }))
      .filter((h) => h.name || h.shares) }));
  done(back(cid), 'Aktieboken är upplagd');
}
export async function transfer(cid: number, fd: FormData) {
  const actor = await owner(cid);
  await attempt(back(cid), () => svc.transferShares(actor, { from: str(fd, 'from'), shares: str(fd, 'shares'), date: str(fd, 'date'), to_name: str(fd, 'to_name'), to_id: str(fd, 'to_id'),
    to_address: str(fd, 'to_address'), share_class: str(fd, 'share_class'), price: str(fd, 'price') ? amount(fd, 'price', 'Pris') : undefined }));
  done(back(cid), 'Överlåtelsen är införd i aktieboken');
}
export async function decide(cid: number, fd: FormData) {
  const actor = await owner(cid);
  await attempt(back(cid), () => svc.decideIssue(actor, { new_shares: str(fd, 'new_shares'), price: amount(fd, 'price', 'Teckningskurs'), date: str(fd, 'date'), share_class: str(fd, 'share_class') }));
  done(back(cid), 'Beslutet om nyemission är skickat för signering – för in teckningarna nedan');
}
export async function sub(cid: number, issueId: number, fd: FormData) {
  const actor = await owner(cid);
  await attempt(back(cid), () => svc.subscribe(actor, issueId, { name: str(fd, 'name'), holder_id: str(fd, 'holder_id'), address: str(fd, 'address'), shares: str(fd, 'shares') }));
  done(back(cid), 'Teckningen är införd');
}
export async function pay(cid: number, issueId: number, fd: FormData) {
  const actor = await owner(cid);
  await attempt(back(cid), () => svc.bookIssuePayment(actor, issueId, str(fd, 'date')));
  done(back(cid), 'Inbetalningen är bokförd på ej registrerat aktiekapital och överkursfond');
}
export async function register(cid: number, issueId: number, fd: FormData) {
  const actor = await owner(cid);
  await attempt(back(cid), () => svc.registerIssue(actor, issueId, str(fd, 'date')));
  done(back(cid), 'Emissionen är registrerad – aktiekapitalet och aktieboken är uppdaterade');
}
export async function minutes(cid: number, fd: FormData) {
  const actor = await owner(cid);
  await attempt(back(cid), () => svc.boardMinutes(actor, { date: str(fd, 'date'), place: str(fd, 'place'), present: str(fd, 'present'), items: str(fd, 'items'),
    signers: [0, 1, 2].map((i) => ({ name: str(fd, `sname_${i}`), email: str(fd, `semail_${i}`) })) }));
  done(back(cid), 'Protokollet är skickat för e-signering');
}
