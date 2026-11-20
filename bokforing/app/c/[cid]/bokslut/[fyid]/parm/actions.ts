'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { saveItem } from '@/lib/services/closing-binder';

export async function save(cid: number, fy: number, account: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const back = `/c/${cid}/bokslut/${fy}/parm#a${account}`;
  await attempt(back, () => saveItem(a, fy, account, Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'))));
  done(back, fd.get('done') === 'on' ? `Konto ${account} är avstämt` : `Specifikationen för ${account} är sparad`);
}
