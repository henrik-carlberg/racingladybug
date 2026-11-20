'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as s from '@/lib/services/coop';

const back = (cid: number, q = '') => `/c/${cid}/ekforening${q}`;
async function run<T>(b: string, fn: () => Promise<T>): Promise<T> { let r!: T; await attempt(b, async () => { r = await fn(); }); return r; }
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function form(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { owner: true }));
  const f = fd.get('form');
  const v = f === 'ek' || f === 'stiftelse' ? f : null;
  await attempt(back(cid), () => s.setForm(a, v));
  done(back(cid), v === 'ek' ? 'Läget för ekonomisk förening är på' : v === 'stiftelse' ? 'Stiftelseläget är på' : 'Läget är avstängt');
}
export async function settings(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { owner: true }));
  await attempt(back(cid), () => s.saveSettings(a, obj(fd)));
  done(back(cid), 'Inställningarna är sparade');
}
export async function member(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const m = await run(back(cid), () => s.addMember(a, obj(fd)));
  done(back(cid), `Medlem nr ${m.member_no} är registrerad`);
}
export async function insats(cid: number, id: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => s.insats(a, id, obj(fd)));
  done(back(cid), fd.get('kind') === 'repaid' ? 'Insatsen är återbetald och bokförd' : 'Insatsen är bokförd');
}
export async function notice(cid: number, id: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const x = await run(back(cid), () => s.notice(a, id, obj(fd)));
  done(back(cid), `Uppsägningen är registrerad – avgång ${x.leavesOn}, insatsen kan betalas tillbaka från ${x.payableFrom}`);
}
export async function refund(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, `?fy=${Number(fd.get('fy')) || ''}`), () => s.decideRefund(a, obj(fd)));
  done(back(cid), 'Återbäringen är bokförd och fördelad på medlemmarna');
}
export async function payRefund(cid: number, id: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => s.payRefund(a, id, obj(fd)));
  done(back(cid), 'Återbäringen är utbetald');
}
export async function grant(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => s.decideGrant(a, obj(fd)));
  done(back(cid), 'Bidraget är beviljat och bokfört');
}
export async function payGrant(cid: number, id: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => s.payGrant(a, id, obj(fd)));
  done(back(cid), 'Bidraget är utbetalt');
}
